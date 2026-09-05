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
            self.assertEqual(manifest["schemaVersion"], 2)
            self.assertEqual(manifest["provinces"][0]["code"], "BO")
            fuels = {f["id"]: f for f in manifest["fuels"]}
            self.assertEqual(set(fuels), {"benzina", "gasolio"})
            self.assertEqual(fuels["gasolio"]["label"], "Gasolio")
            payload = json.loads((Path(directory) / "BO.json").read_text())
            self.assertEqual(payload["schemaVersion"], 2)
            self.assertEqual(len(payload["stations"]), 2)
            self.assertEqual(len(payload["stations"][0]["offers"]), 3)
            self.assertTrue(any(offer["isSelf"] for offer in payload["stations"][0]["offers"]))
            self.assertTrue(all(offer["primary"] for offer in payload["stations"][0]["offers"]))
            self.assertEqual(payload["stations"][0]["province"], "BO")
            self.assertIn("|", payload["stations"][1]["name"])
            self.assertNotIn("\n", (Path(directory) / "BO.json").read_text())

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
            bad_map.write_text("tipologia,gruppo,principale\nBenzina,Benzina,1\n")
            result = subprocess.run([sys.executable, SCRIPT, "--stations", FIXTURES / "stations.csv", "--prices", FIXTURES / "prices.csv", "--type-map", bad_map, "--output", Path(directory) / "data"], text=True, capture_output=True)
            self.assertEqual(result.returncode, 22)
            self.assertIn("non presenti", result.stderr)

if __name__ == "__main__": unittest.main()
