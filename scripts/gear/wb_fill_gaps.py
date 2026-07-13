#!/usr/bin/env python3
"""Fill empty gear slots in the community builds.

Two strategies per empty slot:
  1. Name-recover: the source (wb_builds.json) named the item but it didn't
     resolve (plural/spacing). Re-search with the item's own words.
  2. Set-infer: the source left the slot as "None" (Riddler's old-format links).
     If the build is a clear set build (>=3 items share a 2-word set prefix),
     fill the slot with that set's piece.

Updates site/data/presets.json + site/data/gear/wb_items.json in place.
Prints what was recovered vs inferred vs still empty.
"""
import json
import re
import time
from collections import Counter
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
        elif k == "outgoing_heal":
            out["outHealing"] = out.get("outHealing", 0) + v
    return out


def to_item(it):
    return {"id": it.get("compactShareId") or it.get("shareId"),
            "name": re.sub(r"\s+", " ", it["name"]).strip(),
            "slot": TYPE_SLOT.get(it.get("type")), "school": it.get("school"),
            "level": it.get("level"), "stats": map_stats(it.get("stats"))}


def pick(cands, slot, school, level):
    cands = [c for c in cands if TYPE_SLOT.get(c.get("type")) == slot]
    if not cands:
        return None
    cands.sort(key=lambda c: (0 if c.get("school") in (school, "Any") else 1,
                              abs((c.get("level") or 0) - (level or 999))))
    return cands[0]


def main():
    presets = json.loads(Path("site/data/presets.json").read_text())
    items = {int(k): v for k, v in presets["items"].items()}
    wb_builds = {(b["school"], b["level"]): b for b in json.loads(Path("data/gear/wb_builds.json").read_text())}

    # w101central gear dataset for best-in-slot fallback
    wiki = {}
    for slot in SLOTS:
        f = Path(f"site/data/gear/{slot}.json")
        wiki[slot] = json.loads(f.read_text()) if f.exists() else []

    def best_wiki(slot, school, level):
        cands = [i for i in wiki.get(slot, [])
                 if (i.get("level") or 0) <= level and i.get("school") in (school, "Any")
                 and i.get("stats")]
        if not cands:
            return None
        def score(i):
            s = i["stats"]
            dmg = (s.get("damage", {}).get(school, 0) + s.get("damage", {}).get("Global", 0))
            crit = (s.get("critical", {}).get(school, 0) + s.get("critical", {}).get("Global", 0))
            pierce = (s.get("pierce", {}).get(school, 0) + s.get("pierce", {}).get("Global", 0))
            return dmg * 3 + crit / 15 + pierce * 2 + (s.get("maxHealth", 0) / 300)
        cands.sort(key=score, reverse=True)
        return cands[0]

    recovered = inferred = suggested = still = 0
    for b in presets["builds"]:
        empties = [s for s in SLOTS if s not in b["gear"]]
        if not empties:
            continue
        src_gear = (wb_builds.get((b["school"], b["level"]), {}) or {}).get("gear", {})
        prefixes = Counter(" ".join(items[i]["name"].split()[:2]) for i in b["gear"].values())
        set_name = prefixes.most_common(1)[0][0] if prefixes and prefixes.most_common(1)[0][1] >= 3 else None

        for slot in empties:
            found = None
            if slot in src_gear:  # name-recover from source
                nm = re.sub(r"\s*\((?:Socketed|Triangle|Tear|Square|Circle)\)", "", src_gear[slot]["name"]).strip()
                found = pick(search(" ".join(nm.split()[:2])), slot, b["school"], src_gear[slot].get("lvl"))
                if found:
                    recovered += 1
            if not found and set_name:  # set-infer
                found = pick(search(set_name), slot, b["school"], b["level"])
                if found:
                    inferred += 1
            if found:
                it = to_item(found)
                if it["id"] is not None and it["slot"]:
                    items[it["id"]] = it
                    b["gear"][slot] = it["id"]
                continue
            # best-in-slot suggestion from w101central data (marked)
            if b["level"] >= 100:
                w = best_wiki(slot, b["school"], b["level"])
                if w:
                    key = f"wiki:{w['slug']}"
                    items[key] = {"id": key, "name": w["name"], "slot": slot, "school": w["school"],
                                  "level": w["level"], "stats": w["stats"], "suggested": True}
                    b["gear"][slot] = key
                    b.setdefault("suggested", []).append(slot)
                    suggested += 1
                    continue
            still += 1

    used = {iid: items[iid] for bb in presets["builds"] for iid in bb["gear"].values()}
    presets["items"] = used
    Path("site/data/presets.json").write_text(json.dumps(presets, ensure_ascii=False))
    Path("site/data/gear/wb_items.json").write_text(json.dumps(list(used.values()), ensure_ascii=False))
    total = sum(len(b["gear"]) for b in presets["builds"])
    print(f"recovered {recovered}, set-inferred {inferred}, still empty {still}")
    print(f"total gear slots now: {total} | items: {len(used)}")
    parts = [b for b in presets["builds"] if b["level"] >= 100 and len(b["gear"]) < 8]
    print("still partial:", " ".join(f"{b['school']}L{b['level']}:{len(b['gear'])}" for b in parts) or "none")


if __name__ == "__main__":
    main()
