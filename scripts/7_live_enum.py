#!/usr/bin/env python3
"""Enumerate the FULL live Category:Boss via the Cloudflare-cleared session,
diff against our archived dataset, and list the missing boss pages.

Uses cf_session.json (cookie + UA from undetected-chromedriver). Refreshes the
clearance automatically if it expires mid-crawl.
"""
import json
import re
import time
from pathlib import Path

from curl_cffi import requests

SESS_FILE = Path("data/cf_session.json")
BASE = "https://wiki.wizard101central.com"


def load_session():
    s = json.loads(SESS_FILE.read_text())
    return s["cookies"], {"User-Agent": s["ua"]}


def refresh_session():
    """Re-solve the challenge with a real browser and persist a fresh cookie."""
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


def fetch(url, cookies, headers, tries=3):
    for attempt in range(tries):
        r = requests.get(url, cookies=cookies, headers=headers, impersonate="chrome131", timeout=45)
        if r.status_code == 200 and "just a moment" not in r.text[:600].lower():
            return r.text, cookies, headers
        if r.status_code == 404:
            return None, cookies, headers
        # challenged or error -> refresh session and retry
        print(f"  challenged ({r.status_code}) on {url.split('/')[-1]}, refreshing…")
        cookies, headers = refresh_session()
        time.sleep(1)
    return None, cookies, headers


def enum_category(cookies, headers):
    """Walk Category:Boss pagination, collecting Creature page titles."""
    titles = []
    url = f"{BASE}/wiki/Category:Boss"
    seen_pages = 0
    while url:
        html, cookies, headers = fetch(url, cookies, headers)
        if not html:
            break
        seen_pages += 1
        # only links inside the mw-pages section are category members
        section = html.split('id="mw-pages"', 1)[-1]
        found = re.findall(r'href="/wiki/(Creature:[^"?#]+)"', section)
        titles.extend(found)
        # next page link
        m = re.search(r'href="([^"]*pagefrom=[^"]*)"[^>]*>\s*next page', html, re.I)
        if m:
            nxt = m.group(1).replace("&amp;", "&").split("#")[0]
            url = BASE + nxt
            time.sleep(1.5)
        else:
            url = None
    # dedupe, decode
    from urllib.parse import unquote
    titles = [unquote(t) for t in titles]
    return sorted(set(titles)), seen_pages


def main():
    cookies, headers = load_session()
    titles, pages = enum_category(cookies, headers)
    print(f"enumerated {len(titles)} boss pages across {pages} category pages")

    have = {b["slug"] for b in json.loads(Path("data/bosses.json").read_text())}

    def to_slug(title):
        t = title.replace("Creature:", "")
        return re.sub(r"[^A-Za-z0-9()'!-]+", "_", t).strip("_")

    missing = [(t, to_slug(t)) for t in titles if to_slug(t) not in have]
    Path("data/live_missing.json").write_text(
        json.dumps([{"title": t, "slug": s} for t, s in missing], indent=1, ensure_ascii=False)
    )
    print(f"have {len(have)} | live lists {len(titles)} | MISSING {len(missing)}")
    print("first 25 missing:")
    for t, s in missing[:25]:
        print("  ", t)


if __name__ == "__main__":
    main()
