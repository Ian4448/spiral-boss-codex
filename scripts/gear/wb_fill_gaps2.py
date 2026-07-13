#!/usr/bin/env python3
"""Fill remaining empty slots in low-level community builds using Riddler's OWN
gear sets, resolved via WizBuilder.

For each empty slot we search WizBuilder for the sets already present in the build
(e.g. a build using "Bygone Fire Tiki" implies the "Bygone Fire" set, whose boots
are "Bygone Fire Boots") plus a couple of level-canonical sets, and pick the piece
matching the empty slot + school + level. Fills are marked suggested:True.

Slots with no level-appropriate gear (e.g. a level-5 amulet — you don't have one
yet) are left empty by design. Updates site/data/presets.json + wb_items.json.
"""
import json
import re
import time
from pathlib import Path
from urllib.parse import quote

from curl_cffi import requests

H = {"Referer": "https://www.wizbuilder.net/", "Origin": "https://www.wizbuilder.net", "Accept": "application/json"}
SCHOOL = {"F": "Fire", "I": "Ice", "S": "Storm", "L": "Life", "D": "Death", "M": "Myth", "B": "Balance", "all": "Global"}
TYPE_SLOT = {"Hats": "hat", "Robes": "robe", "Boots": "boots", "Wands": "wand",
             "Athames": "athame", "Amulets": "amulet", "Rings": "ring", "Decks": "deck"}
SLOTS = ["hat", "robe", "boots", "wand", "athame", "amulet", "ring", "deck"]
_cache = {}


def search(q):
    if q in _cache:
        return _cache[q]
    for _ in range(2):
        try:
            r = requests.get("https://www.wizbuilder.net/builder/items?search=" + quote(q),
                             impersonate="chrome131", headers=H, timeout=25)
            _cache[q] = r.json().get("data", [])
            return _cache[q]
        except Exception:  # noqa: BLE001
            time.sleep(1)
    _cache[q] = []
    return []


def map_stats(wb):
    out = {}
    def per(k, s, v):
        out.setdefault(k, {})[s] = out.get(k, {}).get(s, 0) + v
    for k, v in (wb or {}).items():
        if not v:
            continue
        m = re.match(r"^(damage|res|crit|block|pierce|acc)_([A-Za-z]+)$", k)
        if m:
            kind = {"damage": "damage", "res": "resist", "crit": "critical", "block": "block",
                    "pierce": "pierce", "acc": "accuracy"}[m.group(1)]
            s = SCHOOL.get(m.group(2))
            if s:
                per(kind, s, v)
        elif k == "hp":
            out["maxHealth"] = out.get("maxHealth", 0) + v
        elif k == "mana":
            out["maxMana"] = out.get("maxMana", 0) + v
        elif k == "power_pip_chance":
            out["powerPipChance"] = out.get("powerPipChance", 0) + v
        elif k == "shadow_pip_rating":
            out["shadowPipRating"] = out.get("shadowPipRating", 0) + v
        elif k == "incoming_heal":
            out["incHealing"] = out.get("incHealing", 0) + v
    return out


def to_item(it):
    return {"id": it.get("compactShareId") or it.get("shareId"),
            "name": re.sub(r"\s+", " ", it["name"]).strip(),
            "slot": TYPE_SLOT.get(it.get("type")), "school": it.get("school"),
            "level": it.get("level"), "stats": map_stats(it.get("stats"))}


def set_prefixes(items, school, level):
    """Candidate set-name queries to search WizBuilder for missing pieces."""
    pref = set()
    for it in items:
        words = it["name"].split()
        if len(words) >= 2:
            pref.add(" ".join(words[:2]))
        pref.add(words[0])
    # level-canonical Bazaar / crafted sets Riddler uses
    if 55 <= level <= 66:
        pref.add(f"Bygone {school}")
    if 26 <= level <= 34:
        pref.add("Zeus'")
    return {p for p in pref if len(p) > 3}


def main():
    presets = json.loads(Path("site/data/presets.json").read_text())
    items = {}
    for k, v in presets["items"].items():
        items[k] = v
    builds = presets["builds"]

    filled = still = 0
    detail = []
    for b in builds:
        empties = [s for s in SLOTS if s not in b["gear"]]
        if not empties:
            continue
        present = [items[str(i)] if str(i) in items else items.get(i) for i in b["gear"].values()]
        present = [p for p in present if p]
        prefixes = set_prefixes(present, b["school"], b["level"])
        for slot in empties:
            best = None
            for pref in prefixes:
                for c in search(pref):
                    if TYPE_SLOT.get(c.get("type")) != slot:
                        continue
                    if c.get("school") not in (b["school"], "Any"):
                        continue
                    lv = c.get("level") or 0
                    if lv > b["level"]:
                        continue
                    score = (1 if c.get("school") == b["school"] else 0, lv)
                    if best is None or score > best[0]:
                        best = (score, c)
                time.sleep(0.15)
            if best:
                it = to_item(best[1])
                if it["id"] is not None and it["slot"]:
                    it["suggested"] = True
                    items[str(it["id"])] = it
                    b["gear"][slot] = it["id"]
                    b.setdefault("suggested", [])
                    if slot not in b["suggested"]:
                        b["suggested"].append(slot)
                    filled += 1
                    detail.append(f"{b['school']}L{b['level']}/{slot}={it['name']}")
                    continue
            still += 1

    used = {}
    for bb in builds:
        for iid in bb["gear"].values():
            k = str(iid)
            if k in items:
                used[k] = items[k]
            elif iid in items:
                used[k] = items[iid]
    presets["items"] = used
    Path("site/data/presets.json").write_text(json.dumps(presets, ensure_ascii=False))
    Path("site/data/gear/wb_items.json").write_text(json.dumps(list(used.values()), ensure_ascii=False))
    total = sum(len(b["gear"]) for b in builds)
    print(f"filled {filled} new slots, {still} still empty (no level-appropriate gear)")
    print("filled:", " ".join(detail))
    print(f"total gear slots now: {total}")
    part = [(b["school"], b["level"], len(b["gear"])) for b in builds if len(b["gear"]) < 8]
    print("still partial:", " ".join(f"{s}L{l}:{n}" for s, l, n in sorted(part)))


if __name__ == "__main__":
    main()
