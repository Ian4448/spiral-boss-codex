#!/usr/bin/env python3
"""Parse cached gear item HTML (data/raw_gear/*.html) into structured records.

Each bonus row is a <dd> like:
  +318 Max {Health}                         -> maxHealth 318
  +6% {Power Pip} Chance                     -> powerPipChance 6
  +88 {Death} +73 {Ice} +105 {Storm} {Critical} Rating  -> critical per school

Output: data/gear/items_<slot>.json  (or items_all.json when parsing everything).
"""
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

RAW = Path("data/raw_gear")
OUT = Path("data/gear")
SCHOOLS = {"Fire", "Ice", "Storm", "Myth", "Life", "Death", "Balance", "Sun", "Moon", "Star", "Global"}

# stat-type icon alt -> (stat key, default percent?)
STAT_ICON = {
    "Health": ("maxHealth", False), "Mana": ("maxMana", False),
    "Power Pip": ("powerPipChance", True), "Shadow Pip": ("shadowPipRating", False),
    "Accuracy": ("accuracy", True), "Critical": ("critical", False),
    "Critical Block": ("block", False), "Block": ("block", False),
    "Damage": ("damage", True), "Armor Piercing": ("pierce", True),
    "Resistance": ("resist", True), "Pip Conversion": ("pipConversion", False),
    "Stun Resistance": ("stunResist", True), "Archmastery": ("archmastery", False),
    "Incoming": ("incHealing", True), "Outgoing": ("outHealing", True),
    "Pip": ("startPips", False), "Power Pip Conversion": ("pipConversion", False),
}
PER_SCHOOL = {"critical", "block", "damage", "resist", "accuracy", "pierce"}


def js_config(raw, key):
    m = re.search(r'"%s":\s*(\[.*?\]|"(?:[^"\\]|\\.)*"|true|false|\d+)' % re.escape(key), raw, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def icon_alt(el):
    m = re.match(r"\(Icon\)\s*(.+?)\.png", el.get("alt", ""))
    return m.group(1).strip() if m else None


def parse_dd(dd):
    """Return list of (statKey, school|None, value, is_percent)."""
    tokens = []  # ('num', value, pct) or ('icon', alt)
    for el in dd.descendants:
        if isinstance(el, str):
            for m in re.finditer(r"([+-]?\d+)(%?)", el):
                tokens.append(("num", int(m.group(1)), bool(m.group(2))))
        elif el.name == "img":
            a = icon_alt(el)
            if a:
                tokens.append(("icon", a))
    # stat type = the non-school icon
    stat_icon = next((t[1] for t in tokens if t[0] == "icon" and t[1] not in SCHOOLS and t[1] in STAT_ICON), None)
    if not stat_icon:
        return []
    key, pct_default = STAT_ICON[stat_icon]
    out = []
    pending = None
    for t in tokens:
        if t[0] == "num":
            pending = (t[1], t[2])
        elif t[0] == "icon" and t[1] in SCHOOLS and pending is not None:
            out.append((key, t[1], pending[0], pending[1] or pct_default))
            pending = None
    if pending is not None:  # value with no school icon -> global/flat
        out.append((key, "Global", pending[0], pending[1] or pct_default))
    return out


def parse_file(path):
    raw = path.read_text(encoding="utf-8", errors="replace")
    cats = js_config(raw, "wgCategories") or []
    if not any(c.endswith((" Hats", " Robes", " Boots", " Wands", " Athames",
                           " Amulets", " Rings", " Decks", " Mounts")) or c in
               ("Hats", "Robes", "Boots", "Wands", "Athames", "Amulets", "Rings", "Decks", "Mounts")
               for c in cats):
        return None
    title = js_config(raw, "wgTitle") or path.stem
    name = re.sub(r"\s*\(Level \d+\+\)|\s*\(Any Level\)", "", title).strip()

    soup = BeautifulSoup(raw, "lxml")

    # stats: find the "Bonuses" label row, parse following <dd>s
    stats = {}
    def add(key, school, val, pct):
        if key in PER_SCHOOL:
            d = stats.setdefault(key, {})
            d[school] = d.get(school, 0) + val
        else:
            stats[key] = stats.get(key, 0) + val

    for dd in soup.find_all("dd"):
        for key, school, val, pct in parse_dd(dd):
            add(key, school, val, pct)

    # school restriction + level from categories
    school = "Any"
    for c in cats:
        m = re.match(r"^(\w+) School (Items|Hats|Robes|Boots|Wands|Athames|Amulets|Rings|Decks|Mounts)$", c)
        if m and m.group(1) in SCHOOLS:
            school = m.group(1)
            break
    m = re.search(r"\(Level (\d+)\+\)", title)
    level = int(m.group(1)) if m else None
    slot = next((s for s in ("hat", "robe", "boots", "wand", "athame", "amulet", "ring", "deck", "mount")
                 if any(c == cat for c in cats
                        for cat in ({"hat": "Hats", "robe": "Robes", "boots": "Boots", "wand": "Wands",
                                     "athame": "Athames", "amulet": "Amulets", "ring": "Rings",
                                     "deck": "Decks", "mount": "Mounts"}[s],))), None)

    # gear art (Style A/B)
    imgs = re.findall(r'src="(/wiki/images/thumb/[^"]*%28Item%29[^"]*\.png/[^"]*)"', raw)
    image = imgs[0] if imgs else None

    return {
        "slug": path.stem, "name": name, "slot": slot, "school": school, "level": level,
        "stats": stats, "image": image,
        "wikiUrl": f"https://wiki.wizard101central.com/wiki/Item:{title.replace(' ', '_')}",
    }


SITE_GEAR = Path("site/data/gear")


def main():
    slots_filter = sys.argv[1:] or None
    files = sorted(RAW.glob("*.html"))
    by_slot = {}
    fails = 0
    for f in files:
        try:
            rec = parse_file(f)
            if rec and rec["slot"] and (not slots_filter or rec["slot"] in slots_filter):
                by_slot.setdefault(rec["slot"], []).append(rec)
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f"  fail {f.name}: {type(e).__name__}: {e}")

    OUT.mkdir(parents=True, exist_ok=True)
    SITE_GEAR.mkdir(parents=True, exist_ok=True)
    index = {}
    total = 0
    for slot, items in sorted(by_slot.items()):
        items.sort(key=lambda i: (-(i["level"] or 0), i["name"]))
        (SITE_GEAR / f"{slot}.json").write_text(json.dumps(items, ensure_ascii=False))
        index[slot] = len(items)
        total += len(items)
    (SITE_GEAR / "index.json").write_text(json.dumps(index))
    print(f"parsed {len(files)} files -> {total} items across {len(by_slot)} slots, {fails} failures")
    print("per slot:", index)


if __name__ == "__main__":
    main()
