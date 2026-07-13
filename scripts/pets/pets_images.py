#!/usr/bin/env python3
"""Mirror each pet's render to a small WebP thumbnail served from our CDN.
Reads site/data/pets/pets.json, downloads the wiki (Pet) image via cf.fetch_binary,
writes site/img/pets/<slug>.webp (220px). Resumable."""
import io
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gear"))
import cf  # noqa: E402
from PIL import Image  # noqa: E402

DST = Path("site/img/pets")
DST.mkdir(parents=True, exist_ok=True)


def main():
    pets = json.loads(Path("site/data/pets/pets.json").read_text())
    todo = [p for p in pets if p.get("image") and not (DST / f"{p['slug']}.webp").exists()]
    print(f"{len(pets)} pets, {len(todo)} images to mirror", flush=True)
    ok = fail = 0
    for i, p in enumerate(todo):
        data = cf.fetch_binary(p["image"])
        if data:
            try:
                im = Image.open(io.BytesIO(data)).convert("RGBA")
                im.thumbnail((220, 220), Image.LANCZOS)
                im.save(DST / f"{p['slug']}.webp", "WEBP", quality=82, method=6)
                ok += 1
            except Exception as e:  # noqa: BLE001
                print("  bad image", p["slug"], e)
                fail += 1
        else:
            fail += 1
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(todo)} (ok={ok} fail={fail})", flush=True)
        time.sleep(0.3)
    print(f"done: ok={ok} fail={fail}")


if __name__ == "__main__":
    main()
