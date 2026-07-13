// Build Creator — assemble gear + pet, see stats update live, share by link.
import { computeStats, diffTotals, criticalChance, SCHOOLS, PER_SCHOOL } from './stats.js';

const IMG_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? './img'
  : 'https://cdn.jsdelivr.net/gh/Ian4448/spiral-boss-codex@main/site/img';

const SCHOOL_COLORS = {
  Fire: '#e8542f', Ice: '#6db9e8', Storm: '#8b5cf6', Myth: '#e8c02f',
  Life: '#4caf50', Death: '#a0a0b2', Balance: '#c98a3d',
};
const SLOTS = [
  { key: 'hat', label: 'Hat' }, { key: 'robe', label: 'Robe' }, { key: 'boots', label: 'Boots' },
  { key: 'wand', label: 'Wand' }, { key: 'athame', label: 'Athame' }, { key: 'amulet', label: 'Amulet' },
  { key: 'ring', label: 'Ring' }, { key: 'deck', label: 'Deck' },
];

// Pet talent library — the manifestable stat talents, grouped by category.
// Values are the standard maxed-pet contributions. Each talent adds flat/%
// stats via the same engine as gear.
const _PS = ['Fire', 'Ice', 'Storm', 'Myth', 'Life', 'Death', 'Balance'];
const PET_TALENTS = [
  { id: 'paingiver', name: 'Pain-Giver', cat: 'Damage', stats: { damage: { Global: 6 } } },
  { id: 'painbringer', name: 'Pain-Bringer', cat: 'Damage', stats: { damage: { Global: 5 } } },
  ..._PS.map((s) => ({ id: `${s.toLowerCase()}dealer`, name: `${s}-Dealer`, cat: 'Damage', stats: { damage: { [s]: 4 } } })),
  ..._PS.map((s) => ({ id: `${s.toLowerCase()}boon`, name: `${s}-Boon`, cat: 'Damage', stats: { damage: { [s]: 3 } } })),
  { id: 'spellproof', name: 'Spell-Proof', cat: 'Resist', stats: { resist: { Global: 10 } } },
  { id: 'spelldefy', name: 'Spell-Defying', cat: 'Resist', stats: { resist: { Global: 5 } } },
  ..._PS.map((s) => ({ id: `${s.toLowerCase()}proof`, name: `${s}-Proof`, cat: 'Resist', stats: { resist: { [s]: 10 } } })),
  ..._PS.map((s) => ({ id: `${s.toLowerCase()}ward`, name: `${s}-Ward`, cat: 'Resist', stats: { resist: { [s]: 15 } } })),
  { id: 'mightypierce', name: 'Armor Piercer (Mighty)', cat: 'Pierce & Accuracy', stats: { pierce: { Global: 3 } } },
  { id: 'sharpshot', name: 'Sharp-Shot', cat: 'Pierce & Accuracy', stats: { accuracy: { Global: 5 } } },
  { id: 'accurate', name: 'Accurate', cat: 'Pierce & Accuracy', stats: { accuracy: { Global: 4 } } },
  { id: 'critstriker', name: 'Critical Striker', cat: 'Critical & Block', stats: { critical: { Global: 60 } } },
  { id: 'crithitter', name: 'Critical Hitter', cat: 'Critical & Block', stats: { critical: { Global: 40 } } },
  { id: 'block', name: 'Pip Conserver (block)', cat: 'Critical & Block', stats: { block: { Global: 55 } } },
  { id: 'pipomatic', name: 'Pip O’Matic', cat: 'Pips', stats: { powerPipChance: 5 } },
  { id: 'mightpip', name: 'Pip Conserver', cat: 'Pips', stats: { powerPipChance: 3 } },
  { id: 'addhealth', name: 'Add Health', cat: 'Health & Mana', stats: { maxHealth: 165 } },
  { id: 'healthgift', name: 'Health-Gift', cat: 'Health & Mana', stats: { maxHealth: 110 } },
  { id: 'addmana', name: 'Add Mana', cat: 'Health & Mana', stats: { maxMana: 75 } },
];
const TALENT_CATS = ['Damage', 'Resist', 'Pierce & Accuracy', 'Critical & Block', 'Pips', 'Health & Mana'];

const state = {
  loaded: false,
  school: 'Storm',
  level: 170,
  equipped: {},              // slot -> item
  petTalents: [],            // talent ids
  cache: {},                 // slot -> items[]
  index: {},
  activeSlot: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
const schoolIcon = (s) => `<img class="school-icon" src="${IMG_BASE}/schools/${s}.png" alt="${s}" title="${s}">`;

/* -------------- data -------------- */

async function ensureIndex() {
  if (state.loaded) return;
  try {
    state.index = await (await fetch('./data/gear/index.json')).json();
  } catch { state.index = {}; }
  try {
    state.presets = await (await fetch('./data/presets.json')).json();
    // give each meta item a stable slug + group by slot so they're pickable too
    state.wbBySlot = {};
    for (const it of Object.values(state.presets.items || {})) {
      it.slug = `wb:${it.id}`;
      it.meta = true;
      (state.wbBySlot[it.slot] ||= []).push(it);
    }
  } catch { state.presets = null; state.wbBySlot = {}; }
  state.loaded = true;
}
async function loadSlot(slot) {
  if (state.cache[slot]) return state.cache[slot];
  let wiki = [];
  try {
    wiki = await (await fetch(`./data/gear/${slot}.json`)).json();
  } catch { wiki = []; }
  // meta (WizBuilder) items for this slot are pickable too, listed first
  const meta = (state.wbBySlot && state.wbBySlot[slot]) || [];
  state.cache[slot] = [...meta, ...wiki];
  return state.cache[slot];
}

/* -------------- stat totals -------------- */

function currentTotals() {
  const items = Object.values(state.equipped);
  const talents = state.petTalents.map((id) => PET_TALENTS.find((t) => t.id === id)).filter(Boolean);
  return computeStats([...items, ...talents]);
}

/* -------------- render: character sheet -------------- */

function slotCard(slot, label) {
  const it = state.equipped[slot.key ? slot.key : slot];
  const key = slot.key || slot;
  if (it) {
    const top = topStats(it);
    return `<button class="slot-card filled" data-slot="${key}">
      <span class="slot-tag">${label}</span>
      <span class="slot-name">${esc(it.name)}</span>
      <span class="slot-lvl">Lvl ${it.level}${it.school !== 'Any' ? ' · ' + esc(it.school) : ''}</span>
      <span class="slot-stats">${top}</span>
      <span class="slot-remove" data-remove="${key}" title="Remove">×</span>
    </button>`;
  }
  return `<button class="slot-card empty" data-slot="${key}">
    <span class="slot-tag">${label}</span>
    <span class="slot-add">+ add ${label.toLowerCase()}</span>
  </button>`;
}

const SCHOOL_ABBR = { Fire: 'Fire', Ice: 'Ice', Storm: 'Storm', Myth: 'Myth', Life: 'Life', Death: 'Death', Balance: 'Bal', Global: 'all' };
const STAT_UNIT = { damage: '%', resist: '%', pierce: '%', accuracy: '%', critical: '', block: '' };
const STAT_WORD = { damage: 'dmg', resist: 'resist', pierce: 'pierce', accuracy: 'acc', critical: 'crit', block: 'block' };

// Expressive per-school description of an item's stats, e.g.
// "+1070 hp · +22% Fire dmg · +18% Myth dmg · +104 Fire crit · +12% resist"
function describeStats(stats, { max = 99 } = {}) {
  const out = [];
  if (stats.maxHealth) out.push(`+${stats.maxHealth} hp`);
  if (stats.maxMana) out.push(`+${stats.maxMana} mana`);
  for (const k of ['damage', 'critical', 'pierce', 'resist', 'accuracy', 'block']) {
    const perSchool = stats[k];
    if (!perSchool) continue;
    // sort schools by magnitude, put Global last as "all"
    const entries = Object.entries(perSchool).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    for (const [school, v] of entries) {
      if (!v) continue;
      const label = school === 'Global' ? `${STAT_WORD[k]} (all)` : `${SCHOOL_ABBR[school]} ${STAT_WORD[k]}`;
      out.push(`${fmt(v)}${STAT_UNIT[k]} ${label}`);
    }
  }
  if (stats.powerPipChance) out.push(`+${stats.powerPipChance}% power pip`);
  if (stats.shadowPipRating) out.push(`+${stats.shadowPipRating} shadow pip`);
  return out.slice(0, max);
}

// compact 3-stat summary for slot cards, focused on the equipped school
function topStats(it) {
  const s = it.stats || {};
  const parts = [];
  if (s.maxHealth) parts.push(`${s.maxHealth} hp`);
  for (const k of ['damage', 'critical', 'pierce']) {
    if (s[k]) {
      const v = (s[k][state.school] || 0) + (s[k].Global || 0);
      if (v) parts.push(`${fmt(v)}${STAT_UNIT[k]} ${SCHOOL_ABBR[state.school]} ${STAT_WORD[k]}`);
    }
  }
  return parts.slice(0, 3).map((p) => `<span>${p}</span>`).join('');
}

// Community builds (Riddler208's 2026 guide) — shown natively in-app, not linked out.
function renderPresets() {
  const p = state.presets;
  if (!p || !p.builds) return '';
  const mine = p.builds.filter((b) => b.school === state.school).sort((a, b) => a.level - b.level);
  if (!mine.length) return '';
  const chips = mine.map((b) => {
    const near = Math.abs(b.level - state.level) <= 20;
    return `<button class="preset-chip ${near ? 'near' : ''}" data-preset="${b.level}">Lvl ${b.level}</button>`;
  }).join('');
  return `<div class="presets-strip">
    <div class="presets-head">
      <span class="presets-title">Community ${esc(state.school)} builds</span>
      <a class="presets-credit" href="${esc(p.source.url)}" target="_blank" rel="noopener">by ${esc(p.source.author)} · ${esc(p.source.title)}</a>
    </div>
    <div class="presets-chips">${chips}</div>
  </div>`;
}

const SLOT_LABEL = { hat: 'Hat', robe: 'Robe', boots: 'Boots', wand: 'Wand', athame: 'Athame', amulet: 'Amulet', ring: 'Ring', deck: 'Deck' };

function buildItems(b) {
  // resolve slot -> full item object from the presets item table
  const items = {};
  for (const [slot, id] of Object.entries(b.gear || {})) {
    const it = state.presets.items[id];
    if (it) items[slot] = it;
  }
  return items;
}

function openCommunityBuild(level) {
  const b = state.presets.builds.find((x) => x.school === state.school && x.level === level);
  if (!b) return;
  const c = SCHOOL_COLORS[b.school] || 'var(--accent)';
  const items = buildItems(b);
  // gear-only totals (community defaults don't prescribe a pet)
  const totals = computeStats(Object.values(items));
  const sf = b.school;
  const cell = (label, val) => `<div class="cb-stat"><span>${label}</span><b>${val}</b></div>`;
  const gearRows = Object.keys(SLOT_LABEL).map((slot) => {
    const it = items[slot];
    if (!it) return `<div class="cb-slot"><span class="cb-slot-tag">${SLOT_LABEL[slot]}</span><span class="cb-item empty">— not saved in source</span></div>`;
    const desc = describeStats(it.stats, { max: 6 }).map((d) => `<span class="cb-mini">${esc(d)}</span>`).join('');
    return `<div class="cb-slot col"><div class="cb-slot-top"><span class="cb-slot-tag">${SLOT_LABEL[slot]}</span>
      <span class="cb-item">${esc(it.name)} <b>Lvl ${it.level}</b></span></div>
      <div class="cb-mini-row">${desc}</div></div>`;
  }).join('');
  const picker = $('itemPicker');
  picker.hidden = false;
  document.body.classList.add('picker-open');
  picker.innerHTML = `<div class="picker-head cb-head" style="--sc:${c}">
      <div><span class="cb-eyebrow">${esc(b.school)} · Level ${b.level}</span><div class="cb-title">Community build</div></div>
      <button class="picker-close" id="pickerClose">esc</button>
    </div>
    <div class="cb-body">
      <button class="cb-load" id="cbLoad">Load this build into the creator</button>
      <div class="cb-stats">
        ${cell('Health', totals.maxHealth || 0)}
        ${cell(`${sf} dmg`, `${totals.damage[sf] || 0}%`)}
        ${cell(`${sf} resist`, `${totals.resist[sf] || 0}%`)}
        ${cell(`${sf} crit`, totals.critical[sf] || 0)}
        ${cell(`${sf} pierce`, `${totals.pierce[sf] || 0}%`)}
        ${cell('Power pip', `${totals.powerPipChance || 0}%`)}
      </div>
      <p class="cb-section">Gear</p>
      <div class="cb-gear">${gearRows}</div>
      <p class="cb-note">From ${esc(state.presets.source.author)}'s <a href="${esc(state.presets.source.url)}" target="_blank" rel="noopener">${esc(state.presets.source.title)}</a>. Item stats via WizBuilder. Pick your own pet talents after loading.</p>
    </div>`;
  $('pickerClose').addEventListener('click', closePicker);
  $('cbLoad').addEventListener('click', () => loadCommunityBuild(b));
}

function petTalentByName(name) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  return PET_TALENTS.find((t) => norm(t.name).startsWith(norm(name))) || null;
}

function loadCommunityBuild(b) {
  state.equipped = buildItems(b);
  state.petTalents = [];   // you choose your own pet talents
  state.level = b.level;
  closePicker();
  $('buildLevel').value = state.level; $('buildLevelVal').textContent = state.level;
  rerender();
  syncUrl();
}

function renderSheet() {
  const petChips = state.petTalents.length
    ? state.petTalents.map((id) => {
        const t = PET_TALENTS.find((x) => x.id === id);
        return `<span class="pet-chip" data-pet="${id}">${esc(t ? t.name : id)}<b data-petremove="${id}">×</b></span>`;
      }).join('')
    : '<span class="pet-empty">no talents</span>';

  return `
    <div class="char-sheet">
      <div class="sheet-slots">
        ${SLOTS.map((s) => slotCard(s, s.label)).join('')}
      </div>
      <div class="pet-block">
        <div class="pet-head"><span class="slot-tag">Pet</span><span class="pet-count">${state.petTalents.length}/5 talents</span></div>
        <div class="pet-chips">${petChips}</div>
        <button class="pet-add-btn" id="petAddBtn" ${state.petTalents.length >= 5 ? 'disabled' : ''}>+ add talent</button>
        <div class="pet-talent-menu" id="petMenu" hidden></div>
      </div>
    </div>`;
}

/* -------------- render: stats panel -------------- */

function statRow(label, totals, key, unit, showChance) {
  const cells = SCHOOLS.map((s) => {
    const v = totals[key][s];
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
    let txt = v ? `${v}${unit}` : '·';
    if (showChance && v) txt = `${Math.round(criticalChance(v, state.level) * 100)}%`;
    return `<td class="${cls}" style="--sc:${SCHOOL_COLORS[s]}">${txt}</td>`;
  }).join('');
  return `<tr><th>${label}</th>${cells}</tr>`;
}

function renderStats() {
  const t = currentTotals();
  const head = `<tr><th></th>${SCHOOLS.map((s) => `<td class="hcol" style="--sc:${SCHOOL_COLORS[s]}">${schoolIcon(s)}</td>`).join('')}</tr>`;
  const flat = (k, label, unit = '') => `<div class="stat-flat"><span>${label}</span><b>${t[k] || 0}${unit}</b></div>`;
  return `
    <div class="stats-panel">
      <div class="stat-group">
        <div class="stat-flats">
          ${flat('maxHealth', 'Health')}
          ${flat('maxMana', 'Mana')}
          ${flat('powerPipChance', 'Power Pip', '%')}
          ${flat('shadowPipRating', 'Shadow Pip')}
        </div>
      </div>
      <div class="stat-group">
        <p class="stat-title">Per school</p>
        <table class="stat-table">
          ${head}
          ${statRow('Damage', t, 'damage', '%')}
          ${statRow('Resist', t, 'resist', '%')}
          ${statRow('Pierce', t, 'pierce', '%')}
          ${statRow('Accuracy', t, 'accuracy', '%')}
          ${statRow('Critical', t, 'critical', '')}
          ${statRow('Crit %', t, 'critical', '', true)}
          ${statRow('Block', t, 'block', '')}
        </table>
        <p class="stat-note">Crit % is an estimate vs a level-${state.level} target.</p>
      </div>
    </div>`;
}

/* -------------- render: item picker -------------- */

let pickerQuery = '';
async function openPicker(slot) {
  state.activeSlot = slot;
  const picker = $('itemPicker');
  picker.hidden = false;
  picker.innerHTML = `<div class="picker-head">
      <input id="pickerSearch" placeholder="Search ${slot}s…" autocomplete="off" value="${esc(pickerQuery)}">
      <button class="picker-close" id="pickerClose">esc</button>
    </div>
    <div class="picker-list" id="pickerList">Loading…</div>`;
  document.body.classList.add('picker-open');
  const items = await loadSlot(slot);
  renderPickerList(items);
  const search = $('pickerSearch');
  search.focus();
  search.addEventListener('input', () => { pickerQuery = search.value; renderPickerList(items); });
  $('pickerClose').addEventListener('click', closePicker);
}
function closePicker() {
  $('itemPicker').hidden = true;
  document.body.classList.remove('picker-open');
  state.activeSlot = null;
}

function itemScoreFilter(items) {
  const q = pickerQuery.trim().toLowerCase();
  return items.filter((it) => {
    if (!it.stats || !Object.keys(it.stats).length) return false; // cosmetic or missing data — don't show
    if (it.level > state.level) return false;
    if (it.school !== 'Any' && it.school !== state.school) return false;
    if (q && !it.name.toLowerCase().includes(q)) return false;
    return true;
  }).slice(0, 200);
}

function renderPickerList(items) {
  const slot = state.activeSlot;
  const list = itemScoreFilter(items);
  const base = currentTotals();
  const el = $('pickerList');
  if (!list.length) { el.innerHTML = `<p class="picker-empty">No ${slot}s match (level ≤ ${state.level}, ${state.school}/Any).</p>`; return; }
  el.innerHTML = list.map((it) => {
    // delta vs currently equipped in this slot
    const withItem = { ...state.equipped, [slot]: it };
    const talents = state.petTalents.map((id) => PET_TALENTS.find((t) => t.id === id)).filter(Boolean);
    const after = computeStats([...Object.values(withItem), ...talents]);
    const d = diffTotals(base, after);
    const dmg = d.damage[state.school], res = d.resist[state.school], crit = d.critical[state.school], pierce = d.pierce[state.school];
    const chip = (v, suf, lab) => v ? `<span class="d-chip ${v > 0 ? 'up' : 'down'}">${fmt(v)}${suf} ${lab}</span>` : '';
    return `<button class="pick-row ${state.equipped[slot]?.slug === it.slug ? 'equipped' : ''}" data-pick="${esc(it.slug)}">
      <span class="pick-main">
        <span class="pick-name">${esc(it.name)}${it.meta?`<span class="pick-meta">meta</span>`:``}</span>
        <span class="pick-sub">Lvl ${it.level}${it.school !== 'Any' ? ' · ' + esc(it.school) : ''}</span>
      </span>
      <span class="pick-deltas">${chip(dmg, '%', 'dmg')}${chip(res, '%', 'res')}${chip(crit, '', 'crit')}${chip(pierce, '%', 'pierce')}</span>
    </button>`;
  }).join('');
  el.querySelectorAll('.pick-row').forEach((row) => {
    row.addEventListener('click', () => {
      const it = list.find((x) => x.slug === row.dataset.pick);
      state.equipped[slot] = it;
      closePicker();
      rerender();
      syncUrl();
    });
  });
}

/* -------------- pet talent menu -------------- */

let talentQuery = '';
function togglePetMenu() {
  const menu = $('petMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  talentQuery = '';
  renderTalentMenu();
  menu.hidden = false;
}
function renderTalentMenu() {
  const menu = $('petMenu');
  const q = talentQuery.trim().toLowerCase();
  const avail = PET_TALENTS.filter((t) => !state.petTalents.includes(t.id)
    && (!q || t.name.toLowerCase().includes(q)));
  const groups = TALENT_CATS.map((cat) => {
    const ts = avail.filter((t) => t.cat === cat);
    if (!ts.length) return '';
    return `<div class="talent-group"><p class="talent-cat">${cat}</p>${ts.map((t) => {
      const d = describeStats(t.stats, { max: 2 }).join(' · ');
      return `<button class="talent-opt" data-talent="${t.id}"><span>${esc(t.name)}</span><b>${esc(d)}</b></button>`;
    }).join('')}</div>`;
  }).join('');
  menu.innerHTML = `<input class="talent-search" id="talentSearch" placeholder="Search talents…" value="${esc(talentQuery)}">
    <div class="talent-scroll">${groups || '<span class="talent-none">no matches</span>'}</div>`;
  const si = $('talentSearch'); si.focus();
  si.addEventListener('input', () => { talentQuery = si.value; renderTalentMenu(); });
  menu.querySelectorAll('.talent-opt').forEach((b) => b.addEventListener('click', () => {
    if (state.petTalents.length < 5) state.petTalents.push(b.dataset.talent);
    rerender(); syncUrl();
    if (state.petTalents.length < 5) togglePetMenu(); // reopen for next pick
  }));
}

/* -------------- url sharing -------------- */

function encodeBuild() {
  const b = {
    s: state.school, l: state.level,
    g: Object.fromEntries(Object.entries(state.equipped).map(([k, v]) => [k, v.slug])),
    p: state.petTalents,
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(b)))).replace(/=+$/, '');
}
function syncUrl() {
  history.replaceState(null, '', `#build?b=${encodeBuild()}`);
}
async function decodeBuild(str) {
  try {
    const b = JSON.parse(decodeURIComponent(escape(atob(str))));
    state.school = b.s || state.school;
    state.level = b.l || state.level;
    state.petTalents = b.p || [];
    for (const [slot, slug] of Object.entries(b.g || {})) {
      const items = await loadSlot(slot);
      const it = items.find((x) => x.slug === slug);
      if (it) state.equipped[slot] = it;
    }
  } catch { /* ignore bad payload */ }
}

/* -------------- top-level render + events -------------- */

function rerender() {
  $('buildBody').innerHTML = renderPresets() + renderSheet() + renderStats();
  bindSheet();
}

function bindSheet() {
  document.querySelectorAll('.slot-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.dataset.remove) {
        delete state.equipped[e.target.dataset.remove];
        rerender(); syncUrl();
        return;
      }
      openPicker(card.dataset.slot);
    });
  });
  document.querySelectorAll('.preset-chip[data-preset]').forEach((chip) =>
    chip.addEventListener('click', () => openCommunityBuild(+chip.dataset.preset)));
  $('petAddBtn')?.addEventListener('click', togglePetMenu);
  document.querySelectorAll('[data-petremove]').forEach((x) => x.addEventListener('click', (e) => {
    e.stopPropagation();
    state.petTalents = state.petTalents.filter((id) => id !== x.dataset.petremove);
    rerender(); syncUrl();
  }));
}

function fillSchoolSelect() {
  const sel = $('buildSchool');
  if (sel.options.length) return;
  sel.innerHTML = SCHOOLS.map((s) => `<option ${s === state.school ? 'selected' : ''}>${s}</option>`).join('');
  sel.addEventListener('change', () => { state.school = sel.value; document.body.style.setProperty('--build-accent', SCHOOL_COLORS[state.school]); rerender(); syncUrl(); });
  $('buildLevel').addEventListener('input', (e) => { state.level = +e.target.value; $('buildLevelVal').textContent = state.level; rerender(); syncUrl(); });
  $('buildShare').addEventListener('click', async () => {
    syncUrl();
    const url = location.href;
    const data = { title: 'Spiral Boss Codex — build', text: `My ${state.school} build`, url };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch { /* cancelled → fall through to copy */ }
    }
    await navigator.clipboard.writeText(url).catch(() => {});
    const btn = $('buildShare'); const t = btn.textContent; btn.textContent = 'Link copied!'; setTimeout(() => (btn.textContent = t), 1500);
  });
  $('buildReset').addEventListener('click', () => { state.equipped = {}; state.petTalents = []; rerender(); syncUrl(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('itemPicker').hidden) closePicker(); });
}

export async function renderBuild(hash) {
  await ensureIndex();
  fillSchoolSelect();
  // hydrate from URL payload if present
  const m = hash.match(/[?&]b=([^&]+)/);
  if (m && !state._hydrated) { await decodeBuild(m[1]); state._hydrated = true; }
  $('buildSchool').value = state.school;
  $('buildLevel').value = state.level;
  $('buildLevelVal').textContent = state.level;
  document.body.style.setProperty('--build-accent', SCHOOL_COLORS[state.school]);
  rerender();
}
