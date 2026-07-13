#!/usr/bin/env python3
"""Re-resolve every WizBuilder-sourced community-build item with a COMPLETE stat
mapper (adds pip conversion, healing, stun resist, archmastery that the first pass
dropped — this is why amulets looked empty). Also fills the L30 Fire hat with its
Zeus piece. Updates site/data/presets.json + wb_items.json in place."""
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
_cache = {}


def search(q):
    if q in _cache:
        return _cache[q]
    for _ in range(2):
        try:
            _cache[q] = requests.get("https://www.wizbuilder.net/builder/items?search=" + quote(q),
                                     impersonate="chrome131", headers=H, timeout=20).json().get("data", [])
            return _cache[q]
        except Exception:  # noqa: BLE001
            time.sleep(1)
    _cache[q] = []
    return []


def map_stats(wb):
    out = {}
    def per(k, s, v):
        out.setdefault(k, {})[s] = out.get(k, {}).get(s, 0) + v
    def flat(k, v):
        out[k] = out.get(k, 0) + v
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
            flat("maxHealth", v)
        elif k == "mana":
            flat("maxMana", v)
        elif k == "power_pip_chance":
            flat("powerPipChance", v)
        elif k == "shadow_pip_rating":
            flat("shadowPipRating", v)
        elif k.startswith("pipconv_"):
            flat("pipConversion", v)
        elif k == "incoming_heal":
            flat("incHealing", v)
        elif k == "outgoing_heal":
            flat("outHealing", v)
        elif k in ("stun_resist", "stunresist"):
            flat("stunResist", v)
        elif k == "archmastery":
            flat("archmastery", v)
    return out


def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def main():
    d = json.loads(Path("site/data/presets.json").read_text())
    items = d["items"]

    # 1) fill L30 Fire hat with the Zeus Fire hat
    for b in d["builds"]:
        if b["school"] == "Fire" and b["level"] == 30 and "hat" not in b["gear"]:
            for c in search("Zeus'"):
                if TYPE_SLOT.get(c.get("type")) == "hat" and c.get("school") == "Fire" and (c.get("level") or 0) <= 32:
                    iid = c.get("compactShareId") or c.get("shareId")
                    items[str(iid)] = {"id": iid, "name": re.sub(r"\s+", " ", c["name"]).strip(),
                                       "slot": "hat", "school": "Fire", "level": c.get("level"),
                                       "stats": map_stats(c.get("stats")), "suggested": True}
                    b["gear"]["hat"] = iid
                    b.setdefault("suggested", [])
                    if "hat" not in b["suggested"]:
                        b["suggested"].append("hat")
                    print("filled Fire L30 hat:", items[str(iid)]["name"])
                    break

    # 2) refresh stats for every WizBuilder-sourced item (numeric id), by exact name
    refreshed = changed = 0
    for key, it in list(items.items()):
        if str(it.get("id", "")).startswith("wiki:"):
            continue  # our w101central-parsed items — leave as-is
        res = search(it["name"])
        hit = next((x for x in res if norm(x.get("name")) == norm(it["name"])
                    and TYPE_SLOT.get(x.get("type")) == it.get("slot")), None)
        if not hit:
            continue
        new = map_stats(hit.get("stats"))
        refreshed += 1
        if new != it.get("stats"):
            it["stats"] = new
            changed += 1
        time.sleep(0.15)

    Path("site/data/presets.json").write_text(json.dumps(d, ensure_ascii=False))
    Path("site/data/gear/wb_items.json").write_text(json.dumps(list(items.values()), ensure_ascii=False))
    withpc = sum(1 for it in items.values() if it.get("stats", {}).get("pipConversion"))
    statless = [it["name"] for it in items.values() if not it.get("stats")]
    print(f"refreshed {refreshed} items, {changed} stat blocks updated | items with pipConversion now: {withpc}")
    print(f"statless items ({len(statless)}):", statless)


if __name__ == "__main__":
    main()
