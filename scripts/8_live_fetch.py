#!/usr/bin/env python3
"""Fetch the boss pages missing from our archive directly from the live wiki,
using the Cloudflare-cleared session. Saves into data/raw/<slug>.html so the
existing parser picks them up. Resumable; refreshes clearance when challenged.
"""
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import quote

from curl_cffi import requests

SESS_FILE = Path("data/cf_session.json")
BASE = "https://wiki.wizard101central.com"
RAW = Path("data/raw")


def load_session():
    s = json.loads(SESS_FILE.read_text())
    return s["cookies"], {"User-Agent": s["ua"]}


def refresh_session():
    import os
    import ssl
    import certifi
    os.environ["SSL_CERT_FILE"] = certifi.where()
    ssl._create_default_https_context = ssl.create_default_context
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
        print("  refreshed cf session")
    finally:
        driver.quit()
    return load_session()


def main():
    missing = json.loads(Path("data/live_missing.json").read_text())
    cookies, headers = load_session()
    done = skipped = failed = 0
    fails = []

    for i, item in enumerate(missing):
        title, slug = item["title"], item["slug"]
        dest = RAW / f"{slug}.html"
        if dest.exists() and dest.stat().st_size > 5000:
            skipped += 1
            continue

        url = f"{BASE}/wiki/{quote(title)}"
        ok = False
        for attempt in range(4):
            try:
                r = requests.get(url, cookies=cookies, headers=headers,
                                 impersonate="chrome131", timeout=45)
            except Exception as e:  # noqa: BLE001
                print(f"  [{i+1}] {slug}: {type(e).__name__}, retry")
                time.sleep(5)
                continue
            head = r.text[:800].lower()
            if r.status_code == 200 and "just a moment" not in head and "attention required" not in head:
                dest.write_text(r.text, encoding="utf-8")
                ok = True
                break
            if r.status_code == 404:
                break  # page genuinely gone
            print(f"  [{i+1}] {slug}: {r.status_code}/challenge — cookie expired")
            if os.environ.get("NO_REFRESH"):
                print("  NO_REFRESH set; saving progress and exiting so caller can re-solve")
                Path("data/live_fetch_failures.json").write_text(json.dumps(fails, indent=1))
                print(f"PARTIAL: {done} fetched, {skipped} cached, {failed} failed before cookie expiry")
                return
            cookies, headers = refresh_session()
            time.sleep(1)
        if ok:
            done += 1
        else:
            failed += 1
            fails.append(slug)
        if (done + failed) % 25 == 0 and (done + failed) > 0:
            print(f"progress: {done} fetched, {skipped} cached, {failed} failed, {i+1}/{len(missing)}")
            Path("data/live_fetch_failures.json").write_text(json.dumps(fails, indent=1))
        time.sleep(1.0)

    Path("data/live_fetch_failures.json").write_text(json.dumps(fails, indent=1))
    print(f"DONE: {done} fetched, {skipped} cached, {failed} failed (see live_fetch_failures.json)")


if __name__ == "__main__":
    main()
