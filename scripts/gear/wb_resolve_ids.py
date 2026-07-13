#!/usr/bin/env python3
"""Rebuild community-build presets from captured WizBuilder item IDs (reliable —
IDs come straight from each build, no name matching). Fetches each item by ID,
maps stats to our schema, assigns to slots by item type.

Output: site/data/presets.json, site/data/gear/wb_items.json
"""
import json
import re
import time
from pathlib import Path

from curl_cffi import requests

H = {"Referer": "https://www.wizbuilder.net/", "Origin": "https://www.wizbuilder.net", "Accept": "application/json"}
SCHOOL = {"F": "Fire", "I": "Ice", "S": "Storm", "L": "Life", "D": "Death", "M": "Myth", "B": "Balance", "all": "Global"}
TYPE_SLOT = {"Hats": "hat", "Robes": "robe", "Boots": "boots", "Wands": "wand",
             "Athames": "athame", "Amulets": "amulet", "Rings": "ring", "Decks": "deck"}


def fetch_ids(ids):
    out = {}
    for i in range(0, len(ids), 45):
        batch = ids[i:i + 45]
        for _ in range(3):
            try:
                r = requests.get("https://www.wizbuilder.net/builder/items/by-compact-share-ids?ids="
                                 + ",".join(map(str, batch)), impersonate="chrome131", headers=H, timeout=30)
                for it in r.json().get("data", []):
                    out[it.get("compactShareId") or it.get("shareId")] = it
                break
            except Exception:  # noqa: BLE001
                time.sleep(2)
        time.sleep(0.2)
    return out


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


_search_cache = {}


def search_name(name):
    if name in _search_cache:
        return _search_cache[name]
    from urllib.parse import quote
    for _ in range(2):
        try:
            r = requests.get("https://www.wizbuilder.net/builder/items?search=" + quote(name),
                             impersonate="chrome131", headers=H, timeout=25)
            _search_cache[name] = r.json().get("data", [])
            return _search_cache[name]
        except Exception:  # noqa: BLE001
            time.sleep(1)
    _search_cache[name] = []
    return []


def nrm(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def resolve_by_name(gname, slot, school):
    raw = re.sub(r"\s*\((?:Socketed|Triangle|Tear|Square|Circle)\)", "", gname["name"]).strip()
    target = nrm(raw)
    results = search_name(raw)
    if not any(nrm(i["name"]) == target for i in results):
        results = search_name(" ".join(raw.split()[:3]))
    cands = [i for i in results if nrm(i["name"]) == target and TYPE_SLOT.get(i.get("type")) == slot]
    if not cands:
        words = target.split()
        cands = [i for i in results if TYPE_SLOT.get(i.get("type")) == slot
                 and all(w in nrm(i["name"]) for w in words)]
    if not cands:
        return None
    lvl = gname.get("lvl") or 0
    cands.sort(key=lambda i: (0 if i.get("school") in (school, "Any") else 1, abs((i.get("level") or 0) - lvl)))
    return cands[0]


def main():
    build_ids = json.loads(Path("data/gear/wb_build_ids.json").read_text())
    wb_builds = {(b["school"], b["level"]): b for b in json.loads(Path("data/gear/wb_builds.json").read_text())}

    all_ids = sorted({i for b in build_ids for i in b["ids"]})
    print(f"fetching {len(all_ids)} unique items…")
    raw = fetch_ids(all_ids)

    items = {}
    def add_item(it):
        iid = it.get("compactShareId") or it.get("shareId")
        slot = TYPE_SLOT.get(it.get("type"))
        if not slot:
            return None
        items[iid] = {"id": iid, "name": re.sub(r"\s+", " ", it["name"]).strip(),
                      "slot": slot, "school": it.get("school"), "level": it.get("level"),
                      "stats": map_stats(it.get("stats")), "sets": it.get("sets") or []}
        return iid, slot

    for it in raw.values():
        add_item(it)

    out_builds = []
    for b in build_ids:
        gear = {}
        for iid in b["ids"]:
            it = items.get(iid)
            if it:
                gear[it["slot"]] = iid
        # name-resolution fallback for any missing gear slot
        src = wb_builds.get((b["school"], b["level"]), {})
        for slot, gname in (src.get("gear") or {}).items():
            if slot in gear:
                continue
            found = resolve_by_name(gname, slot, b["school"])
            if found:
                res = add_item(found)
                if res:
                    gear[res[1]] = res[0]
        out_builds.append({"school": b["school"], "level": b["level"], "gear": gear,
                           "talents": src.get("talents") or []})
        print(f"{b['school']} L{b['level']}: {len(gear)}/8 gear slots")

    src = {"author": "Riddler208", "title": "Optimized Gear Progression (2026)",
           "url": "https://www.reddit.com/r/Wizard101/comments/1snogxb/"}
    used = {iid: items[iid] for b in out_builds for iid in b["gear"].values()}
    Path("site/data/presets.json").write_text(json.dumps(
        {"source": src, "items": used, "builds": out_builds}, ensure_ascii=False))
    Path("site/data/gear/wb_items.json").write_text(json.dumps(list(used.values()), ensure_ascii=False))
    total = sum(len(b["gear"]) for b in out_builds)
    print(f"\n{len(out_builds)} builds | {len(used)} items | {total} gear slots resolved")


if __name__ == "__main__":
    main()
