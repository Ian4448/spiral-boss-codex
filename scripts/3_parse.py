#!/usr/bin/env python3
"""Stage 3: parse cached wiki HTML (data/raw/*.html) into data/bosses.json.

Keeps only pages whose wgCategories include "Boss". Defensive against template
variance across snapshot years; logs parse failures instead of dropping silently.
"""
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

RAW_DIR = Path("data/raw")
OUT = Path("data/bosses.json")
FAIL_LOG = Path("data/parse_failures.json")

SCHOOLS = ["Fire", "Ice", "Storm", "Myth", "Life", "Death", "Balance", "Shadow", "Sun", "Moon", "Star"]

STAT_LABELS = {
    "Shadow Pips": "shadowPips",
    "Starting Pips": "startingPips",
    "Critical Rating": "critical",
    "Critical Block Rating": "criticalBlock",
    "Outgoing Pierce": "pierce",
    "Outgoing Boost": "outgoingBoost",
    "Incoming Boost": "incomingBoost",
    "Incoming Resist": "resist",
    "Outgoing Healing": "outgoingHealing",
    "Incoming Healing": "incomingHealing",
    "Stunable": "stunable",
    "Beguilable": "beguilable",
}


def js_config(raw: str, key: str):
    m = re.search(r'"%s":\s*(\[.*?\]|"(?:[^"\\]|\\.)*"|true|false|\d+)' % re.escape(key), raw, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def clean_alt(alt: str) -> str:
    alt = re.sub(r"^\((?:Spell|Icon|Target|Item)\)[ _]*", "", alt)
    return re.sub(r"\.(?:png|jpg|gif)$", "", alt).replace("_", " ").strip()


def cell_text(td) -> str:
    # Represent inline school/pip icons by their alt text so values like
    # "70% to [Ice]" stay meaningful.
    parts = []
    for el in td.descendants:
        if el.name == "img" and el.get("alt"):
            alt = clean_alt(el["alt"])
            if alt:
                parts.append(f"[{alt}]")
        elif isinstance(el, str):
            parts.append(el)
    return clean("".join(parts))


def parse_infobox(soup):
    info = {}
    stats = {}
    minions, summons, locations = [], [], []
    world = None
    for table in soup.find_all("table"):
        header = table.find("b", string="Rank")
        if not header:
            continue
        section = None
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) == 1 or (tds and tds[0].get("colspan")):
                section = clean(tds[0].get_text())
                continue
            if len(tds) != 2:
                continue
            label_el = tds[0].find("b")
            if not label_el:
                continue
            label = clean(label_el.get_text())
            value_td = tds[1]
            if section and section.startswith("Location"):
                w = clean(tds[0].get_text())
                if w and not world:
                    world = w
                loc = cell_text(value_td)
                if loc:
                    locations.append((w, loc))
                continue
            if label in ("Minions", "Summons"):
                names = [clean(a.get_text()) for a in value_td.find_all("a") if clean(a.get_text())]
                (minions if label == "Minions" else summons).extend(names)
            elif label == "School":
                imgs = value_td.find_all("img")
                if imgs and imgs[0].get("alt"):
                    info["school"] = clean_alt(imgs[0]["alt"])
                else:
                    a = value_td.find("a")
                    info["school"] = clean(a.get("title", a.get_text())) if a else cell_text(value_td)
            elif label in STAT_LABELS:
                stats[STAT_LABELS[label]] = cell_text(value_td)
            elif label == "Rank":
                info["rankText"] = cell_text(value_td)
            elif label == "Health":
                info["healthText"] = cell_text(value_td)
            elif label == "Classification":
                info["classification"] = cell_text(value_td)
            elif label == "Cheats":
                info["hasCheats"] = cell_text(value_td).lower().startswith("y")
        break
    return info, stats, minions, summons, world, locations


def section_items(soup, heading_text):
    """Collect text blocks under an infobox-plain-heading, deduped (page renders
    desktop + mobile copies of the same sections)."""
    items, seen = [], set()
    for p in soup.find_all("p", class_="infobox-plain-heading"):
        if clean(p.get_text()) != heading_text:
            continue
        container = p.parent
        for el in container.find_all(["p", "li"]):
            if el is p or el.find(["ul", "ol"]):
                # skip wrapper li that only holds a sub-list; sub-items collected directly
                txt_own = clean("".join(t for t in el.find_all(string=True, recursive=False)))
                if not txt_own:
                    continue
            if el.name == "p" and "infobox-plain-heading" in (el.get("class") or []):
                continue
            txt = cell_text(el)
            # For li with nested list, keep only its own leading text
            if el.find(["ul", "ol"]):
                sub = el.find(["ul", "ol"])
                sub_text = cell_text(sub)
                if sub_text and txt.endswith(sub_text):
                    txt = clean(txt[: -len(sub_text)])
            if txt and txt not in seen:
                seen.add(txt)
                items.append(txt)
    return items


def parse_file(path: Path):
    raw = path.read_text(encoding="utf-8", errors="replace")
    cats = js_config(raw, "wgCategories") or []
    if "Boss" not in cats:
        return "not-boss", None
    if js_config(raw, "wgIsRedirect"):
        return "redirect", None

    title = js_config(raw, "wgTitle") or path.stem.replace("_", " ")
    page_name = js_config(raw, "wgPageName") or ("Creature:" + title.replace(" ", "_"))

    img = re.search(r'src="(/wiki/images/[^"]*%28Creature%29[^"]*)"', raw)
    image = img.group(1) if img else None

    soup = BeautifulSoup(raw, "lxml")
    info, stats, minions, summons, world, locations = parse_infobox(soup)

    cheats = section_items(soup, "Cheats")
    spell_notes = section_items(soup, "Spell Notes")

    school = info.get("school")
    if not school:
        for c in cats:
            m = re.match(r"^(\w+) School Creatures$", c)
            if m and m.group(1) in SCHOOLS:
                school = m.group(1)
                break

    rank = None
    m = re.search(r"(\d+)", info.get("rankText", ""))
    if m:
        rank = int(m.group(1))
    else:
        for c in cats:
            m = re.match(r"^Rank (\d+) Boss", c)
            if m:
                rank = int(m.group(1))
                break

    health = None
    m = re.search(r"[\d,]+", info.get("healthText", ""))
    if m:
        try:
            health = int(m.group(0).replace(",", ""))
        except ValueError:
            pass

    if not world:
        world_cats = [c[: -len(" Creatures")] for c in cats if c.endswith(" Creatures")
                      and not re.match(r"^(Rank \d+|\w+ School|Spellement|Classic)", c)]
        # broadest category tends to be the world (e.g. "Karamelle Creatures")
        world = world_cats[0] if world_cats else None

    return "ok", {
        "slug": path.stem,
        "name": title,
        "image": image,
        "wikiUrl": f"https://wiki.wizard101central.com/wiki/{page_name}",
        "school": school,
        "rank": rank,
        "health": health,
        "classification": info.get("classification"),
        "hasCheats": info.get("hasCheats", bool(cheats)),
        "world": world,
        "locations": [f"{w}: {loc}" if w else loc for w, loc in locations],
        "minions": list(dict.fromkeys(minions)),
        "summons": list(dict.fromkeys(summons)),
        "stats": stats,
        "cheats": cheats,
        "spellNotes": spell_notes,
        "categories": cats,
    }


def main():
    pages_ts = {}
    pages_file = Path("data/pages.json")
    if pages_file.exists():
        pages_ts = {p["slug"]: p["timestamp"] for p in json.loads(pages_file.read_text())}
    files = sorted(RAW_DIR.glob("*.html"))
    bosses, failures = [], []
    skipped = {"not-boss": 0, "redirect": 0}
    for f in files:
        try:
            status, rec = parse_file(f)
            if status == "ok":
                rec["snapshotTs"] = pages_ts.get(f.stem)
                bosses.append(rec)
            else:
                skipped[status] += 1
        except Exception as e:  # noqa: BLE001
            failures.append({"file": f.name, "error": f"{type(e).__name__}: {e}"})
    OUT.write_text(json.dumps(bosses, indent=1, ensure_ascii=False))
    FAIL_LOG.write_text(json.dumps(failures, indent=1))
    n_cheat = sum(1 for b in bosses if b["cheats"])
    print(f"parsed {len(files)} files -> {len(bosses)} bosses ({n_cheat} with cheat text), "
          f"skipped {skipped['not-boss']} non-boss, {skipped['redirect']} redirects, "
          f"{len(failures)} failures")
    if failures:
        print("first failures:", json.dumps(failures[:5], indent=1))


if __name__ == "__main__":
    sys.exit(main())
