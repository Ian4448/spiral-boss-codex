#!/usr/bin/env python3
"""Orchestrator: loop [refresh Cloudflare cookie -> fetch as many portraits as
the cookie allows] until every boss with an image URL has a portrait (or only
un-fetchable ones remain). One process, so undetected-chromedriver refreshes
happen in-process (the pattern that's proven stable in the foreground).
"""
import json
import os
import ssl
import time
from pathlib import Path

import certifi

os.environ["SSL_CERT_FILE"] = certifi.where()
ssl._create_default_https_context = ssl.create_default_context

from curl_cffi import requests  # noqa: E402

BASE = "https://wiki.wizard101central.com"
SESS_FILE = Path("data/cf_session.json")


def refresh_cookie():
    import undetected_chromedriver as uc
    opts = uc.ChromeOptions()
    opts.add_argument("--window-size=1360,900")
    driver = uc.Chrome(options=opts, headless=False)
    try:
        driver.get(f"{BASE}/wiki/Category:Boss")
        for _ in range(50):
            t = driver.title
            if t and "moment" not in t.lower() and "attention" not in t.lower():
                break
            time.sleep(2)
        cks = {c["name"]: c["value"] for c in driver.get_cookies()}
        ua = driver.execute_script("return navigator.userAgent")
        SESS_FILE.write_text(json.dumps({"ua": ua, "cookies": cks}))
    finally:
        driver.quit()
    return cks, {"User-Agent": ua}


def missing_bosses():
    bosses = json.loads(Path("site/data/bosses.json").read_text())
    have = {f[:-4] for f in os.listdir("site/img") if f.endswith(".png")}
    known_bad = set(json.loads(Path("data/img_bad.json").read_text())) if Path("data/img_bad.json").exists() else set()
    return [b for b in bosses if b.get("image") and b["slug"] not in have and b["slug"] not in known_bad], known_bad


def refresh_manifest():
    have = sorted(f[:-4] for f in os.listdir("site/img") if f.endswith(".png"))
    Path("site/data/images.json").write_text(json.dumps(have))
    return len(have)


def main():
    bad = set()
    for cycle in range(6):
        todo, bad = missing_bosses()
        if not todo:
            print("all portraits fetched")
            break
        print(f"cycle {cycle}: {len(todo)} missing — refreshing cookie")
        cookies, headers = refresh_cookie()
        done = 0
        consec = 0
        for i, b in enumerate(todo):
            try:
                r = requests.get(BASE + b["image"], cookies=cookies, headers=headers,
                                 impersonate="chrome131", timeout=40)
                if r.status_code == 200 and r.content[:4] == b"\x89PNG":
                    Path(f"site/img/{b['slug']}.png").write_bytes(r.content)
                    done += 1
                    consec = 0
                elif r.status_code in (403, 503) or b"just a moment" in r.content[:600].lower():
                    consec += 1
                    if consec >= 8:
                        print(f"  cookie expired at {i+1}/{len(todo)} ({done} fetched this cycle)")
                        break
                else:
                    bad.add(b["slug"])  # 404 / not a png -> genuinely unavailable
                    consec = 0
            except Exception:  # noqa: BLE001
                consec = 0
            if done and done % 100 == 0:
                print(f"  {done} fetched this cycle, {i+1}/{len(todo)} scanned")
            time.sleep(0.3)
        Path("data/img_bad.json").write_text(json.dumps(sorted(bad)))
        total = refresh_manifest()
        print(f"  cycle {cycle} done: +{done} this cycle, {total} portraits total, {len(bad)} unavailable")

    total = refresh_manifest()
    todo, bad = missing_bosses()
    print(f"FINAL: {total} portraits, {len(todo)} still missing, {len(bad)} confirmed unavailable")


if __name__ == "__main__":
    main()
