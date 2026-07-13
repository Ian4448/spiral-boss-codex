#!/usr/bin/env python3
"""Map WizBuilder build gear (names) to our item dataset (slugs), producing
native, loadable community presets. Reports unmatched items.

Output: site/data/presets.json  (builds with resolved item slugs per slot)
        data/gear/wb_unmatched.json
"""
import json
import re
from pathlib import Path

GEAR = Path("site/data/gear")


def norm(name):
    n = name.lower()
    n = re.sub(r"\(socketed\)|\(lvl\s*\d+\)", "", n)
    n = re.sub(r"[^a-z0-9]+", "", n)
    return n


def load_slot_index(slot):
    f = GEAR / f"{slot}.json"
    if not f.exists():
        return {}
    idx = {}
    for it in json.loads(f.read_text()):
        idx.setdefault(norm(it["name"]), []).append(it)
    return idx


# pet talent id map (matches PET_TALENTS in build.js)
TALENT_ID = {
    "pain-giver": "paingiver", "pain-bringer": "painbringer", "spell-proof": "spellproof",
    "spell-defying": "spelldefy", "spell-defy": "spelldefy", "armor breaker": "mightypierce",
    "mighty": "mightypierce", "sharp shot": "sharpshot", "accurate": "sharpshot",
    "critical striker": "critical", "critical hitter": "critical", "pip o'matic": "pipomatic",
    "pip-o-matic": "pipomatic",
}


def talent_id(name):
    return TALENT_ID.get(name.strip().lower())


def main():
    builds = json.loads(Path("data/gear/wb_builds.json").read_text())
    slot_idx = {s: load_slot_index(s) for s in ("hat", "robe", "boots", "wand", "athame", "amulet", "ring", "deck")}

    out, unmatched = [], []
    for b in builds:
        gear = {}
        for slot, item in (b.get("gear") or {}).items():
            cands = slot_idx.get(slot, {}).get(norm(item["name"]), [])
            if not cands:
                unmatched.append({"school": b["school"], "level": b["level"], "slot": slot,
                                  "name": item["name"], "lvl": item.get("lvl")})
                continue
            # prefer the variant whose level bracket matches the wb item level
            wl = item.get("lvl") or 0
            best = min(cands, key=lambda c: abs((c.get("level") or 0) - wl))
            gear[slot] = best["slug"]
        talents = [t for t in (talent_id(x) for x in (b.get("talents") or [])) if t]
        out.append({"school": b["school"], "level": b["level"], "url": b["url"],
                    "gear": gear, "talents": talents})

    src = {"author": "Riddler208", "title": "Optimized Gear Progression (2026)",
           "url": "https://www.reddit.com/r/Wizard101/comments/1snogxb/"}
    (GEAR.parent / "presets.json").write_text(json.dumps({"source": src, "builds": out}, ensure_ascii=False))
    Path("data/gear/wb_unmatched.json").write_text(json.dumps(unmatched, indent=1, ensure_ascii=False))

    total_slots = sum(len(b.get("gear") or {}) for b in builds)
    matched = sum(len(b["gear"]) for b in out)
    print(f"builds: {len(out)} | gear slots: {total_slots} | matched: {matched} | unmatched: {len(unmatched)}")
    # unmatched breakdown by level tier
    from collections import Counter
    by_lvl = Counter(u["level"] for u in unmatched)
    print("unmatched by level:", dict(sorted(by_lvl.items())))
    # fully-resolved builds (all slots matched)
    full = [b for b in out if b["gear"] and len(b["gear"]) == len(next(x for x in builds if x["school"] == b["school"] and x["level"] == b["level"]).get("gear") or {})]
    print(f"fully-resolved builds: {len(full)}/{len(out)}")


if __name__ == "__main__":
    main()
