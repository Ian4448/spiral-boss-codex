#!/usr/bin/env python3
"""Fetch portraits for bosses missing an image, directly from the live wiki
using the Cloudflare-cleared session. Saves site/img/<slug>.png.
"""
import json
import os
import time
from pathlib import Path
from urllib.parse import quote

from curl_cffi import requests

SESS = json.loads(Path("data/cf_session.json").read_text())
COOKIES = SESS["cookies"]
HEADERS = {"User-Agent": SESS["ua"]}
BASE = "https://wiki.wizard101central.com"


def main():
    bosses = json.loads(Path("site/data/bosses.json").read_text())
    have = {f[:-4] for f in os.listdir("site/img") if f.endswith(".png")}
    todo = [b for b in bosses if b.get("image") and b["slug"] not in have]
    print(f"{len(todo)} bosses need a live portrait")
    done = failed = 0
    consec_challenge = 0
    for i, b in enumerate(todo):
        # b["image"] is a thumb path like /wiki/images/thumb/a/b/(Creature)_X.png/240px-...
        url = BASE + b["image"]
        try:
            r = requests.get(url, cookies=COOKIES, headers=HEADERS, impersonate="chrome131", timeout=40)
            if r.status_code == 200 and r.content[:4] == b"\x89PNG":
                Path(f"site/img/{b['slug']}.png").write_bytes(r.content)
                done += 1
                consec_challenge = 0
            elif r.status_code in (403, 503) or b"just a moment" in r.content[:600].lower():
                consec_challenge += 1
                if consec_challenge >= 8:
                    print(f"COOKIE EXPIRED at {i+1}/{len(todo)} — re-run after refresh. {done} fetched so far.")
                    break
            else:
                failed += 1
                consec_challenge = 0
        except Exception:  # noqa: BLE001
            failed += 1
        if (done + failed) % 50 == 0 and (done + failed) > 0:
            print(f"progress: {done} fetched, {failed} failed, {i+1}/{len(todo)}")
        time.sleep(0.35)
    # refresh manifest
    have = sorted(f[:-4] for f in os.listdir("site/img") if f.endswith(".png"))
    Path("site/data/images.json").write_text(json.dumps(have))
    print(f"DONE: {done} fetched, {failed} failed; {len(have)} portraits total")


if __name__ == "__main__":
    main()
