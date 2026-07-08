# Wizard101 Boss Cheat Database — Design Document

## 1. Goal

A website where a player can type any Wizard101 boss name (or describe a cheat, e.g. "removes
my blades") and instantly get the information that matters for the fight — above all the boss's
**cheats** — plus a short, practical summary of how to play around them.

### Why this is useful (game background)

Wizard101 is a turn-based, card-based MMO. Combat revolves around setting up big hits:
**blades** (self-buffs), **traps** (debuffs placed on the enemy), **shields**, **heals**, and
**auras/globals**. From Celestia onward, many bosses "cheat": they have scripted, rule-breaking
behaviors that trigger off player actions — outside the normal turn order and pip economy.
Typical cheats include:

- Counter-casting when you **blade** ("no blading!") or **trap** — the setup meta stops working.
- Punishing **heals** with a big attack or by healing themselves.
- Punishing **low-pip spells**, **shadow spells**, **auras/globals**, or **joining late**.
- Interrupt casts on a fixed round timer, damage thresholds that trigger phase changes,
  minions that must be killed in a specific order, and traps/charms being removed each round.

Playing a cheating boss with the normal strategy can wipe a team, so players constantly look
up "what does this boss cheat?" before fighting. Today that information lives on individual
wiki pages and scattered blog guides. This site centralizes it and makes it searchable.

## 2. Data source

**Primary source:** the Wizard101 Central Wiki, `https://wiki.wizard101central.com/wiki/Category:Boss`
(the canonical community database; each boss has a `Creature:` page with an infobox and a
"Cheats" section).

**Constraint discovered during research:** the wiki sits behind Cloudflare with a managed
challenge that blocks curl, generic fetchers, and headless/headed Playwright (escalates to a
hard block). Hammering it further is both rude and futile.

**Chosen approach: scrape the Internet Archive Wayback Machine mirror instead.**

- The CDX API (`web.archive.org/cdx/search/cdx?url=wiki.wizard101central.com/wiki/Creature:*`)
  enumerates **2,785 unique archived `Creature:` pages** with HTTP 200 snapshots.
- We download the **latest 200 snapshot** of each page with the `id_` modifier (raw original
  HTML, no Wayback toolbar).
- Each page embeds `wgCategories` in a JS config block — a clean machine-readable category
  list. We keep only pages whose categories include **"Boss"** (the `Creature:` namespace also
  contains regular mobs and minions, which we drop or keep as related data).

Trade-offs, accepted:

- **Staleness:** snapshots range ~2023–2026. Cheats rarely change once published, so this is
  acceptable for v1. Each record stores its snapshot date and links to the live wiki page.
- **Coverage gaps:** bosses never crawled by the Archive are missing. The Category:Boss page
  itself lists ~2,200+ bosses; 2,785 archived creature pages should cover the large majority,
  and every record links out to the live wiki as the source of truth.
- **Rate limits:** Wayback throttles aggressively (429s observed). The scraper runs with ~1
  request/sec, exponential backoff on 429/5xx, and a resumable on-disk cache so the crawl can
  be re-run incrementally.

Attribution: the site credits Wizard101 Central Wiki (content) and the Internet Archive
(snapshots) and links every boss back to its live wiki page.

## 3. Pipeline architecture

Three offline stages produce one static JSON dataset; the website is a static frontend over it.

```
scripts/
  1_enumerate.mjs   CDX API -> data/pages.json          (list of {url, timestamp})
  2_download.mjs    Wayback -> data/raw/<slug>.html      (throttled, resumable cache)
  3_parse.py        raw HTML -> data/bosses.json         (structured records, boss-only)
  4_enrich.py       bosses.json -> site/data/bosses.json
                    (cheat taxonomy tags + generated strategy summaries)
  5_embed.mjs       bosses.json -> site/data/embeddings.bin (semantic vectors)
```

### 3.1 Parsing (stage 3)

From each cached page we extract:

| Field | Source in page |
|---|---|
| `name`, `pageTitle` | `<title>` / `wgPageName` |
| `categories` | `wgCategories` JS config |
| `isBoss` | `"Boss" in categories` |
| `school` | `"<X> School Creatures"` category |
| `rank` | `"Rank N Boss Creatures"` category |
| `health` | infobox "Health" row |
| `classification` | infobox "Classification" row |
| `hasCheats` | infobox "Cheats: Yes/No" row |
| `battleStats` | shadow/starting pips, critical, block, pierce, boost, resist, stunable, beguilable |
| `minions`, `summons` | infobox "Minions"/"Summons" rows |
| `world`, `locations` | infobox "Location" rows + world categories |
| `cheats[]` | the `Cheats` section — list of paragraphs, HTML stripped, spell links kept as names |
| `spellNotes[]` | the `Spell Notes` section |
| `wikiUrl`, `snapshotTs` | provenance |

Parser is Python + BeautifulSoup. Records failing to parse are logged, not dropped silently.

### 3.2 Cheat taxonomy + strategy summaries (stage 4)

A rule-based classifier maps each boss's cheat text onto a **cheat taxonomy** — the tags are
the product feature ("can I blade against this boss?"):

| Tag | Trigger patterns (examples) | Core advice template |
|---|---|---|
| `punishes-blades` | "casts X when a Wizard casts a Blade/Charm" | Skip blade-stacking; use traps/auras or hit unbuffed |
| `punishes-traps` | trap/ward triggers, "removes Traps" | Don't rely on Feint; use blades and raw damage |
| `punishes-heals` | "when a Wizard heals", "casts X on healing" | Heal only when the counter is survivable; bring resist/absorbs |
| `punishes-shields` | shield/ward counters, "removes Shields" | Don't turtle; win faster instead |
| `punishes-low-pip` | "spell costing less/fewer than N pips" | Pack a lean deck of big hits; avoid wands/utility |
| `punishes-shadow` | shadow-spell triggers | Leave shadow-enhanced spells at home |
| `punishes-globals` / `punishes-auras` | global/aura triggers | Keep the boss's preferred global up, or skip yours |
| `round-interrupt` | "at the beginning of every/each Nth Round" | Budget healing/shields around the timer |
| `damage-threshold` | "when reduced below N health" | Burst through thresholds in one round |
| `kill-order` | "must be defeated first/last", respawns | Follow the kill order; coordinate targets |
| `removes-hanging-effects` | steals/removes charms/wards | Cast setup the same round you use it |
| `punishes-late-join` | "joins the duel late" | Enter together; nobody flees/re-enters |
| `cheat-heals-self` | boss heals itself | Bring Doom & Gloom / infection-style pressure |
| `stun-block-needed` | stun/beguile cheats | Pack stun blocks/resist |

Each boss gets `tags[]` (used for preview chips) plus a **game plan**: an ordered list of
steps for playing the fight. Plans come from two sources:

1. **Curated overrides** (`data/overrides/<slug>.json`) — written by LLM strategy writers
   grounded in a combat-meta primer (`data/meta_primer.md`: blade-stacking/Feint loop,
   Aegis/Indemnity protection, fizzle mechanics, kill-order/threshold/timer patterns,
   solo-vs-team framing for dungeon bosses). Each override carries `strategy[]` (3–7 concrete
   steps referencing the boss's actual cheats/numbers), `cheatNotes[]` (a plain-language
   "in practice" explanation with an example, aligned per cheat paragraph), and `groupFight`.
   Writers are instructed to surface exploitable cheats (e.g. Tiddalik: a fizzle pushes his
   own Tower Shield to a player — so you force a fizzle) as the centerpiece of the plan.
2. **Rule-based fallback** for bosses without an override (newly crawled, regenerated) —
   assembled from tag advice templates around the same blade→burst framing.

`cheatNotes` are dropped automatically if a re-crawl changes the boss's cheat list (length
mismatch), so stale notes never render against the wrong cheat.

### 3.3 Semantic search (stage 5 + frontend)

Two search layers, so the site is instant by default and semantic when wanted:

1. **Instant lexical search (default):** MiniSearch (BM25-style) index over boss name (boosted),
   world, location, cheat text, and tags — with fuzzy matching and prefix search for
   search-as-you-type. Handles the primary use case ("rattlebones", "luska charm") with zero
   model download. Tag filters (world / school / rank / cheat-type) narrow results.
2. **Semantic mode (lazy-loaded):** build-time sentence embeddings of each boss's
   name + cheat text using `all-MiniLM-L6-v2` (384-dim) via `@xenova/transformers` in Node,
   shipped as a quantized Float16/Int8 binary (~2 MB for ~1,500 bosses). In the browser the
   same model loads on demand (~25 MB, cached by the browser) to embed the query; cosine
   similarity ranks bosses. This answers descriptive queries like "boss that punishes healing
   in Khrysalis" even when the words don't match the text. The UI blends: lexical results
   first while the model warms, then semantic re-rank.

If the model download is unacceptable on some connection, the site remains fully functional on
layer 1 — semantic mode is progressive enhancement.

## 4. Website

**Stack:** static single-page app — vanilla JS + esbuild bundle, no server-side component.
Deployable to any static host (GitHub Pages, Netlify). Data ships as `bosses.json`
(+ `embeddings.bin`). Dev server: `npx serve` / esbuild serve.

**UI (single page):**

- **Header:** title + search box (autofocus). Search-as-you-type, keyboard navigable.
- **Filter row:** chips for World, School, Rank range, and Cheat tags ("Punishes blades",
  "Punishes heals", …), plus a "cheaters only" toggle (default on — the point of the site).
- **Results list:** compact cards — boss name, school icon color, world, rank/health, tag
  chips. Click → detail view.
- **Detail view:**
  - Name, school, rank, health, world/location, link to live wiki page + snapshot date.
  - **"How to fight" strategy summary** — the generated 2–4 sentence briefing, top of page.
  - **Cheat tags** as prominent chips (the at-a-glance answer to "can I blade?").
  - **Full cheat text** from the wiki, formatted.
  - Battle stats table (pips, crit/block, pierce, resist, stunable/beguilable), minions with
    links to their entries if they're in the dataset, spell notes.
- **Semantic toggle:** "Smart search" switch that lazy-loads the embedding model.
- Dark/light theme; the game's school colors used for accents (Fire red, Ice blue, etc.).

## 5. Repository layout

```
w101_helper_site/
  DESIGN.md
  package.json
  scripts/            # pipeline stages 1-5
  data/               # pages.json, raw/ cache, bosses.json (gitignored raw)
  site/               # the deployable static site
    index.html, style.css
    src/app.js        # source; bundled to site/app.js by esbuild
    data/bosses.json, embeddings.bin
```

## 6. Risks / open questions

- **Wayback throttling** makes the full crawl take ~1–2 h; it is resumable and run once.
- **Old snapshots** may predate cheat revisions; mitigated by provenance display + live links.
- **HTML variance** across years of wiki templates; parser is defensive, logs failures, and we
  spot-check a sample across worlds/eras.
- **Legal/etiquette:** fan-made, non-commercial, attributed, sourced via the Internet Archive
  rather than hammering the wiki's Cloudflare. Wiki content is community-written; we quote
  cheat text with attribution and link back.
- **Future:** curated summaries for top dungeons, team-comp advice per school, PvE tier notes,
  re-crawl job to refresh stale bosses from the live wiki if access is ever unblocked.
