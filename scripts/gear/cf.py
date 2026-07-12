"""Shared Cloudflare-cleared wiki session for the gear pipeline.

Reuses data/cf_session.json (cookie + UA). fetch() transparently re-solves the
challenge with undetected-chromedriver when the cookie expires.
"""
import json
import os
import ssl
import time
from pathlib import Path

import certifi

os.environ.setdefault("SSL_CERT_FILE", certifi.where())
ssl._create_default_https_context = ssl.create_default_context

from curl_cffi import requests  # noqa: E402

BASE = "https://wiki.wizard101central.com"
SESS_FILE = Path("data/cf_session.json")


def _load():
    s = json.loads(SESS_FILE.read_text())
    return s["cookies"], {"User-Agent": s["ua"]}


def refresh():
    import undetected_chromedriver as uc
    for attempt in range(3):
        try:
            opts = uc.ChromeOptions()
            opts.add_argument("--window-size=1360,900")
            d = uc.Chrome(options=opts, headless=False)
            d.get(f"{BASE}/wiki/Category:Hats")
            for _ in range(40):
                if d.title and "moment" not in d.title.lower() and "attention" not in d.title.lower():
                    break
                time.sleep(2)
            cks = {c["name"]: c["value"] for c in d.get_cookies()}
            ua = d.execute_script("return navigator.userAgent")
            SESS_FILE.write_text(json.dumps({"ua": ua, "cookies": cks}))
            d.quit()
            print("  [cf] session refreshed")
            return cks, {"User-Agent": ua}
        except Exception as e:  # noqa: BLE001
            print(f"  [cf] refresh attempt {attempt} failed: {type(e).__name__}")
            time.sleep(3)
    raise RuntimeError("could not refresh Cloudflare session")


_cookies, _headers = (None, None)


def fetch(path, tries=4):
    """GET /wiki/<path>; returns HTML text or None on 404. Refreshes on challenge."""
    global _cookies, _headers
    if _cookies is None:
        _cookies, _headers = _load()
    url = f"{BASE}/wiki/{path}"
    for _ in range(tries):
        try:
            r = requests.get(url, cookies=_cookies, headers=_headers, impersonate="chrome131", timeout=45)
        except Exception:  # noqa: BLE001
            time.sleep(4)
            continue
        if r.status_code == 404:
            return None
        head = r.text[:800].lower()
        if r.status_code == 200 and "just a moment" not in head and "attention required" not in head:
            return r.text
        _cookies, _headers = refresh()
        time.sleep(1)
    return None


def fetch_binary(path, tries=3):
    global _cookies, _headers
    if _cookies is None:
        _cookies, _headers = _load()
    url = f"{BASE}{path}" if path.startswith("/") else f"{BASE}/wiki/{path}"
    for _ in range(tries):
        try:
            r = requests.get(url, cookies=_cookies, headers=_headers, impersonate="chrome131", timeout=45)
        except Exception:  # noqa: BLE001
            time.sleep(3)
            continue
        if r.status_code == 200 and r.content[:4] in (b"\x89PNG", b"RIFF", b"\xff\xd8\xff\xe0"):
            return r.content
        if r.status_code == 404:
            return None
        _cookies, _headers = refresh()
    return None
