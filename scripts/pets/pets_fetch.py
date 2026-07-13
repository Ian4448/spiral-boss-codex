#!/usr/bin/env python3
"""Fetch each pet page HTML (resumable). Reads data/pets_pages.json,
writes data/raw_pets/<slug>.html. Skips already-fetched files."""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gear"))
import cf  # noqa: E402

RAW = Path("data/raw_pets")
RAW.mkdir(parents=True, exist_ok=True)


def main():
    pets = json.loads(Path("data/pets_pages.json").read_text())
    todo = [p for p in pets if not (RAW / f"{p['slug']}.html").exists()]
    print(f"{len(pets)} pets, {len(todo)} to fetch")
    ok = fail = 0
    for i, p in enumerate(todo):
        html = cf.fetch(p["title"])
        if html and len(html) > 2000:
            (RAW / f"{p['slug']}.html").write_text(html)
            ok += 1
        else:
            fail += 1
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(todo)} (ok={ok} fail={fail})", flush=True)
        time.sleep(0.5)
    print(f"done: ok={ok} fail={fail}")


if __name__ == "__main__":
    main()
