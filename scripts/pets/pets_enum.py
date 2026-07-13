#!/usr/bin/env python3
"""Enumerate first-generation pet pages from Category:First_Generation_Pets.
Output: data/pets_pages.json  [{title, slug}]
"""
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gear"))
import cf  # noqa: E402

OUT = Path("data/pets_pages.json")


def to_slug(title):
    t = title.replace("Pet:", "")
    return re.sub(r"[^A-Za-z0-9()'!.-]+", "_", t).strip("_")


def main():
    url = "Category:First_Generation_Pets"
    titles, pages = [], 0
    while url:
        html = cf.fetch(url)
        if not html:
            break
        pages += 1
        section = html.split('id="mw-pages"', 1)[-1]
        titles += re.findall(r'href="/wiki/(Pet:[^"?#]+)"', section)
        m = re.search(r'href="([^"]*pagefrom=[^"]*)"[^>]*>\s*next page', html, re.I)
        url = m.group(1).replace("&amp;", "&").split("#")[0].replace("/wiki/", "") if m else None
        time.sleep(1.2)
    seen = {}
    for t in titles:
        t = unquote(t)
        seen[to_slug(t)] = {"title": t, "slug": to_slug(t)}
    recs = sorted(seen.values(), key=lambda r: r["slug"])
    OUT.write_text(json.dumps(recs, indent=1, ensure_ascii=False))
    print(f"{len(titles)} links across {pages} pages -> {len(recs)} unique pets")


if __name__ == "__main__":
    main()
