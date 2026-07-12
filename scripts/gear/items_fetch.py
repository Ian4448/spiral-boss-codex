#!/usr/bin/env python3
"""Fetch enumerated gear item pages into data/raw_gear/<slug>.html.
Resumable; refreshes the Cloudflare session on challenge (via cf.py).

Usage: python scripts/gear/items_fetch.py [slot ...] [--limit N]
"""
import json
import sys
import time
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).parent))
import cf  # noqa: E402

RAW = Path("data/raw_gear")
RAW.mkdir(parents=True, exist_ok=True)
GEAR = Path("data/gear")


def main():
    import os
    flagless = []
    i = 0
    limit = None
    argv = sys.argv[1:]
    while i < len(argv):
        if argv[i] == "--limit":
            limit = int(argv[i + 1]); i += 2
        else:
            flagless.append(argv[i]); i += 1
    minlevel = int(os.environ.get("MINLEVEL", "0"))
    slots = flagless or [p.stem.replace("pages_", "") for p in GEAR.glob("pages_*.json")]

    for slot in slots:
        pf = GEAR / f"pages_{slot}.json"
        if not pf.exists():
            print(f"no enumeration for {slot}; run items_enum.py first")
            continue
        recs = json.loads(pf.read_text())
        if minlevel:
            recs = [r for r in recs if (r.get("level") or 0) >= minlevel]
        if limit:
            recs = recs[:limit]
        done = skipped = failed = 0
        for i, rec in enumerate(recs):
            dest = RAW / f"{rec['slug']}.html"
            if dest.exists() and dest.stat().st_size > 4000:
                skipped += 1
                continue
            html = cf.fetch(quote(rec["title"]))
            if html:
                dest.write_text(html, encoding="utf-8")
                done += 1
            else:
                failed += 1
            if (done + failed) % 50 == 0 and (done + failed) > 0:
                print(f"  {slot}: {done} fetched, {skipped} cached, {failed} failed, {i+1}/{len(recs)}")
            time.sleep(0.5)
        print(f"{slot}: DONE {done} fetched, {skipped} cached, {failed} failed")


if __name__ == "__main__":
    main()
