#!/usr/bin/env python3
"""Resolve each community build's gear via WizBuilder's item API (search by name),
mapping WizBuilder stat keys to our schema. Produces:
  site/data/presets.json         builds with embedded real items (name + stats)
  site/data/gear/wb_items.json   the resolved meta items (deduped)
"""
import json
import re
import time
from pathlib import Path
from urllib.parse import quote

from curl_cffi import requests

H = {"Referer": "https://www.wizbuilder.net/", "Origin": "https://www.wizbuilder.net", "Accept": "application/json"}
API = "https://www.wizbuilder.net/builder/items?search="
SCHOOL = {"F": "Fire", "I": "Ice", "S": "Storm", "L": "Life", "D": "Death", "M": "Myth", "B": "Balance", "all": "Global"}
TYPE_SLOT = {"Hats": "hat", "Robes": "robe", "Boots": "boots", "Wands": "wand",
             "Athames": "athame", "Amulets": "amulet", "Rings": "ring", "Decks": "deck"}
PER_SCHOOL = {"damage", "resist", "critical", "block", "pierce", "accuracy"}

_cache = {}


def search(name):
    if name in _cache:
        return _cache[name]
    for _ in range(3):
        try:
            r = requests.get(API + quote(name), impersonate="chrome131", headers=H, timeout=25)
            data = r.json().get("data", [])
            _cache[name] = data
            return data
        except Exception:  # noqa: BLE001
            time.sleep(2)
    _cache[name] = []
    return []


def map_stats(wb):
    """WizBuilder stat dict -> our schema."""
    out = {}

    def per(key, school, val):
        d = out.setdefault(key, {})
        d[school] = d.get(school, 0) + val

    for k, v in (wb or {}).items():
        if v in (0, None):
            continue
        m = re.match(r"^(damage|res|crit|block|pierce|acc)_([A-Za-z]+)$", k)
        if m:
            kind = {"damage": "damage", "res": "resist", "crit": "critical",
                    "block": "block", "pierce": "pierce", "acc": "accuracy"}[m.group(1)]
            sch = SCHOOL.get(m.group(2))
            if sch:
                per(kind, sch, v)
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


def nrm(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def resolve_item(name, slot, lvl, school):
    raw = re.sub(r"\s*\(Socketed\)|\s*\(Triangle\)|\s*\(Tear\)|\s*\(Square\)|\s*\(Circle\)", "", name).strip()
    target = nrm(raw)
    # search with a short prefix (WizBuilder tokenization can miss full names)
    results = search(raw)
    if not any(nrm(i["name"]) == target for i in results):
        results = search(" ".join(raw.split()[:3]))
    cands = [i for i in results if nrm(i["name"]) == target and TYPE_SLOT.get(i.get("type")) == slot]
    if not cands:
        cands = [i for i in results if nrm(i["name"]) == target]
    if not cands:  # fuzzy: same slot + all query words present
        words = target.split()
        cands = [i for i in results if TYPE_SLOT.get(i.get("type")) == slot
                 and all(w in nrm(i["name"]) for w in words)]
    if not cands:
        return None
    # prefer matching school then closest level
    cands.sort(key=lambda i: (0 if i.get("school") in (school, "Any") else 1,
                              abs((i.get("level") or 0) - (lvl or 0))))
    it = cands[0]
    return {
        "id": it.get("compactShareId") or it.get("shareId"),
        "name": it["name"], "slot": slot, "school": it.get("school"),
        "level": it.get("level"), "stats": map_stats(it.get("stats")),
        "sets": it.get("sets") or [], "setBonuses": it.get("setBonuses") or [],
    }


def main():
    builds = json.loads(Path("data/gear/wb_builds.json").read_text())
    items_by_id = {}
    out_builds = []
    for b in builds:
        gear = {}
        for slot, g in (b.get("gear") or {}).items():
            it = resolve_item(g["name"], slot, g.get("lvl"), b["school"])
            if it and it["id"] is not None:
                items_by_id[it["id"]] = it
                gear[slot] = it["id"]
        out_builds.append({"school": b["school"], "level": b["level"],
                           "gear": gear, "talents": b.get("talents") or []})
        n = len(gear)
        print(f"{b['school']} L{b['level']}: resolved {n}/{len(b.get('gear') or {})} items")

    src = {"author": "Riddler208", "title": "Optimized Gear Progression (2026)",
           "url": "https://www.reddit.com/r/Wizard101/comments/1snogxb/"}
    Path("site/data/presets.json").write_text(json.dumps(
        {"source": src, "items": items_by_id, "builds": out_builds}, ensure_ascii=False))
    Path("site/data/gear/wb_items.json").write_text(json.dumps(list(items_by_id.values()), ensure_ascii=False))
    total = sum(len(b["gear"]) for b in out_builds)
    print(f"\n{len(out_builds)} builds | {len(items_by_id)} unique items | {total} gear slots resolved")


if __name__ == "__main__":
    main()
