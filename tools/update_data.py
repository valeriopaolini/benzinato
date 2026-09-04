#!/usr/bin/env python3
"""Scarica i CSV MIMIT e genera dataset compatti per Benzinato."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

OK, NO_UPDATE, SOURCE_UNAVAILABLE, BAD_FORMAT, BAD_DATA, LOCAL_ERROR = 0, 10, 20, 21, 22, 30
DEFAULT_STATIONS = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv"
DEFAULT_PRICES = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"
DEFAULT_TYPE_MAP = Path(__file__).resolve().parents[1] / "config" / "type_map.csv"
PROVINCES = {
    "Agrigento":"AG","Alessandria":"AL","Ancona":"AN","Aosta":"AO","Arezzo":"AR","Ascoli Piceno":"AP","Asti":"AT","Avellino":"AV","Bari":"BA","Barletta-Andria-Trani":"BT","Belluno":"BL","Benevento":"BN","Bergamo":"BG","Biella":"BI","Bologna":"BO","Bolzano":"BZ","Brescia":"BS","Brindisi":"BR","Cagliari":"CA","Caltanissetta":"CL","Campobasso":"CB","Carbonia-Iglesias":"CI","Caserta":"CE","Catania":"CT","Catanzaro":"CZ","Chieti":"CH","Como":"CO","Cosenza":"CS","Cremona":"CR","Crotone":"KR","Cuneo":"CN","Enna":"EN","Fermo":"FM","Ferrara":"FE","Firenze":"FI","Foggia":"FG","Forlì-Cesena":"FC","Frosinone":"FR","Genova":"GE","Gorizia":"GO","Grosseto":"GR","Imperia":"IM","Isernia":"IS","L'Aquila":"AQ","La Spezia":"SP","Latina":"LT","Lecce":"LE","Lecco":"LC","Livorno":"LI","Lodi":"LO","Lucca":"LU","Macerata":"MC","Mantova":"MN","Massa-Carrara":"MS","Matera":"MT","Medio Campidano":"VS","Messina":"ME","Milano":"MI","Modena":"MO","Monza e della Brianza":"MB","Napoli":"NA","Novara":"NO","Nuoro":"NU","Oristano":"OR","Padova":"PD","Palermo":"PA","Parma":"PR","Pavia":"PV","Perugia":"PG","Pesaro e Urbino":"PU","Pescara":"PE","Piacenza":"PC","Pisa":"PI","Pistoia":"PT","Pordenone":"PN","Potenza":"PZ","Prato":"PO","Ragusa":"RG","Ravenna":"RA","Reggio Calabria":"RC","Reggio Emilia":"RE","Rieti":"RI","Rimini":"RN","Roma":"RM","Rovigo":"RO","Salerno":"SA","Sassari":"SS","Savona":"SV","Siena":"SI","Siracusa":"SR","Sondrio":"SO","Sud Sardegna":"SU","Taranto":"TA","Teramo":"TE","Terni":"TR","Torino":"TO","Trapani":"TP","Trento":"TN","Treviso":"TV","Trieste":"TS","Udine":"UD","Varese":"VA","Venezia":"VE","Verbano-Cusio-Ossola":"VB","Vercelli":"VC","Verona":"VR","Vibo Valentia":"VV","Vicenza":"VI","Viterbo":"VT"
}

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower())

PROVINCE_LOOKUP = {norm(k): (v, k) for k, v in PROVINCES.items()}
PROVINCE_LOOKUP.update({v.lower(): (v, k) for k, v in PROVINCES.items()})

def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()).strip("-")
    return result or "carburante"

def compact(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")

def atomic_write(path: Path, data: bytes) -> bool:
    if path.exists() and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".benza-")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    return True

def fetch(source: str, timeout: int) -> bytes:
    if source.startswith(("http://", "https://")):
        request = urllib.request.Request(source, headers={"User-Agent": "Benzinato-data-generator/1.0"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    return Path(source).read_bytes()

def read_csv(raw: bytes, expected: set[str]) -> list[dict[str, str]]:
    text = raw.decode("utf-8-sig", errors="strict").replace("\r\n", "\n")
    lines = [line for line in text.splitlines() if line.strip()]
    header_index = next((i for i, line in enumerate(lines[:8]) if expected.issubset({norm(x) for x in re.split(r"[|;]", line)})), None)
    if header_index is None:
        raise ValueError("intestazione CSV non riconosciuta")
    header = lines[header_index]
    delimiter = "|" if header.count("|") >= header.count(";") else ";"
    reader = csv.reader(io.StringIO("\n".join(lines[header_index:])), delimiter=delimiter)
    columns = [norm(value) for value in next(reader)]
    rows = []
    for line_number, values in enumerate(reader, header_index + 2):
        # Alcune anagrafiche MIMIT contengono ancora pipe non quotate nel nome
        # dell'impianto. I quattro campi iniziali e i cinque finali hanno
        # posizione stabile, quindi il nome può essere ricomposto senza
        # spostare indirizzo, provincia e coordinate.
        if len(values) > len(columns) and "nomeimpianto" in columns and columns.index("nomeimpianto") == 4:
            values = values[:4] + ["|".join(values[4:-5])] + values[-5:]
        if len(values) != len(columns):
            raise ValueError(f"numero di campi inatteso alla riga {line_number}: {len(values)} invece di {len(columns)}")
        rows.append({key: value.strip() for key, value in zip(columns, values)})
    return rows

def read_type_map(path: Path) -> dict[str, str]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if not reader.fieldnames or {norm(value) for value in reader.fieldnames} != {"tipologia", "gruppo"}:
                raise ValueError("type_map.csv deve contenere le colonne tipologia,gruppo")
            columns = {norm(value): value for value in reader.fieldnames}
            mapping = {}
            for line_number, row in enumerate(reader, 2):
                source = (row.get(columns["tipologia"]) or "").strip()
                group = (row.get(columns["gruppo"]) or "").strip()
                if not source or not group:
                    raise ValueError(f"valore vuoto in type_map.csv alla riga {line_number}")
                if source in mapping and mapping[source] != group:
                    raise ValueError(f"mappatura duplicata e incoerente per {source!r}")
                mapping[source] = group
    except OSError:
        raise
    if not mapping:
        raise ValueError("type_map.csv non contiene mappature")
    return mapping

def parse_datetime(value: str) -> str:
    value = value.strip()
    formats = ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S")
    for fmt in formats:
        try:
            dt = datetime.strptime(value, fmt).replace(tzinfo=ZoneInfo("Europe/Rome"))
            return dt.isoformat()
        except ValueError:
            pass
    raise ValueError(f"data non valida: {value}")

def generate(station_raw: bytes, price_raw: bytes, type_map: dict[str, str], output: Path, min_valid_ratio: float) -> tuple[bool, int]:
    stations_rows = read_csv(station_raw, {"idimpianto", "provincia", "latitudine", "longitudine"})
    price_rows = read_csv(price_raw, {"idimpianto", "desccarburante", "prezzo", "isself", "dtcomu"})
    stations, invalid_stations = {}, 0
    for row in stations_rows:
        try:
            station_id = int(row["idimpianto"])
            latitude, longitude = float(row["latitudine"].replace(",", ".")), float(row["longitudine"].replace(",", "."))
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180) or (latitude == 0 and longitude == 0): raise ValueError()
            province = PROVINCE_LOOKUP.get(norm(row["provincia"]))
            if not province: raise ValueError()
            stations[station_id] = {"id":station_id,"name":row.get("nomeimpianto", "") or row.get("gestore", "Impianto"),"brand":row.get("bandiera", ""),"address":row.get("indirizzo", ""),"municipality":row.get("comune", ""),"province":province[0],"provinceName":province[1],"latitude":latitude,"longitude":longitude}
        except (ValueError, KeyError):
            invalid_stations += 1
    grouped, labels, invalid_prices, unmapped = defaultdict(list), {}, 0, set()
    for row in price_rows:
        try:
            station = stations[int(row["idimpianto"])]
            product = row["desccarburante"].strip()
            if not product: raise ValueError()
            label = type_map.get(product)
            if not label:
                unmapped.add(product)
                continue
            fuel_id = slug(label)
            price = float(row["prezzo"].replace(",", "."))
            if not (0 < price < 20): raise ValueError()
            self_value = row["isself"].strip().lower()
            if self_value not in {"0", "1", "true", "false"}: raise ValueError()
            record = {k:v for k,v in station.items() if k != "provinceName"}
            record.update({"product":product,"isSelf":self_value in {"1", "true"},"price":price,"reportedAt":parse_datetime(row["dtcomu"])})
            grouped[(station["province"], fuel_id)].append(record)
            labels[fuel_id] = label
        except (ValueError, KeyError):
            invalid_prices += 1
    if unmapped:
        sample = ", ".join(sorted(unmapped)[:10])
        suffix = "…" if len(unmapped) > 10 else ""
        raise RuntimeError(f"{len(unmapped)} tipologie carburante non presenti in type_map.csv: {sample}{suffix}")
    total = len(stations_rows) + len(price_rows)
    valid = len(stations) + sum(map(len, grouped.values()))
    if not stations or not grouped or (total and valid / total < min_valid_ratio):
        raise RuntimeError(f"troppi record non validi: {valid}/{total}")
    generated_at = datetime.now(ZoneInfo("Europe/Rome")).isoformat(timespec="seconds")
    province_entries = []
    changed = False
    active_paths = set()
    for province_code in sorted({key[0] for key in grouped}):
        fuels = []
        for code, fuel_id in sorted(k for k in grouped if k[0] == province_code):
            records = sorted(grouped[(code, fuel_id)], key=lambda r: (r["price"], r["id"], not r["isSelf"]))
            payload = compact(records)
            relative = f"{code}/{fuel_id}.json"
            active_paths.add(relative)
            changed |= atomic_write(output / relative, payload)
            fuels.append({"id":fuel_id,"label":labels[fuel_id],"path":f"data/{relative}","sha256":hashlib.sha256(payload).hexdigest(),"bytes":len(payload),"records":len(records)})
        name = next((name for name, code in PROVINCES.items() if code == province_code), province_code)
        province_entries.append({"code":province_code,"name":name,"fuels":fuels})
    # Remove only obsolete generated json files; directories and manifest are retained.
    for old in output.glob("*/*.json"):
        if old.relative_to(output).as_posix() not in active_paths:
            old.unlink(); changed = True
    manifest = {"schemaVersion":1,"generatedAt":generated_at,"provinces":province_entries}
    previous = None
    manifest_path = output / "manifest.json"
    if manifest_path.exists():
        try: previous = json.loads(manifest_path.read_text("utf-8"))
        except json.JSONDecodeError: pass
    if previous:
        comparable = dict(manifest); comparable.pop("generatedAt", None)
        old_comparable = dict(previous); old_comparable.pop("generatedAt", None)
        if comparable == old_comparable and not changed:
            return False, invalid_stations + invalid_prices
    changed |= atomic_write(manifest_path, compact(manifest))
    return changed, invalid_stations + invalid_prices

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stations", default=os.getenv("MIMIT_STATIONS_URL", DEFAULT_STATIONS))
    parser.add_argument("--prices", default=os.getenv("MIMIT_PRICES_URL", DEFAULT_PRICES))
    parser.add_argument("--type-map", default=os.getenv("BENZA_TYPE_MAP", str(DEFAULT_TYPE_MAP)))
    parser.add_argument("--output", default="data")
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument("--min-valid-ratio", type=float, default=.70)
    args = parser.parse_args(argv)
    try:
        station_raw, price_raw = fetch(args.stations, args.timeout), fetch(args.prices, args.timeout)
    except (OSError, urllib.error.URLError) as exc:
        print(f"Sorgente MIMIT non disponibile: {exc}", file=sys.stderr); return SOURCE_UNAVAILABLE
    try:
        type_map = read_type_map(Path(args.type_map))
        changed, skipped = generate(station_raw, price_raw, type_map, Path(args.output), args.min_valid_ratio)
    except (UnicodeError, csv.Error, ValueError) as exc:
        print(f"Formato sorgente inatteso: {exc}", file=sys.stderr); return BAD_FORMAT
    except RuntimeError as exc:
        print(f"Validazione fallita: {exc}", file=sys.stderr); return BAD_DATA
    except OSError as exc:
        print(f"Errore locale: {exc}", file=sys.stderr); return LOCAL_ERROR
    if not changed:
        print("Nessun aggiornamento nei dati MIMIT."); return NO_UPDATE
    print(f"Dati aggiornati con successo ({skipped} record scartati).")
    return OK

if __name__ == "__main__":
    raise SystemExit(main())
