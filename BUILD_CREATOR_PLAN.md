# Plan: Gear Build Creator (+ Pets)

A second tool on the Spiral Boss Codex: assemble a custom gear + pet build, see the
resulting stats update live as you swap pieces, and share it with a link. Design-led —
the interaction and look are the point, not just a stat table.

## 1. What it does (user story)

1. Open `/#build`. A character sheet with empty slots: Hat, Robe, Boots, Wand, Athame,
   Amulet, Ring, Deck, Mount, and Pet.
2. Click a slot → a searchable item picker slides in (filter by your school + level).
   Hovering an item shows the **stat delta** (green/red) vs what's equipped.
3. Pick items; the **live stats panel** animates to the new totals — damage/resist/critical
   per school, pierce, accuracy, health, pips, etc.
4. Add a pet and choose its manifested talents; they fold into the totals.
5. "Copy link" → a URL that encodes the whole build. Anyone who opens it sees the same build.
   Optionally open two builds side-by-side to compare deltas.

## 2. Data model

### Gear item
Parsed from wiki `Item:` pages (same infobox approach as bosses — verified: pages expose a
structured "Bonuses" block with per-school icons):

```
{
  id, name, slot,                       // hat|robe|boots|wand|athame|amulet|ring|deck|mount
  school,                               // "Any" | Fire | Ice | ... (equip restriction)
  levelReq,
  stats: {
    maxHealth, maxMana,
    damage:   { global, Fire, Ice, ... },   // %
    resist:   { global, Fire, Ice, ... },   // %
    critical: { global, Fire, Ice, ... },   // rating
    block:    { global, Fire, Ice, ... },   // rating
    pierce, accuracy,                        // % (accuracy per-school possible)
    powerPipChance, shadowPipRating, pipConversion,
    incHealing, outHealing, stunResist, archmastery,
    flatDamage, flatResist                   // flat variants (jewels/some gear)
  },
  itemCards: [ ... ],                    // spells the gear grants to your deck
  setId,                                 // for set-bonus gear
  images: { styleA, styleB },            // gear art (for Phase 2 preview)
  source                                 // dropped-by / crowns / crafted
}
```

### Set bonus
Modern endgame gear gives bonuses at N equipped pieces. Parse and apply:
`{ setId, name, tiers: [ { pieces: 2, stats:{…} }, { pieces: 4, stats:{…} } … ] }`.

### Pet
Full pet genetics (training, hatching) is out of scope. We model the **outcome** — the
talents a pet manifests — which is what determines stats:

```
pet: { name, school, image, talents: [talentId × up to 5], mayCast: [...] }
talentLibrary: { id, name, stats:{…}, maxCast? }   // ~30 common talents
```
The user picks a pet (cosmetic + school) and up to 5 talents from a searchable list
(Spell-Proof +10% resist, Pain-Giver +6% damage, Armor-Breaker pierce, the flat "Ward"/"Giver"
talents, Critical/Pip talents, etc.). Each talent contributes flat/percent stats. This covers
the math every theorycrafter cares about without simulating the minigame.

## 3. Stat engine (the correctness core)

Combine sources in the right order — this is where a build tool earns trust:

1. Sum **flat** stats (gear + jewels + pet flat talents) per school.
2. Sum **percent** stats (gear + pet percent talents + set bonuses) per school; global adds to
   every school.
3. Present **critical/block** as raw rating **and** an approximate chance %, using the known
   level-based rating→% curve (vs an equal-level target; note it's an estimate). Source the
   formula from Final Bastion's published tables.
4. Show damage/resist as the final per-school % (flat shown separately, since flat is applied
   pre-resist in combat and can't be folded into a single %).
5. Health/mana/pips are simple sums.

Engine is a pure function `computeStats(equipped, pet) → totals`, unit-tested against a few
known real builds so the numbers match the game.

## 4. Data pipeline (extends the existing one)

Reuse the live-wiki access we already built (`scripts/7`–`10`, Cloudflare cleared via
undetected-chromedriver + curl_cffi):

- `enum_items.py` — walk the gear + pet categories, collect `Item:`/pet page titles.
- `fetch_items.py` — pull pages (resumable, cookie-refresh) into `data/raw_items/`.
- `parse_items.py` — infobox → the schema above → `site/data/items.json` (+ per-slot shards).
- `fetch_item_art.py` — Style A/B images → `site/img/gear/` → jsDelivr (Phase 2).

**Scope (decided):** level 100+ gear across all slots/schools + all pets. Ship as per-slot JSON
shards so the browser only loads a slot's items when its picker opens.

### Surfacing what's actually used
Keep it simple — no computed score, no editorial "meta" flag. Just structural filters:

1. **Default to the level cap.** Real theorycrafting happens at the level cap, so default the
   picker to the top brackets (150+/160+/170+) with a slider to widen. This alone cuts the
   visible set an order of magnitude to gear people actually equip.
2. **Filter by school + slot + level + source/set**, and free-text search. Sort by level (then
   name). Nothing hidden; the defaults just narrow to the relevant range.

## 5. UI / UX (the focus)

Reuse the existing design system (dark arcana, Cinzel display, school-colored accents, the
school icons and gear art we can mirror).

**Layout** (desktop): three zones.
- **Left — Character sheet.** Vertical stack of labeled slots, each showing the equipped
  item's art (Style A) + name, or an empty "+ add" state. Pet slot at the bottom with its 5
  talent chips. School selector at top (recolors accents, filters equip-legal gear).
- **Center — Item picker** (slides over the sheet when a slot is active). Search-as-you-type +
  filters (level, source, "stat > X"). Each row: item art, name, key stats, and a **live delta
  vs equipped** (green/red). Enter/click equips. Escape closes.
- **Right — Live stats panel.** Sticky. Grouped cards: Offense (damage/pierce/crit/accuracy per
  school, with icons), Defense (resist/block/health), Utility (pips/mana/healing/archmastery).
  Numbers **animate** on change; the just-changed stat pulses. A per-school toggle collapses to
  "your school only." Item cards granted by gear listed below.

**Signature interactions**
- Hover-to-preview deltas before committing.
- "Empty a slot" and "reset build."
- **Compare mode**: pin build A, load build B → side-by-side stat columns with deltas.
- Mobile: sheet and stats stack; picker becomes a full-screen sheet.

**Shareable build card**: a compact summary (school crest, key stats, slot list) styled like
the boss cards — the same visual family, and a natural thing to render to an image later.

## 6. Sharing + saved gallery (decided: both)

Two layers:

- **URL-encoded links (always works).** `#build?b=<base64>` packs item ids + pet talent ids +
  schema version; rehydrates on load. Zero-dependency, instant, links never expire. Also "copy
  as text" (a readable stat sheet).
- **Saved builds gallery (needs a small backend).** "Save build" → POST to a Vercel Serverless
  Function that writes to **Vercel KV** (Upstash Redis, free tier) keyed by a short id, returns
  `/#build/<id>`. A `/#builds` gallery lists saved builds (title, school crest, key stats) as
  cards in the existing visual style, opening into the editor. This is the one new piece of
  infrastructure — a couple of API routes (`POST /api/build`, `GET /api/build/:id`,
  `GET /api/builds`) and a KV namespace, all native to the Vercel project. Guards: rate-limit
  saves, cap payload size, validate against the item dataset so KV only holds valid ids.

Moderation/abuse surface is small (builds are just id lists), but titles are user text — escape
on render and cap length.

## 7. Phasing

- **Phase 0 — spike (½ day):** scrape ~200 items of one slot, prove the parser + stat engine
  against 2–3 known real builds. De-risks the math before UI investment.
- **Phase 1 — core tool:** full scrape (scoped per §4), stat engine, character sheet + picker +
  live stats, URL sharing. This is the deliverable.
- **Phase 2 — pets polish & compare:** talent library UI, set bonuses, compare mode.
- **Phase 3 — visual preview:** see §8.

## 8. Phase 2 initiative — "see the gear on a character" (feasibility)

**Verdict: partial is easy and looks great; full in-game character rendering is a separate,
heavy project — not recommended cheaply.**

- The wiki gives us each item's **own Style A/B art** (the hat, the robe, etc.). Showing that
  art in each slot — and a stylized avatar composed of the equipped pieces' icons — is
  **feasible now** and already implied by the character-sheet design. This is the recommended
  "preview."
- A true **3D character wearing the gear** (like the in-game dressing room) needs the game's
  actual models/textures. The linked repo (`naydevops/wizard`) is a **game-file downloader** —
  it can pull the client's `.wad` archives, but you'd then need to extract meshes/textures and
  build a WebGL renderer with a rigged avatar and per-slot attachment points. That's a
  multi-week graphics project with asset-licensing questions (KingsIsle assets), and the models
  aren't organized as easy paper-doll layers.
- **Middle option** if we want more than icons: some fan tools composite 2D "paper-doll"
  layers. W101 gear isn't published as clean layered sprites, so this would need manual asset
  work per item — high effort, partial coverage. Not worth it over the item-art approach.

Recommendation: do the **item-art-in-slots** preview as part of Phase 1/2; treat full character
rendering as a research spike only if there's strong demand.

## 9. Decisions (locked)

- **Gear scope:** level 100+, with data-side ranking/flags (§4) so cap-level, high-scored, meta
  gear surfaces first. Pipeline can widen later.
- **Pets:** talent-pick from a library (covers the stat math); fuller pet system deferred.
- **Sharing:** URL-encoded links **and** a saved-builds gallery backed by Vercel KV + serverless
  functions.
- **Character preview:** show each equipped item's real gear art in its slot (stylized avatar);
  full 3D rendering is a research-only spike, not scheduled.

## 10. Build order (proposed next steps)

1. **Phase 0 spike** — scrape ~200 items of one slot + the pet talent library; implement and
   unit-test `computeStats` against 2–3 known real builds. Confirms the math and the parse.
2. **Data pipeline** — scrape/parse level-100+ gear + pets; ship per-slot shards + gear art to
   jsDelivr.
3. **Core UI** — character sheet, item picker (search/filter/sort/deltas), live stats panel,
   URL sharing. This is the usable v1.
4. **Gallery backend** — Vercel KV + API routes + `/#builds` gallery + save flow.
5. **Polish** — set bonuses, compare mode, item-art avatar, mobile pass.

I can start on Phase 0 (the spike) whenever you want — it's the cheapest way to prove the
numbers are right before investing in the UI.
