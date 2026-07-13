#!/usr/bin/env python3
"""Enumerate BELOW-level-100 gear pages (Riddler's low-level waypoints need these).
Same category walk as items_enum.py, but keeps brackets 1..95.
Output: data/gear/pages_low_<slot>.json.
"""
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).parent))
import cf  # noqa: E402
from items_enum import SLOT_CATEGORY, LEVEL_RE, to_slug, OUT  # noqa: E402


def enum_slot(slot):
    url = f"Category:{SLOT_CATEGORY[slot]}"
    titles, pages = [], 0
    while url:
        html = cf.fetch(url)
        if not html:
            break
        pages += 1
        section = html.split('id="mw-pages"', 1)[-1]
        titles += [unquote(m) for m in re.findall(r'href="/wiki/(Item:[^"?#]+)"', section)]
        nxt = re.search(r'href="([^"]*pagefrom=[^"]*)"[^>]*>\s*next page', html, re.I)
        url = nxt.group(1).replace("&amp;", "&").split("#")[0].replace("/wiki/", "") if nxt else None
        time.sleep(1.1)
    seen = {}
    for t in titles:
        m = LEVEL_RE.search(t)
        if not m:
            continue
        lvl = int(m.group(1))
        if lvl < 1 or lvl >= 100:
            continue
        slug = to_slug(t)
        seen[slug] = {"title": t, "slug": slug, "slot": slot, "level": lvl}
    recs = sorted(seen.values(), key=lambda r: (r["level"], r["slug"]))
    (OUT / f"pages_low_{slot}.json").write_text(json.dumps(recs, indent=1, ensure_ascii=False))
    print(f"{slot}: {pages} pages -> {len(recs)} sub-100 variants", flush=True)
    return recs


def main():
    slots = [s for s in sys.argv[1:] if s in SLOT_CATEGORY] or ["hat", "robe", "boots", "wand", "athame", "amulet", "ring", "deck"]
    total = 0
    for slot in slots:
        total += len(enum_slot(slot))
    print(f"TOTAL sub-100 gear variants: {total}")


if __name__ == "__main__":
    main()
