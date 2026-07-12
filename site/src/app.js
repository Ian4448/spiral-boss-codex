import MiniSearch from 'minisearch';
import { renderBuild } from './build.js';

// Portraits are served from jsDelivr's CDN (backed by the GitHub repo) so the
// Vercel deploy stays tiny. Local dev uses the on-disk copies.
const IMG_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? './img'
  : 'https://cdn.jsdelivr.net/gh/Ian4448/spiral-boss-codex@main/site/img';

const SCHOOL_COLORS = {
  Fire: '#e8542f', Ice: '#6db9e8', Storm: '#8b5cf6', Myth: '#e8c02f',
  Life: '#4caf50', Death: '#a0a0b2', Balance: '#c98a3d', Shadow: '#9b59b6',
  Sun: '#f5a623', Moon: '#b0bec5', Star: '#ffd54f',
};
const SCHOOL_INITIALS = {
  Fire: 'F', Ice: 'I', Storm: 'S', Myth: 'M', Life: 'L', Death: 'D',
  Balance: 'B', Shadow: 'Sh', Sun: 'Su', Moon: 'Mo', Star: 'St',
};

// Tiny WebP for previews (dropdown, browse cards); full PNG for the detail page.
const thumbUrl = (slug) => `${IMG_BASE}/thumb/${esc(slug)}.webp`;
const fullUrl = (slug) => `${IMG_BASE}/${esc(slug)}.png`;

// Warm preview thumbnails for a set of bosses so they're cached before render.
const warmed = new Set();
function warmThumbs(slugs) {
  for (const slug of slugs) {
    if (warmed.has(slug) || !state.images.has(slug)) continue;
    warmed.add(slug);
    const img = new Image();
    img.decoding = 'async';
    img.src = thumbUrl(slug);
  }
}

// Portrait tile with school-monogram fallback when no image was archived.
function portraitTile(b, cls) {
  const c = SCHOOL_COLORS[b.school] || '';
  const style = c ? ` style="--sc:${c}"` : '';
  const img = state.images.has(b.slug)
    ? `<img src="${thumbUrl(b.slug)}" alt="" decoding="async" fetchpriority="high">`
    : '';
  return `<span class="${cls}"${style}>${SCHOOL_INITIALS[b.school] || '?'}${img}</span>`;
}

const state = {
  bosses: [],
  bySlug: new Map(),
  images: new Set(),
  mini: null,
  browse: { query: '', world: '', school: '', cheatersOnly: true, limit: 60 },
  semantic: { on: false, ready: false, loading: false, embedder: null, vectors: null, dims: 0, slugs: [] },
};

const $ = (id) => document.getElementById(id);

/* ---- local search history (this browser only) ---- */
const history_ = {
  KEY: 'sbc-history',
  read() {
    try { return { enabled: true, items: [], ...JSON.parse(localStorage.getItem(this.KEY) || '{}') }; }
    catch { return { enabled: true, items: [] }; }
  },
  write(h) { try { localStorage.setItem(this.KEY, JSON.stringify(h)); } catch { /* private mode */ } },
  push(slug) {
    const h = this.read();
    if (!h.enabled) return;
    h.items = [slug, ...h.items.filter((s) => s !== slug)].slice(0, 12);
    this.write(h);
  },
  clear() { const h = this.read(); h.items = []; this.write(h); },
  setEnabled(v) { const h = this.read(); h.enabled = v; if (!v) h.items = []; this.write(h); },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : n.toLocaleString('en-US'));

/* ============================== data ============================== */

async function loadData() {
  const [res, imgRes] = await Promise.all([
    fetch('./data/bosses.json'),
    fetch('./data/images.json').catch(() => null),
  ]);
  state.bosses = await res.json();
  for (const b of state.bosses) state.bySlug.set(b.slug, b);
  if (imgRes?.ok) state.images = new Set(await imgRes.json());

  state.mini = new MiniSearch({
    fields: ['name', 'world', 'locationText', 'cheatText', 'tagText', 'school'],
    storeFields: ['slug'],
    idField: 'slug',
    searchOptions: {
      boost: { name: 5, tagText: 2, world: 1.5 },
      fuzzy: 0.2,
      prefix: true,
      combineWith: 'AND',
    },
  });
  state.mini.addAll(state.bosses.map((b) => ({
    slug: b.slug,
    name: b.name,
    world: b.world || '',
    school: b.school || '',
    locationText: (b.locations || []).join(' '),
    cheatText: (b.cheats || []).join(' ').replace(/\[[^\]]*\]/g, ' '),
    tagText: (b.tagLabels || []).join(' '),
  })));

  route();
}

/* ============================== search core ============================== */

function lexical(query) {
  if (!query.trim()) return [];
  let hits = state.mini.search(query);
  if (!hits.length) hits = state.mini.search(query, { combineWith: 'OR' });
  return hits.map((h) => ({ boss: state.bySlug.get(h.id), score: h.score })).filter((r) => r.boss);
}

async function semantic(query) {
  const s = state.semantic;
  const out = await s.embedder(query, { pooling: 'mean', normalize: true });
  const q = out.data;
  const scored = [];
  for (let i = 0; i < s.slugs.length; i++) {
    let dot = 0;
    const off = i * s.dims;
    for (let d = 0; d < s.dims; d++) dot += q[d] * s.vectors[off + d];
    scored.push({ slug: s.slugs[i], score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 60)
    .filter((r) => r.score > 0.25)
    .map((r) => ({ boss: state.bySlug.get(r.slug), score: r.score }))
    .filter((r) => r.boss);
}

let seq = 0;
async function search(query) {
  const my = ++seq;
  let results = lexical(query);
  if (state.semantic.ready && state.semantic.on && query.trim().length > 2) {
    try {
      const sem = await semantic(query);
      if (my !== seq) return null; // superseded by newer keystroke
      const seen = new Set();
      const merged = [];
      const strongLex = results.filter((r) => r.score > 18);
      for (const r of [...strongLex, ...sem, ...results]) {
        if (!seen.has(r.boss.slug)) { seen.add(r.boss.slug); merged.push(r); }
      }
      results = merged;
    } catch (e) { console.warn('semantic failed', e); }
  }
  return results;
}

/* ============================== search boxes ============================== */

function makeSearchBox(inputEl, dropdownEl) {
  let items = [];
  let active = -1;
  let debounce;

  function close() {
    dropdownEl.hidden = true;
    dropdownEl.innerHTML = '';
    items = [];
    active = -1;
  }

  function openBoss(slug) {
    close();
    inputEl.blur();
    location.hash = `#boss/${slug}`;
  }

  function goBrowse() {
    state.browse.query = inputEl.value;
    state.browse.cheatersOnly = false;
    close();
    if (location.hash === '#browse') renderBrowse(); else location.hash = '#browse';
  }

  function ddRow(b, i) {
    const tags = (b.tagLabels || []).slice(0, 2);
    return `
      <button class="dd-item" data-i="${i}" data-slug="${esc(b.slug)}">
        ${portraitTile(b, 'dd-school')}
        <span class="dd-main">
          <span class="dd-name">${esc(b.name)}</span>
          <span class="dd-meta">${[b.world, b.rank != null ? `Rank ${b.rank}` : null, b.health != null ? `${fmt(b.health)} HP` : null].filter(Boolean).map(esc).join(' · ')}</span>
        </span>
        <span class="dd-tags">${
          tags.length ? tags.map((t) => `<span class="dd-tag">${esc(t)}</span>`).join('')
          : `<span class="dd-tag plain">${b.cheats?.length ? 'cheats' : 'no cheats'}</span>`
        }</span>
      </button>`;
  }

  function bindRows() {
    dropdownEl.querySelectorAll('.dd-item').forEach((el) => {
      el.addEventListener('click', () => openBoss(el.dataset.slug));
      el.addEventListener('mousemove', () => setActive(+el.dataset.i));
    });
  }

  function renderRecent() {
    const h = history_.read();
    if (!h.enabled) {
      items = []; active = -1;
      dropdownEl.innerHTML = `<div class="dd-foot"><span>History is off</span><button class="dd-all" data-act="on">Turn on</button></div>`;
      dropdownEl.hidden = false;
      dropdownEl.querySelector('[data-act="on"]').addEventListener('click', () => { history_.setEnabled(true); close(); });
      return;
    }
    const bosses = h.items.map((s) => state.bySlug.get(s)).filter(Boolean);
    if (!bosses.length) { close(); return; }
    warmThumbs(bosses.map((b) => b.slug));
    items = bosses.map((b) => ({ boss: b }));
    active = -1;
    dropdownEl.innerHTML = items.slice(0, 6).map(({ boss: b }, i) => ddRow(b, i)).join('') + `
      <div class="dd-foot">
        <span>Recent</span>
        <span><button class="dd-all" data-act="clear">Clear</button><button class="dd-all dim" data-act="off">Turn off</button></span>
      </div>`;
    dropdownEl.hidden = false;
    bindRows();
    dropdownEl.querySelector('[data-act="clear"]').addEventListener('click', () => { history_.clear(); close(); inputEl.focus(); });
    dropdownEl.querySelector('[data-act="off"]').addEventListener('click', () => { history_.setEnabled(false); close(); inputEl.focus(); });
  }

  function renderDropdown(results, query) {
    if (!query.trim()) { renderRecent(); return; }
    warmThumbs(results.slice(0, 16).map((r) => r.boss.slug)); // prefetch a bit past what's shown
    items = results.slice(0, 8);
    active = -1;
    if (!items.length) {
      dropdownEl.innerHTML = `<div class="dd-empty">No results for <b>${esc(query)}</b></div>`;
      dropdownEl.hidden = false;
      return;
    }
    dropdownEl.innerHTML = items.map(({ boss: b }, i) => ddRow(b, i)).join('') + `
      <div class="dd-foot">
        <button class="dd-all" data-act="all">All ${results.length} result${results.length === 1 ? '' : 's'}</button>
        <span class="dd-keys"><span>&uarr;&darr;</span><span>&crarr;</span><span>esc</span></span>
      </div>`;
    dropdownEl.hidden = false;
    bindRows();
    dropdownEl.querySelector('[data-act="all"]')?.addEventListener('click', goBrowse);
  }

  function setActive(i) {
    active = i;
    dropdownEl.querySelectorAll('.dd-item').forEach((el, j) =>
      el.classList.toggle('active', j === active));
  }

  async function run() {
    const q = inputEl.value;
    inputEl.closest('.searchbox').classList.toggle('has-query', !!q);
    const results = await search(q);
    if (results === null) return;
    if (document.activeElement === inputEl) renderDropdown(results, q);
  }

  inputEl.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 110); });
  inputEl.addEventListener('focus', run);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) setActive(Math.min(active + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') {
      if (active >= 0 && items[active]) openBoss(items[active].boss.slug);
      else if (items.length === 1) openBoss(items[0].boss.slug);
      else if (inputEl.value.trim()) goBrowse();
    } else if (e.key === 'Escape') { close(); inputEl.blur(); }
  });
  document.addEventListener('click', (e) => {
    if (!inputEl.closest('.searchbox').contains(e.target)) close();
  });

  return { input: inputEl, close, run };
}

/* ============================== smart search ============================== */

const smartPills = () => [$('smartPill'), $('smartPillTop')].filter(Boolean);

function setSmartUI(cls, status) {
  for (const p of smartPills()) {
    p.classList.remove('on', 'loading');
    if (cls) p.classList.add(cls);
  }
  const s = $('smartStatus');
  if (s) s.textContent = status || '';
}

async function toggleSmart() {
  const s = state.semantic;
  if (s.loading) return;
  if (s.on) { s.on = false; setSmartUI(null, ''); return; }
  s.on = true;
  if (s.ready) { setSmartUI('on', ''); return; }
  s.loading = true;
  setSmartUI('loading', '· loading model');
  try {
    const [tf, metaRes, binRes] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'),
      fetch('./data/embeddings.meta.json'),
      fetch('./data/embeddings.bin'),
    ]);
    tf.env.allowLocalModels = false; // otherwise it probes ./models/* and 404s
    const meta = await metaRes.json();
    const buf = await binRes.arrayBuffer();
    const int8 = new Int8Array(buf);
    const vectors = new Float32Array(int8.length);
    for (let i = 0; i < int8.length; i++) vectors[i] = int8[i] * meta.scale;
    Object.assign(s, { vectors, dims: meta.dims, slugs: meta.slugs });
    s.embedder = await tf.pipeline('feature-extraction', meta.model, { quantized: true });
    s.ready = true;
    setSmartUI('on', '· ready');
    setTimeout(() => setSmartUI('on', ''), 2500);
  } catch (e) {
    console.error(e);
    s.on = false;
    setSmartUI(null, '· failed to load');
  } finally {
    s.loading = false;
  }
}

/* ============================== token rendering ============================== */

function iconTokens(text) {
  return esc(text).replace(/\[([^\]]{1,60})\]/g, (m, name) => {
    if (SCHOOL_COLORS[name]) {
      return `<img class="school-icon" src="${IMG_BASE}/schools/${name}.png" alt="${name}" title="${name}" loading="lazy">`;
    }
    return `<span class="icon-token">${name}</span>`;
  });
}

/* ============================== boss page ============================== */

function renderBoss(slug) {
  const el = $('bossPage');
  const b = state.bySlug.get(slug);
  if (!b) {
    el.innerHTML = `<div class="not-found"><p>Boss not found.</p><p><a href="#browse">Browse all</a></p></div>`;
    return;
  }
  const c = SCHOOL_COLORS[b.school] || 'var(--accent)';
  const snap = b.snapshotTs ? `${b.snapshotTs.slice(0, 4)}-${b.snapshotTs.slice(4, 6)}` : null;
  const stats = b.stats || {};
  const statRows = [
    ['Starting pips', stats.startingPips], ['Shadow pips', stats.shadowPips],
    ['Critical', stats.critical], ['Critical block', stats.criticalBlock],
    ['Pierce', stats.pierce], ['Damage boost', stats.outgoingBoost],
    ['Takes boost', stats.incomingBoost], ['Resist', stats.resist],
    ['Outgoing healing', stats.outgoingHealing], ['Incoming healing', stats.incomingHealing],
    ['Stunable', stats.stunable], ['Beguilable', stats.beguilable],
  ].filter(([, v]) => v);

  const cheatCard = (rawText, i) => {
    const text = rawText.replace(/[\s:：-]+$/, '').trim(); // drop dangling ": " on quote-only lines
    const note = b.cheatNotes?.[i];
    const noteHtml = note ? `<span class="cheat-note">${iconTokens(note)}</span>` : '';
    const m = text.match(/^["“]([^"”]{2,120})["”]\s*[-–—]?\s*(.*)$/s);
    const rest = m ? m[2].trim() : '';
    const body = (m && rest)
      ? `<span class="cheat-quote">“${iconTokens(m[1])}”</span>${iconTokens(rest)}`
      : m
        ? `<span class="cheat-quote lone">“${iconTokens(m[1])}”</span>`
        : iconTokens(text);
    return `<div class="cheat-card" style="--sc:${c}">${body}${noteHtml}</div>`;
  };

  const plan = Array.isArray(b.strategy) ? b.strategy : [b.strategy].filter(Boolean);

  const portrait = state.images.has(b.slug)
    ? `<img class="boss-portrait" style="--sc:${c}" src="${fullUrl(b.slug)}" alt="${esc(b.name)}" decoding="async">`
    : '';
  el.innerHTML = `
    <header class="boss-head ${portrait ? 'has-portrait' : ''}">
      ${portrait}
      <p class="boss-eyebrow">${esc(b.world || 'The Spiral')}</p>
      <div class="boss-title-row">
        <h1 class="boss-title">${esc(b.name)}</h1>
        ${b.school ? `<span class="school-badge" style="--sc:${c}">${esc(b.school)}</span>` : ''}
      </div>
      <div class="boss-divider" style="--sc:${c}"></div>
      <div class="meta-row">
        <div class="meta-pill"><b>${b.rank ?? '—'}</b><span>Rank</span></div>
        <div class="meta-pill"><b>${fmt(b.health)}</b><span>Health</span></div>
        ${b.classification ? `<div class="meta-pill"><b>${esc(b.classification)}</b><span>Type</span></div>` : ''}
        <div class="meta-pill"><b>${b.cheats?.length ? 'Yes' : 'No'}</b><span>Cheats</span></div>
      </div>
      ${b.locations?.length ? `<p class="boss-location">${b.locations.map(esc).join(' · ')}</p>` : ''}
    </header>

    <section class="boss-section">
      <p class="section-label">Game plan${b.groupFight ? '<span class="group-badge">Team fight</span>' : ''}</p>
      <div class="strategy-panel">
        ${plan.length > 1
          ? `<ol class="plan">${plan.map((s) => `<li>${iconTokens(s)}</li>`).join('')}</ol>`
          : `<p>${iconTokens(plan[0] || '')}</p>`}
      </div>
      ${b.guide ? `<a class="guide-link" href="${esc(b.guide.url)}" target="_blank" rel="noopener">
        <span class="guide-link-body">
          <span class="guide-link-label">${b.guideSourced ? 'Strategy from Final Bastion' : 'Full walkthrough'}</span>
          <span class="guide-link-title">${esc(b.guide.title)} — Final Bastion</span>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
      </a>` : ''}
      ${b.tagLabels?.length ? `<div class="tags-row">${b.tagLabels.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
    </section>

    <section class="boss-section">
      <p class="section-label">Cheats</p>
      ${b.cheats?.length
        ? b.cheats.map((t, i) => cheatCard(t, i)).join('')
        : '<div class="no-cheats">No cheats reported.</div>'}
    </section>

    ${statRows.length ? `
    <section class="boss-section">
      <p class="section-label">Battle stats</p>
      <div class="stats-grid">
        ${statRows.map(([k, v]) => `<div class="stat-tile"><div class="stat-k">${k}</div><div class="stat-v">${iconTokens(v)}</div></div>`).join('')}
      </div>
    </section>` : ''}

    ${(b.minions?.length || b.summons?.length) ? `
    <section class="boss-section">
      <p class="section-label">Fights alongside</p>
      ${b.minions?.length ? `<div class="ally-group"><p class="ally-kind">Minions</p><div class="ally-pills">${b.minions.map(allyPill).join('')}</div></div>` : ''}
      ${b.summons?.length ? `<div class="ally-group"><p class="ally-kind">Summons</p><div class="ally-pills">${b.summons.map(allyPill).join('')}</div></div>` : ''}
    </section>` : ''}

    ${b.spellNotes?.length ? `
    <section class="boss-section">
      <p class="section-label">Spell notes</p>
      <ul class="notes-list">${b.spellNotes.map((s) => `<li>${iconTokens(s)}</li>`).join('')}</ul>
    </section>` : ''}

    <p class="provenance">
      Source: <a href="${esc(b.wikiUrl)}" target="_blank" rel="noopener">Wizard101 Central Wiki</a>${snap ? `, snapshot ${snap}` : ''}
    </p>`;
  window.scrollTo({ top: 0 });
}

function allyPill(name) {
  const slug = name.replace(/[^A-Za-z0-9()'!-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return state.bySlug.has(slug)
    ? `<a class="ally-pill" href="#boss/${esc(slug)}">${esc(name)}</a>`
    : `<span class="ally-pill">${esc(name)}</span>`;
}

/* ============================== browse page ============================== */

function browseResults() {
  const f = state.browse;
  let list;
  if (f.query.trim()) {
    list = lexical(f.query).map((r) => r.boss);
  } else {
    list = state.bosses;
  }
  return list.filter((b) => {
    if (f.cheatersOnly && !(b.cheats && b.cheats.length)) return false;
    if (f.world && b.world !== f.world) return false;
    if (f.school && b.school !== f.school) return false;
    return true;
  });
}

function renderBrowse() {
  const el = $('browsePage');
  const f = state.browse;
  const worlds = [...new Set(state.bosses.map((b) => b.world).filter(Boolean))].sort();
  const schools = [...new Set(state.bosses.map((b) => b.school).filter(Boolean))].sort();

  const results = browseResults();
  const shown = results.slice(0, f.limit);
  warmThumbs(shown.map((b) => b.slug));

  el.innerHTML = `
    <div class="browse-head">
      <h1 class="browse-title">${f.query.trim() ? `“${esc(f.query)}”` : 'All bosses'}</h1>
      <span class="browse-count">${results.length} boss${results.length === 1 ? '' : 'es'}</span>
    </div>
    <div class="browse-filters">
      <select id="bWorld"><option value="">All worlds</option>${worlds.map((w) => `<option ${w === f.world ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select>
      <select id="bSchool"><option value="">All schools</option>${schools.map((s) => `<option ${s === f.school ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="bCheaters" ${f.cheatersOnly ? 'checked' : ''}> Cheaters only</label>
    </div>
    ${shown.length ? `<div class="browse-grid">${shown.map(bossCard).join('')}</div>` : '<p class="browse-empty">No results.</p>'}
    ${results.length > shown.length ? `<button class="browse-more" id="bMore">Show more (${results.length - shown.length} left)</button>` : ''}
  `;

  $('bWorld').addEventListener('change', (e) => { f.world = e.target.value; f.limit = 60; renderBrowse(); });
  $('bSchool').addEventListener('change', (e) => { f.school = e.target.value; f.limit = 60; renderBrowse(); });
  $('bCheaters').addEventListener('change', (e) => { f.cheatersOnly = e.target.checked; f.limit = 60; renderBrowse(); });
  $('bMore')?.addEventListener('click', () => { f.limit += 120; renderBrowse(); });
  el.querySelectorAll('.boss-card').forEach((card) => card.addEventListener('click', () => {
    location.hash = `#boss/${card.dataset.slug}`;
  }));
}

function bossCard(b) {
  const tags = (b.tagLabels || []).slice(0, 3);
  return `
  <button class="boss-card" data-slug="${esc(b.slug)}">
    ${portraitTile(b, 'bc-portrait')}
    <span class="bc-body">
      <span class="bc-name">${esc(b.name)}</span>
      <span class="bc-meta">${[b.world, b.rank != null ? `Rank ${b.rank}` : null, b.health != null ? `${fmt(b.health)} HP` : null].filter(Boolean).map(esc).join(' · ')}</span>
      ${tags.length ? `<span class="bc-tags">${tags.map((t) => `<span class="dd-tag">${esc(t)}</span>`).join('')}${(b.tagLabels.length > 3) ? `<span class="dd-tag plain">+${b.tagLabels.length - 3}</span>` : ''}</span>` : ''}
    </span>
  </button>`;
}

/* ============================== routing ============================== */

function route() {
  const h = location.hash;
  const bossMatch = h.match(/^#boss\/(.+)$/);
  if (bossMatch) {
    setView('app');
    $('bossPage').hidden = false;
    $('browsePage').hidden = true;
    const slug = decodeURIComponent(bossMatch[1]);
    if (state.bySlug.has(slug)) history_.push(slug);
    renderBoss(slug);
  } else if (h === '#browse') {
    setView('app');
    $('bossPage').hidden = true;
    $('browsePage').hidden = false;
    renderBrowse();
  } else if (h.startsWith('#build')) {
    setView('build');
    renderBuild(h);
  } else {
    setView('home');
  }
}

function setView(v) {
  document.body.dataset.view = v;
  $('viewHome').hidden = v !== 'home';
  $('viewApp').hidden = v !== 'app';
  const vb = $('viewBuild');
  if (vb) vb.hidden = v !== 'build';
  if (v === 'home') {
    setTimeout(() => $('homeSearch').focus(), 30);
  }
}

/* ============================== boot ============================== */

const homeBox = makeSearchBox($('homeSearch'), $('homeDropdown'));
const topBox = makeSearchBox($('topSearch'), $('topDropdown'));

$('smartPill').addEventListener('click', toggleSmart);
$('smartPillTop').addEventListener('click', toggleSmart);

document.querySelectorAll('.quick-chip[data-q]').forEach((chip) =>
  chip.addEventListener('click', () => {
    const box = document.body.dataset.view === 'home' ? homeBox : topBox;
    box.input.value = chip.dataset.q;
    box.input.focus();
    box.run();
  }));

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    const box = document.body.dataset.view === 'home' ? homeBox : topBox;
    box.input.focus();
    box.input.select();
  }
});

window.addEventListener('hashchange', route);

loadData();
