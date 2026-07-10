#!/usr/bin/env python3
"""Generate tiny 96px WebP preview thumbnails for every portrait in site/img,
into site/img/thumb/<slug>.webp. The site serves these in search previews and
browse cards; the full-size PNG is used only on the boss detail page.

Run after fetching portraits (scripts 6 / 9 / 10). Requires Pillow.
"""
from pathlib import Path

from PIL import Image

SRC = Path("site/img")
DST = SRC / "thumb"
DST.mkdir(exist_ok=True)

made = 0
for f in SRC.glob("*.png"):
    out = DST / (f.stem + ".webp")
    if out.exists():
        continue
    try:
        im = Image.open(f).convert("RGBA")
        im.thumbnail((96, 96), Image.LANCZOS)
        im.save(out, "WEBP", quality=82, method=6)
        made += 1
    except Exception as e:  # noqa: BLE001
        print(f"skip {f.name}: {e}")

print(f"generated {made} thumbnails in {DST}")
