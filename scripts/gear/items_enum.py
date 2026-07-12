#!/usr/bin/env python3
"""Enumerate level-100+ gear item pages for each slot category.

Item titles embed the level bracket, e.g. Item:Able_Ranger's_Hat_(Level_100+).
We walk each slot's Category pagination, collect Item: links, and keep the
level-100..170 brackets. Output: data/gear/pages_<slot>.json.

Usage: python scripts/gear/enum.py [slot ...]   (default: all slots)
"""
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).parent))
import cf  # noqa: E402

SLOT_CATEGORY = {
    "hat": "Hats", "robe": "Robes", "boots": "Boots", "wand": "Wands",
    "athame": "Athames", "amulet": "Amulets", "ring": "Rings",
    "deck": "Decks", "mount": "Mounts",
}
OUT = Path("data/gear")
OUT.mkdir(parents=True, exist_ok=True)

LEVEL_RE = re.compile(r"\(Level[_ ](\d+)\+\)")


def to_slug(title):
    t = title.replace("Item:", "")
    return re.sub(r"[^A-Za-z0-9()'!+.-]+", "_", t).strip("_")


def enum_slot(slot):
    cat = SLOT_CATEGORY[slot]
    url = f"Category:{cat}"
    titles = []
    pages = 0
    while url:
        html = cf.fetch(url)
        if not html:
            break
        pages += 1
        section = html.split('id="mw-pages"', 1)[-1]
        for m in re.findall(r'href="/wiki/(Item:[^"?#]+)"', section):
            titles.append(unquote(m))
        nxt = re.search(r'href="([^"]*pagefrom=[^"]*)"[^>]*>\s*next page', html, re.I)
        # cf.fetch wants the path after "/wiki/", e.g. index.php?title=Category:Hats&pagefrom=...
        url = nxt.group(1).replace("&amp;", "&").split("#")[0].replace("/wiki/", "") if nxt else None
        time.sleep(1.2)

    seen = {}
    for t in titles:
        m = LEVEL_RE.search(t)
        if not m:
            continue
        lvl = int(m.group(1))
        if lvl < 100 or lvl > 170:
            continue
        slug = to_slug(t)
        seen[slug] = {"title": t, "slug": slug, "slot": slot, "level": lvl}
    recs = sorted(seen.values(), key=lambda r: (r["level"], r["slug"]))
    (OUT / f"pages_{slot}.json").write_text(json.dumps(recs, indent=1, ensure_ascii=False))
    print(f"{slot}: {len(titles)} item links across {pages} pages -> {len(recs)} level-100+ variants")
    return recs


def main():
    slots = [s for s in sys.argv[1:] if s in SLOT_CATEGORY] or list(SLOT_CATEGORY)
    total = 0
    for slot in slots:
        total += len(enum_slot(slot))
    print(f"TOTAL level-100+ gear variants: {total}")


if __name__ == "__main__":
    main()
