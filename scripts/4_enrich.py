#!/usr/bin/env python3
"""Stage 4: tag each boss's cheats against a taxonomy and generate a short
"how to fight" strategy summary. Reads data/bosses.json, writes
site/public/data/bosses.json (records the site consumes).

Rule-based on purpose: ~1,500 summaries stay consistent, auditable, and free to
regenerate. Hand-curated overrides can be dropped in data/overrides/<slug>.json.

Run with --audit to print tag frequencies and a sample of untagged cheat
paragraphs (for tuning the rules).
"""
import json
import re
import sys
from pathlib import Path

SRC = Path("data/bosses.json")
OUT = Path("site/data/bosses.json")
OVERRIDES = Path("data/overrides")

# Each rule: tag id -> (label, [regexes over one cheat paragraph], advice)
# "Wizard ... casts" proximity distinguishes punish-cheats (reacting to the
# player) from the boss simply casting something itself.
WIZ = r"(?:wizards?|players?|you)"
CAST = r"(?:casts?|casting|plays?|uses?|using)"

RULES = {
    "punishes-blades": dict(
        label="Punishes blades",
        pats=[
            rf"\b{WIZ}\b[^.]{{0,80}}\b{CAST}\b[^.]{{0,60}}\b(?:blades?|charms?)\b",
            rf"\b(?:blades?|charms?)\b[^.]{{0,40}}\b(?:is|are)\s+cast",
            rf"\bany\s+(?:positive\s+)?charms?\b[^.]{{0,60}}\b(?:cast|placed|played)",
        ],
        advice="Don't stack blades — each one gets punished. Rely on traps, auras, and raw damage instead, or accept one counter per blade and shield through it.",
    ),
    "removes-charms": dict(
        label="Removes/steals blades",
        pats=[
            r"\b(?:removes?|steals?|destroys?|takes?)\b[^.]{0,50}\b(?:blades?|charms?)\b",
            r"\b(?:blades?|charms?)\b[^.]{0,40}\b(?:removed|stolen|destroyed)\b",
        ],
        advice="Blades won't stick around — cast setup the same round you plan to use it, or skip blades entirely.",
    ),
    "punishes-traps": dict(
        label="Punishes traps",
        pats=[
            rf"\b{WIZ}\b[^.]{{0,80}}\b{CAST}\b[^.]{{0,60}}\b(?:traps?|wards?|feint)\b",
            r"\b(?:traps?|feint)\b[^.]{0,40}\b(?:is|are)\s+(?:cast|placed|put)",
        ],
        advice="Trapping triggers a counter — leave Feint-stacking at home and lean on blades or unbuffed spam.",
    ),
    "removes-traps": dict(
        label="Removes traps",
        pats=[
            r"\b(?:removes?|steals?|destroys?|clears?|cleanses?)\b[^.]{0,50}\b(?:traps?|wards?)\b",
            r"\b(?:traps?|wards?)\b[^.]{0,40}\b(?:removed|destroyed|cleansed)\b",
        ],
        advice="Traps get wiped — place them the same round you hit, or skip traps for blades and auras.",
    ),
    "punishes-heals": dict(
        label="Punishes healing",
        pats=[
            rf"\b{WIZ}\b[^.]{{0,80}}\b(?:heals?\b|healing\b|{CAST}[^.]{{0,40}}\bheal(?:s|ing)?\b)",
            r"\bhealing\s+spells?\b[^.]{0,60}\b(?:triggers?|counters?|will|casts?)",
            r"\b(?:if|when)\b[^.]{0,40}\bheal(?:s|ing|ed)?\b",
        ],
        advice="Healing is taxed — heal only when you can survive the counter, favor big single heals over spam, and pack resist or absorbs.",
    ),
    "punishes-shields": dict(
        label="Punishes shields",
        pats=[
            rf"\b{WIZ}\b[^.]{{0,80}}\b{CAST}\b[^.]{{0,60}}\b(?:shields?|absorbs?|tower shield)\b",
            r"\bshields?\b[^.]{0,40}\b(?:is|are)\s+cast",
        ],
        advice="Turtling gets punished — win faster instead of shielding up.",
    ),
    "removes-shields": dict(
        label="Removes shields",
        pats=[
            r"\b(?:removes?|destroys?|pierces?|steals?)\b[^.]{0,50}\b(?:shields?|wards?|absorbs?)\b",
        ],
        advice="Shields don't last — don't budget your survival around them.",
    ),
    "punishes-low-pip": dict(
        label="Punishes low-pip spells",
        pats=[
            r"\b(?:fewer|less)\s+than\s+\w+\s+pips?\b",
            r"\b(?:zero|0|one|1|two|2|three|3)[- ]pip\s+spells?\b",
            r"\blow[- ]pip\b",
            r"\bspells?\s+costing\b[^.]{0,30}\bpips?\b",
        ],
        advice="Cheap spells trigger the cheat — build a lean deck of big hits and avoid wand flicks and low-pip utility.",
    ),
    "punishes-shadow": dict(
        label="Punishes shadow magic",
        pats=[
            rf"\b{WIZ}\b[^.]{{0,80}}\b{CAST}\b[^.]{{0,60}}\bshadow(?:[- ]enhanced)?\s+spells?\b",
            r"\bshadow\s+(?:spell|magic|creature|form)s?\b[^.]{0,50}\b(?:triggers?|counters?|punish)",
        ],
        advice="Leave shadow-enhanced spells out of the deck for this one.",
    ),
    "punishes-globals": dict(
        label="Punishes/controls globals",
        pats=[
            r"\bglobal\s+spells?\b",
        ],
        advice="Global spells matter here — either keep the boss's preferred global up or don't contest it.",
    ),
    "punishes-auras": dict(
        label="Punishes auras",
        pats=[
            rf"\b{WIZ}\b[^.]{{0,80}}\b{CAST}\b[^.]{{0,50}}\bauras?\b",
            r"\bauras?\b[^.]{0,30}\b(?:is|are)\s+cast",
        ],
        advice="Auras trigger a response — check which auras are safe before committing.",
    ),
    "round-interrupt": dict(
        label="Interrupts on a timer",
        pats=[
            r"\b(?:at the (?:beginning|start|end) of)\s+(?:each|every)\b",
            r"\bevery\s+(?:[\w()]+\s+){0,3}rounds?\b",
            r"\beach\s+round\b",
            r"\bduring\s+round\s+\d",
            r"\bon\s+the\s+\w+\s+round\b",
            r"\bfirst\s+round\b[^.]{0,60}\bcasts?\b",
            r"\binterrupts?\b",
        ],
        advice="Expect scripted casts on a round timer — count rounds and budget shields/heals around the interrupts.",
    ),
    "damage-threshold": dict(
        label="Health-threshold trigger",
        pats=[
            r"\b(?:below|less than|reaches|reduced (?:to|below)|drops? (?:to|below))\s+[\d,]+%?\s*(?:health|hp)?\b[^.]{0,30}\b(?:health|hp)?",
            r"\bat\s+\d+%\s+health\b",
            r"\bhealth\s+(?:falls|drops|is reduced)\b",
        ],
        advice="Something changes at a health threshold — plan to burst through it in one round rather than poking across it.",
    ),
    "kill-order": dict(
        label="Kill order matters",
        pats=[
            r"\b(?:must be defeated|defeated? (?:first|last|before))\b",
            r"\brespawns?\b",
            r"\bresurrects?\b",
        ],
        advice="Targets must die in the right order — coordinate the team and confirm the kill order before hitting.",
    ),
    "punishes-late-join": dict(
        label="Punishes joining late",
        pats=[r"\bjoins?\s+the\s+(?:duel|battle|fight)\s+(?:late|after)\b", r"\bjoin(?:s|ing)?\s+late\b",
              r"\blate\s+to\s+(?:combat|the\s+(?:duel|battle|fight))\b"],
        advice="Everyone enters the fight together — no fleeing and re-joining mid-battle.",
    ),
    "cheat-heals-self": dict(
        label="Heals itself",
        pats=[
            r"\bheals?\s+(?:himself|herself|itself|themselves|to full)\b",
            r"\brestores?\b[^.]{0,30}\bhealth\b",
            r"\bregains?\b[^.]{0,30}\bhealth\b",
        ],
        advice="The boss can heal — bring healing reduction (Doom and Gloom, infections) or enough burst to outpace it.",
    ),
    "stuns-players": dict(
        label="Stuns/beguiles players",
        pats=[r"\bstuns?\b", r"\bbeguiles?\b", r"\bconfuses?\b"],
        advice="Pack stun blocks (or plan around lost turns) — the boss can stun or beguile your team.",
    ),
    "dispels": dict(
        label="Uses dispels",
        pats=[r"\bdispels?\b"],
        advice="Expect dispels — carry off-school hits or cheap spells to burn them off.",
    ),
    "steals-pips": dict(
        label="Drains pips",
        pats=[r"\b(?:steals?|takes?|removes?|drains?)\b[^.]{0,30}\bpips?\b"],
        advice="Your pips aren't safe — spend them rather than banking toward one giant hit.",
    ),
    "summons-minions": dict(
        label="Summons reinforcements",
        pats=[
            r"\b(?:spawns?|summons?)\b[^.]{0,50}\bminions?\b",
            r"\bminions?\b[^.]{0,30}\b(?:spawn|appear|join)\b",
        ],
        advice="Reinforcements arrive mid-fight — save an AoE or burst for the minion waves instead of dumping everything on the boss.",
    ),
    "requires-attacking": dict(
        label="Punishes passivity",
        pats=[
            r"\b(?:is\s+)?not\s+attacked\b",
            r"\b(?:does\s+not|doesn't|fails?\s+to)\s+attack\b",
            r"\bmust\s+(?:be\s+)?attack",
        ],
        advice="The boss punishes passive rounds — keep chip damage coming even while you set up.",
    ),
    "punishes-dot": dict(
        label="Punishes damage-over-time",
        pats=[rf"\b{WIZ}\b[^.]{{0,80}}\b{CAST}\b[^.]{{0,60}}\b(?:damage over time|dot)\b"],
        advice="Damage-over-time spells trigger a response — favor single big hits.",
    ),
}

SCHOOL_OPPOSITE = {
    "Fire": "Ice", "Ice": "Fire", "Storm": "Myth", "Myth": "Storm",
    "Life": "Death", "Death": "Life",
}

# Icon tokens that add no information once the stat sits in a labeled tile
# ("Critical: 182 [Any][Critical]" -> "Critical: 182"). School tokens stay —
# the UI renders them as colored chips.
META_TOKEN = re.compile(
    r"\[(?:Any|Critical Block|Critical|Resistance|Damage|Armor Piercing|"
    r"Outgoing|Incoming|Healing|Pip|Power Pip|Shadow Pip)\]"
)
SCHOOL_TOKEN = re.compile(r"\[(?:Fire|Ice|Storm|Myth|Life|Death|Balance|Shadow|Sun|Moon|Star)\]")


def clean_stat(val: str) -> str:
    v = META_TOKEN.sub("", val)
    if len(SCHOOL_TOKEN.findall(v)) >= 8:
        v = re.sub(r"(?:%s\s*)+" % SCHOOL_TOKEN.pattern, "all schools", v)
    v = re.sub(r"\s+", " ", v).strip()
    v = re.sub(r"\s*/\s*$", "", v)          # "5 /" -> "5"
    v = re.sub(r"^\s*/\s*|\s*to\s*$", "", v)
    v = re.sub(r"\](?=\s*\d)", "], ", v)    # "[Shadow]71% to" -> "[Shadow], 71% to"
    return v.strip()


def tag_cheats(cheats):
    tags = set()
    per_tag_evidence = {}
    for raw_para in cheats:
        # [bracketed] tokens are icon alt-texts (spell cards etc.) — spell NAMES
        # like "Anti-Steal Charm" must not trigger behavior tags.
        para = re.sub(r"\[[^\]]*\]", " ", raw_para)
        for tag, rule in RULES.items():
            if tag in tags:
                continue
            for pat in rule["pats"]:
                if re.search(pat, para, re.IGNORECASE):
                    tags.add(tag)
                    per_tag_evidence[tag] = para
                    break
    return sorted(tags), per_tag_evidence


def gen_strategy(boss, tags):
    """Fallback plan for bosses without a curated override. Returns a list of
    steps framed around the core PvE loop: stack blades/traps, then one big hit."""
    school = boss.get("school")
    steps = []

    if not boss.get("hasCheats") and not boss.get("cheats"):
        s = "No cheats — standard fight: stack blades, then hit."
        if school in SCHOOL_OPPOSITE:
            s += f" Use {SCHOOL_OPPOSITE[school]} damage (boosted); avoid {school} into its resist."
        return [s]

    # setup step: is the normal blade/trap opening safe?
    if "punishes-blades" in tags or "removes-charms" in tags:
        steps.append("Blades get punished or stolen here — protect each blade with Aegis (one per cheat), or skip blade-stacking and hit unbuffed.")
    elif "punishes-traps" in tags or "removes-traps" in tags:
        steps.append("Blades are safe but traps are not — stack blades as usual and protect any Feint with Indemnity, or drop traps the same round you hit.")
    else:
        steps.append("Standard opening works: stack blades and a Feint, then break with one big hit.")

    secondary = ["punishes-heals", "punishes-low-pip", "punishes-shadow", "punishes-shields",
                 "punishes-auras", "punishes-globals", "punishes-dot", "requires-attacking",
                 "kill-order", "damage-threshold", "round-interrupt", "punishes-late-join",
                 "summons-minions", "cheat-heals-self", "steals-pips", "stuns-players", "dispels"]
    for t in secondary:
        if t in tags and len(steps) < 5:
            steps.append(RULES[t]["advice"])

    if school in SCHOOL_OPPOSITE:
        steps.append(f"Hit with {SCHOOL_OPPOSITE[school]} damage (boosted); don't bring {school} into its resist.")

    stats = boss.get("stats", {})
    minions = boss.get("minions") or []
    if minions and "kill-order" not in tags:
        steps.append(f"{len(minions)} minion{'s' if len(minions) != 1 else ''} in the fight — open with an AoE hit so setup kills everything at once.")
    if stats.get("stunable", "").lower().startswith("yes"):
        steps.append("The boss is stunnable — a well-timed stun buys a free setup round.")
    return steps[:6]


def load_override(slug: str):
    f = OVERRIDES / f"{slug}.json"
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text())
    except json.JSONDecodeError:
        print(f"warning: bad override JSON for {slug}")
        return None


def load_guides():
    """Map boss slug -> Final Bastion guide {url, title}. Prefers the curated
    slug-keyed map; falls back to fuzzy matching the legacy `match` file."""
    by_slug_file = Path("data/guides_by_slug.json")
    if by_slug_file.exists():
        return json.loads(by_slug_file.read_text())
    f = Path("data/finalbastion_guides.json")
    if not f.exists():
        return {}
    guides = json.loads(f.read_text())
    bosses = json.loads(SRC.read_text())
    by_slug = {}
    for g in guides:
        needle = g["match"].lower().replace("'", "")
        needle_slug = re.sub(r"[^a-z0-9]+", "_", needle).strip("_")
        best = None
        for b in bosses:
            name = (b["name"] or "").lower().replace("'", "")
            slug = b["slug"].lower()
            if needle == name or needle_slug == slug or needle in name:
                if best is None or (b.get("health") or 0) > (best.get("health") or 0):
                    best = b
        if best:
            by_slug[best["slug"]] = {"url": g["url"], "title": g["title"]}
    return by_slug


def main():
    audit = "--audit" in sys.argv
    bosses = json.loads(SRC.read_text())
    guides = load_guides()
    if audit:
        print(f"matched {len(guides)} Final Bastion guides to bosses")
    OUT.parent.mkdir(parents=True, exist_ok=True)

    tag_counts = {}
    untagged_samples = []
    out = []
    for b in bosses:
        b["stats"] = {k: clean_stat(v) for k, v in (b.get("stats") or {}).items()}
        tags, _ev = tag_cheats(b.get("cheats", []))
        for t in tags:
            tag_counts[t] = tag_counts.get(t, 0) + 1
        if b.get("cheats") and not tags:
            untagged_samples.append((b["name"], b["cheats"][0][:200]))

        ov = load_override(b["slug"]) or {}
        strategy = ov.get("strategy")
        if isinstance(strategy, str):
            strategy = [strategy]
        # per-cheat plain-language notes only apply if they still line up with
        # the parsed cheat list (a re-crawl can change it)
        cheat_notes = ov.get("cheatNotes")
        if cheat_notes and len(cheat_notes) != len(b.get("cheats", [])):
            cheat_notes = None
        rec = {**b, "tags": tags, "tagLabels": [RULES[t]["label"] for t in tags],
               "strategy": strategy or gen_strategy(b, tags),
               "cheatNotes": cheat_notes,
               "groupFight": ov.get("groupFight", False),
               "curated": bool(strategy),
               "guideSourced": ov.get("guideSourced", False),
               "guide": guides.get(b["slug"])}
        rec.pop("categories", None)
        out.append(rec)

    out.sort(key=lambda b: (not bool(b["cheats"]), b["name"]))
    OUT.write_text(json.dumps(out, ensure_ascii=False))
    n_cheat = sum(1 for b in out if b["cheats"])
    print(f"enriched {len(out)} bosses ({n_cheat} with cheats) -> {OUT}")
    if audit:
        print("\ntag frequencies:")
        for t, c in sorted(tag_counts.items(), key=lambda kv: -kv[1]):
            print(f"  {t:24s} {c}")
        print(f"\nuntagged-with-cheats: {len(untagged_samples)}")
        for name, para in untagged_samples[:10]:
            print(f"  - {name}: {para}")


if __name__ == "__main__":
    main()
