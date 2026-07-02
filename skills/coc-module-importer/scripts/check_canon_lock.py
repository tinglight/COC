#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def canon_digest(canon_dir: Path) -> str:
    h = hashlib.sha256()
    for path in sorted(canon_dir.glob("*")):
        if path.is_file():
            h.update(path.name.encode("utf-8"))
            h.update(path.read_bytes())
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify that imported canon files still match module_manifest.json.")
    parser.add_argument("module_output", help="Module output folder")
    args = parser.parse_args()

    root = Path(args.module_output).expanduser().resolve()
    manifest_path = root / "module_manifest.json"
    canon_dir = root / "canon"
    if not manifest_path.exists():
        raise SystemExit(f"Missing manifest: {manifest_path}")
    if not canon_dir.exists():
        raise SystemExit(f"Missing canon directory: {canon_dir}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = manifest.get("canon_digest")
    actual = canon_digest(canon_dir)
    result = {
        "module_id": manifest.get("module_id"),
        "expected": expected,
        "actual": actual,
        "canon_locked": expected == actual,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if expected != actual:
        raise SystemExit("Canon digest mismatch. Put table changes in campaign/ instead of editing canon/.")


if __name__ == "__main__":
    main()
