#!/usr/bin/env python3
"""Export the currently selected Drive notes to a deployable JS snapshot."""

import argparse
import concurrent.futures
import json
import pathlib
import subprocess
import time
from datetime import datetime, timezone

API = "https://script.google.com/macros/s/AKfycbw2WWjD9NKQKYNYLnVtU0E7xLKe69ELXw1FeIeEMUaFGY0zintiPAhwsnCC_figFrEScQ/exec"


def post(payload):
    body = json.dumps(payload).encode("utf-8")
    for attempt in range(4):
        try:
            response = subprocess.run(
                ["curl", "--fail", "--location", "--silent", "--show-error", "--max-time", "75",
                 "--header", "Content-Type: text/plain;charset=UTF-8", "--data-binary", "@-", API],
                input=body, capture_output=True, check=True,
            )
            result = json.loads(response.stdout)
            if not result.get("ok"):
                raise RuntimeError(result.get("error", "API error"))
            return result
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="public/engineering-records-data.js")
    parser.add_argument("--checkpoint", default="/tmp/engineering-records-export.json")
    parser.add_argument("--catalog", help="Previously fetched catalog JSON for a retry")
    args = parser.parse_args()
    output = pathlib.Path(args.output)
    checkpoint = pathlib.Path(args.checkpoint)
    catalog = json.loads(pathlib.Path(args.catalog).read_text()) if args.catalog else post({"action": "engineeringRecords.catalog"})
    if not isinstance(catalog.get("records"), list):
        raise RuntimeError(f"Catalog is missing records; fields: {list(catalog)}")
    entries = catalog["records"]
    by_id = {entry["id"]: entry for entry in entries}
    saved = json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    records = {key: value for key, value in saved.items()
               if key in by_id and value.get("modifiedTime") == by_id[key]["modifiedTime"]
               and isinstance(value.get("content"), str)}
    missing = [entry["id"] for entry in entries if entry["id"] not in records]
    batches = [missing[i:i + 8] for i in range(0, len(missing), 8)]
    print(f"Catalog: {len(entries)} notes; downloading {len(missing)} in {len(batches)} batches", flush=True)

    def read_batch(ids):
        result = post({"action": "engineeringRecords.batchRead", "ids": ids})
        found = {record["id"]: record for record in result.get("records", [])}
        for missing_id in ids:
            if missing_id not in found:
                retry = post({"action": "engineeringRecords.batchRead", "ids": [missing_id]})
                for record in retry.get("records", []):
                    found[record["id"]] = record
        if len(found) != len(ids):
            raise RuntimeError(f"Incomplete batch: {len(found)}/{len(ids)}")
        return list(found.values())

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(read_batch, batch): batch for batch in batches}
        for done, future in enumerate(concurrent.futures.as_completed(futures), 1):
            for record in future.result():
                if record.get("id") in by_id:
                    records[record["id"]] = record
            checkpoint.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
            if done % 5 == 0 or done == len(batches):
                print(f"Downloaded {len(records)}/{len(entries)} notes", flush=True)

    if len(records) != len(entries):
        raise RuntimeError(f"Incomplete export: {len(records)}/{len(entries)}")
    snapshot = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "includedFolders": catalog["includedFolders"],
        "records": [records[entry["id"]] for entry in entries],
    }
    serialized = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    serialized = serialized.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    output.write_text("window.ENGINEERING_RECORDS_SNAPSHOT=" + serialized + ";\n", encoding="utf-8")
    print(f"Wrote {len(entries)} notes, {output.stat().st_size} bytes", flush=True)


if __name__ == "__main__":
    main()
