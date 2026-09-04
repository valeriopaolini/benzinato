import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "tools" / "update_data.py"
FIXTURES = ROOT / "tests" / "fixtures"

class GeneratorTests(unittest.TestCase):
    def run_generator(self, output, stations="stations.csv", prices="prices.csv"):
        return subprocess.run([sys.executable, SCRIPT, "--stations", FIXTURES / stations, "--prices", FIXTURES / prices, "--type-map", FIXTURES / "type_map.csv", "--output", output], text=True, capture_output=True)

    def test_generates_denormalized_compact_files_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_generator(directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = json.loads((Path(directory) / "manifest.json").read_text())
            self.assertEqual(manifest["schemaVersion"], 1)
            self.assertEqual(manifest["provinces"][0]["code"], "BO")
            fuels = {f["id"]: f for f in manifest["provinces"][0]["fuels"]}
            self.assertEqual(set(fuels), {"benzina", "gasolio"})
            self.assertEqual(fuels["gasolio"]["label"], "Gasolio")
            records = json.loads((Path(directory) / "BO" / "benzina.json").read_text())
            self.assertEqual(len(records), 3)
            self.assertTrue(records[0]["isSelf"])
            self.assertEqual(records[0]["province"], "BO")
            self.assertEqual(records[0]["product"], "Benzina")
            self.assertIn("|", records[1]["name"])
            self.assertNotIn("\n", (Path(directory) / "BO" / "benzina.json").read_text())

    def test_second_run_returns_no_update_and_preserves_mtime(self):
        with tempfile.TemporaryDirectory() as directory:
            first = self.run_generator(directory)
            path = Path(directory) / "manifest.json"
            before = path.stat().st_mtime_ns
            second = self.run_generator(directory)
            self.assertEqual(first.returncode, 0)
            self.assertEqual(second.returncode, 10, second.stderr)
            self.assertEqual(path.stat().st_mtime_ns, before)

    def test_missing_source_returns_20(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_generator(directory, "missing.csv")
            self.assertEqual(result.returncode, 20)

    def test_unmapped_fuel_returns_22(self):
        with tempfile.TemporaryDirectory() as directory:
            bad_map = Path(directory) / "type_map.csv"
            bad_map.write_text("tipologia,gruppo\nBenzina,Benzina\n")
            result = subprocess.run([sys.executable, SCRIPT, "--stations", FIXTURES / "stations.csv", "--prices", FIXTURES / "prices.csv", "--type-map", bad_map, "--output", Path(directory) / "data"], text=True, capture_output=True)
            self.assertEqual(result.returncode, 22)
            self.assertIn("non presenti", result.stderr)

if __name__ == "__main__": unittest.main()
