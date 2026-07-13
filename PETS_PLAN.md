# Plan: Pets Section

A third area of the site (alongside the boss codex and build creator): browse every
Wizard101 pet with art, and track your own **breeding/hatch lineage** as a graph.

## 1. What it does

- **Browse** all first-gen pets: search/filter by school, pedigree, talent pool; each pet
  shows its art, base stats (Strength/Intellect/Agility/Will/Power), the card it gives, and its
  10 potential talents + 10 derby abilities.
- **Talent reference**: the full manifestable-talent catalog with rarity and which stat each
  scales from.
- **Hatch tracker** (the differentiated part): record your own pets and the hatches between
  them. Each pet you own is a node; each hatch links two parents to a child. The tool renders
  your **lineage as a graph** and can show, for a planned hatch, the combined talent pool the
  offspring could inherit.

## 2. Two datasets, cleanly separated

This is the core architectural decision (from research):

1. **Species catalog — scraped, static.** ~1,150 first-gen pets + the talent/derby-ability
   catalog (~150–250 abilities) + images. Ships as JSON + art like the boss/gear data. Same
   pipeline shape; reuse `scripts/gear/cf.py` (Cloudflare-cleared session) against the `Pet:`
   and `PetAbility:` namespaces.
2. **Your hatch log — per-user, mutable.** Which pets you own, their *actual* manifested
   talents (a random roll per hatch — not predictable), the two parents of each hatch, dates,
   nicknames. The wiki has none of this; it's authored by the user.

Only species-level data is derivable; the lineage graph is entirely user data.

## 3. Data model

```
Species (scraped):
  { slug, name, school, pedigree, egg, kiosk, cardGiven,
    baseStats: { strength, intellect, agility, will, power },
    talents: [abilityId × up to 10],        // potential pool
    derby:   [abilityId × up to 10],
    image, wikiUrl }

Ability (scraped):
  { id, name, kind: 'talent'|'derby', rarity, effect, scalesFrom, icon }

OwnedPet (user):
  { id, speciesSlug, nickname, manifested: [abilityId × up to 6],
    parents: [ownedPetId, ownedPetId] | null, hatchedOn }
```

The lineage is the set of OwnedPets with parent edges — a **DAG** (shared ancestors, a kiosk
pet parenting many children), not a tree.

## 4. Scraping pipeline (`scripts/pets/`)

Mirror the existing gear pipeline:
- `pets_enum.py` — walk `Category:First Generation Pets` (paginated) → pet page titles (~1,150).
- `pets_fetch.py` — fetch pages via `cf.fetch` (resumable, cookie-refresh).
- `pets_parse.py` — `Template:PetInfobox` → the Species schema (school, pedigree, base stats,
  card, talent1–10, derbyability1–10).
- `abilities.py` — parse `Basic:PetTalentTable` + `Basic:PetDerbyAbilitiesTable` → Ability catalog.
- `pet_images.py` — mirror renders from `Category:Pet Images` → jsDelivr (like boss portraits).

Scale ≈ the boss crawl; a few thousand fetches. Re-runnable to pick up new pets per game update.

## 5. Storage for the hatch log

The site is static (Vercel + jsDelivr). Options, in order of preference:

- **v1 — local-first**: hatch log lives in `localStorage`, with **export/import JSON** so users
  can back up or move between devices. Zero backend, ships immediately, private by default.
- **v2 — optional cloud save**: reuse the same **Vercel KV** backend planned for shared builds
  (a short id → lineage JSON) so a lineage gets a shareable link. Same infra as the build
  gallery, so build that once and both features use it.

Recommend v1 for the MVP; graduate to v2 alongside the build-sharing backend.

## 6. UI

Reuse the dark-arcana system. Three views under `#pets`:

- **Catalog** — card grid (pet art, school crest, pedigree, top talents), search + school/
  pedigree/talent filters. Click → pet detail (base stats, full talent + derby pools with
  rarity colors, card given, how obtained, wiki link).
- **My Pets** — your OwnedPets as cards; add a pet (pick species, set its manifested talents),
  edit, delete. Local-stored.
- **Lineage graph** — nodes = your pets, edges = parent→child hatches. Layered DAG layout
  (dagre/ELK-style), pan/zoom, click a node to inspect. A "plan a hatch" mode picks two parents
  and shows the **combined potential talent pool** (from the catalog) the child could roll,
  with inheritance likelihoods — framed as probabilities, never a deterministic prediction.

Graph rendering: a small dependency-free layered layout (or a tiny lib inlined) drawing SVG —
consistent with the site's self-contained, CSP-safe approach.

## 7. Honest constraints

- **Hatch outcomes are random.** The tool *records observed* rolls and *shows possible* pools;
  it must not promise "this hatch will give X." Set that expectation in the UI.
- **Manifested talents are user-entered** (the game doesn't expose them to us). Adding a pet is
  a few clicks; keep it fast.
- **Catalog staleness + Cloudflare.** New pets arrive with updates; the scrape is a re-runnable
  batch and the cf session needs periodic refresh — same operational shape as the boss/gear data.
- **Derby vs combat talents** are distinct pools; keep them separate in the UI so build-minded
  users aren't confused by derby-only abilities.

## 8. Phasing

1. **Catalog** — scrape + browse pets and the talent catalog (static, shippable on its own).
2. **My Pets** — local-stored owned pets with manifested talents.
3. **Lineage graph** — the DAG view + plan-a-hatch pool preview.
4. **Cloud save/share** — Vercel KV, shared with the build-gallery backend.

Phase 1 alone is a complete, useful "pet encyclopedia"; the hatch tracker (2–3) is the
differentiator no existing tool offers.
