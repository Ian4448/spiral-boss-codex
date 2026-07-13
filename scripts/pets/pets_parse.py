#!/usr/bin/env python3
"""Parse fetched pet pages into the species catalog.

Reads data/raw_pets/<slug>.html + data/pets_pages.json,
writes site/data/pets/pets.json.
"""
import html
import json
import re
from pathlib import Path

RAW = Path("data/raw_pets")
OUT = Path("site/data/pets/pets.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

RARITIES = {"Common", "Uncommon", "Rare", "Ultra-Rare", "Epic"}
SCHOOLS = {"Fire", "Ice", "Storm", "Myth", "Life", "Death", "Balance", "Astral", "Shadow"}


def txt(x):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x))).strip()


def parse_stats(s):
    """pet-stats-table: flat 'Label value' sequence."""
    m = re.search(r'<table[^>]*pet-stats-table[^>]*>(.*?)</table>', s, re.S)
    if not m:
        return {}
    flat = txt(m.group(1))
    out = {}
    sm = re.search(r"School\s+([A-Za-z]+)", flat)
    if sm and sm.group(1) in SCHOOLS:
        out["school"] = sm.group(1)
    for key, label in [("strength", "Strength"), ("intellect", "Intellect"),
                       ("agility", "Agility"), ("will", "Will"), ("power", "Power"),
                       ("pedigree", "Pedigree")]:
        mm = re.search(label + r"\s+(\d+)", flat)
        if mm:
            out[key] = int(mm.group(1))
    em = re.search(r"Egg\s+([A-Za-z][A-Za-z '-]*?)\s+(?:Liked|Loved|Agility|Will|Power|$)", flat)
    if em:
        out["egg"] = em.group(1).strip()
    return out


def parse_abilities(s):
    """ability-list rows: cell0 = talent, cell1 = derby (each a linked ability image)."""
    m = re.search(r'<table[^>]*ability-list[^>]*>(.*?)</table>', s, re.S)
    talents, derby = [], []
    if not m:
        return talents, derby
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(1), re.S)
    for r in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)
        for i, cell in enumerate(cells[:2]):
            am = re.search(r'src="[^"]*%28(Talent|Derby)%29_[^"]*"[^>]*class="ability-image"', cell)
            if not am:
                # some pages order attrs differently
                am = re.search(r'class="ability-image"[^>]*src="[^"]*%28(Talent|Derby)%29_', cell)
            nm = re.search(r'href="/wiki/PetAbility:([^"?#]+)"', cell)
            if am and nm:
                name = html.unescape(nm.group(1).replace("_", " "))
                if name in RARITIES:
                    continue
                (talents if am.group(1) == "Talent" else derby).append(name)
    # de-dup preserving order
    def dedup(xs):
        seen, out = set(), []
        for x in xs:
            if x not in seen:
                seen.add(x)
                out.append(x)
        return out
    return dedup(talents), dedup(derby)


def parse_card(s):
    m = re.search(r"%28Item[_ ]Card%29_([^\"'.]+)\.png", s)
    return html.unescape(m.group(1).replace("_", " ")) if m else None


def parse_image(s, name):
    m = re.search(r'src="(/wiki/images/[^"]*%28Pet%29_[^"]+\.png)"', s)
    if not m:
        return None
    return m.group(1)  # wiki-relative path to the full pet render


def main():
    pages = {p["slug"]: p for p in json.loads(Path("data/pets_pages.json").read_text())}
    out = []
    missing_school = no_stats = 0
    for slug, page in pages.items():
        f = RAW / f"{slug}.html"
        if not f.exists():
            continue
        s = f.read_text()
        name = page["title"].replace("Pet:", "").replace("_", " ")
        name = html.unescape(name)
        stats = parse_stats(s)
        talents, derby = parse_abilities(s)
        rec = {
            "slug": slug,
            "name": name,
            "school": stats.get("school", "Any"),
            "pedigree": stats.get("pedigree"),
            "baseStats": {k: stats[k] for k in ("strength", "intellect", "agility", "will", "power") if k in stats},
            "egg": stats.get("egg"),
            "talents": talents,
            "derby": derby,
            "card": parse_card(s),
            "image": parse_image(s, name),
            "wikiUrl": f"https://wiki.wizard101central.com/wiki/{page['title']}",
        }
        if rec["school"] == "Any":
            missing_school += 1
        if not rec["baseStats"]:
            no_stats += 1
        out.append(rec)
    out.sort(key=lambda r: r["name"].lower())
    OUT.write_text(json.dumps(out, ensure_ascii=False))
    by_school = {}
    for r in out:
        by_school[r["school"]] = by_school.get(r["school"], 0) + 1
    print(f"parsed {len(out)} pets -> {OUT} ({OUT.stat().st_size // 1024} KB)")
    print(f"missing school: {missing_school} | no base stats: {no_stats}")
    print("by school:", dict(sorted(by_school.items(), key=lambda x: -x[1])))
    withimg = sum(1 for r in out if r["image"])
    withtal = sum(1 for r in out if r["talents"])
    print(f"with image: {withimg} | with >=1 discovered talent: {withtal}")


if __name__ == "__main__":
    main()
