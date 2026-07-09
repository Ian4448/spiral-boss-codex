# Spiral Boss Codex

**Live site: [w101helpersite.vercel.app](https://w101helpersite.vercel.app)**

A searchable database of **every Wizard101 boss** (1,900+) focused on their **cheats**: type
any boss name — or describe a cheat, like "removes my traps in Khrysalis" — and get the boss's
cheats with plain-language explanations, an ordered "how to fight" game plan, key battle stats,
its portrait, and a link to the source wiki page (plus a Final Bastion walkthrough where one
exists).

See [DESIGN.md](DESIGN.md) for the full design document.

## Coverage

- **1,912 bosses** — the wiki's complete Boss category.
- **714 cheating bosses**, each with a curated, index-aligned game plan and per-cheat notes.
- **55 bosses** carry strategies sourced from [Final Bastion](https://finalbastion.com) guides.
- **1,828 boss portraits** (95%); the rest fall back to a school-colored monogram tile.

## Quick start (local)

```bash
npm install                     # esbuild + minisearch
npm run build                   # bundle site/src/app.js -> site/app.js
cd site && python3 -m http.server 8377   # http://127.0.0.1:8377
```

The repo ships with the generated `site/data/*` and `site/img/*`, so it runs immediately —
no scraping required.

## Deploy to Vercel

The site is fully static (`site/` is the output directory; `vercel.json` is preconfigured):

```bash
npm i -g vercel        # if not already installed
vercel                 # first run: links the project and deploys a preview
vercel --prod          # promote to production
```

Vercel runs `npm run build` and serves `site/`. No environment variables or server needed.
Search runs entirely in the browser; "Smart search" lazy-loads a model from a CDN on demand.

## Search modes

- **Default:** instant fuzzy/prefix search (MiniSearch) over names, worlds, cheat text, and
  tags — search-as-you-type with portrait previews. Works fully offline.
- **Smart search (toggle):** loads `all-MiniLM-L6-v2` (~25 MB, cached) in the browser via
  transformers.js and ranks bosses by cosine similarity against precomputed embeddings —
  handles descriptive queries like "boss that punishes healing".

## Data pipeline (`scripts/`, only needed to regenerate)

Two sources, because the live wiki sits behind a Cloudflare managed challenge:

1. **Internet Archive** (`1_enumerate`–`6_images`) — CDX enumeration + Wayback snapshots for
   the bulk of bosses and portraits. No auth needed.
2. **Live wiki** (`7_live_enum`–`10_fill_images`) — fills the ~690 bosses the Archive never
   captured. Clears Cloudflare once with `undetected-chromedriver` (a patched real Chrome),
   saves the `cf_clearance` cookie, then fetches fast with `curl_cffi` TLS impersonation.
   Requires a second Python 3.12 venv: `pip install undetected-chromedriver curl_cffi certifi
   beautifulsoup4 lxml`. The saved cookie (`data/cf_session.json`) is gitignored — it's a
   session secret.

Enrichment (`4_enrich.py`) classifies cheats into a tag taxonomy and merges the curated
`data/overrides/<slug>.json` game plans (`{ "strategy": [...], "cheatNotes": [...],
"groupFight": bool }`) into the final `site/data/bosses.json`. After editing overrides:
`npm run enrich`.

## Attribution

Fan-made and non-commercial. Boss data © its contributors at the
[Wizard101 Central Wiki](https://wiki.wizard101central.com); some strategies adapted from
[Final Bastion](https://finalbastion.com) guides. Wizard101 is a trademark of KingsIsle
Entertainment; this project is not affiliated.
