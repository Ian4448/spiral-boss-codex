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

// Built-in pet talent library (common manifested talents). Covers the stat math
// without the pet minigame; each talent contributes flat/percent stats.
const PET_TALENTS = [
  { id: 'paingiver', name: 'Pain-Giver', stats: { damage: { Global: 6 } } },
  { id: 'painbringer', name: 'Pain-Bringer', stats: { damage: { Global: 5 } } },
  { id: 'spellproof', name: 'Spell-Proof', stats: { resist: { Global: 10 } } },
  { id: 'spelldefy', name: 'Spell-Defying', stats: { resist: { Global: 7 } } },
  { id: 'mightypierce', name: 'Armor Breaker (Mighty)', stats: { pierce: { Global: 5 } } },
  { id: 'sharpshot', name: 'Sharp Shot (accuracy)', stats: { accuracy: { Global: 5 } } },
  { id: 'critical', name: 'Critical Striker', stats: { critical: { Global: 60 } } },
  { id: 'block', name: 'Pip Conserver / Block', stats: { block: { Global: 55 } } },
  { id: 'health', name: 'Add Health (Mighty)', stats: { maxHealth: 165 } },
  { id: 'mana', name: 'Add Mana', stats: { maxMana: 75 } },
  { id: 'pipomatic', name: 'Pip O’Matic', stats: { powerPipChance: 5 } },
  { id: 'defender', name: 'Ward (flat resist)', stats: { resist: { Global: 4 } } },
  { id: 'giver', name: 'Giver (flat damage)', stats: { damage: { Global: 4 } } },
];

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
  } catch { state.presets = null; }
  state.loaded = true;
}
async function loadSlot(slot) {
  if (state.cache[slot]) return state.cache[slot];
  try {
    state.cache[slot] = await (await fetch(`./data/gear/${slot}.json`)).json();
  } catch { state.cache[slot] = []; }
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

function topStats(it) {
  const parts = [];
  const s = it.stats || {};
  if (s.maxHealth) parts.push(`${s.maxHealth} hp`);
  for (const k of ['damage', 'resist', 'critical', 'pierce']) {
    if (s[k]) {
      const v = (s[k][state.school] || 0) + (s[k].Global || 0);
      if (v) parts.push(`${fmt(v)}${k === 'damage' || k === 'resist' || k === 'pierce' ? '%' : ''} ${k[0].toUpperCase()}`);
    }
  }
  return parts.slice(0, 3).map((p) => `<span>${p}</span>`).join('');
}

// Recommended builds (Riddler208's 2026 guide) — open the WizBuilder build for
// the selected school at each level threshold.
function renderPresets() {
  const p = state.presets;
  if (!p || !p.builds) return '';
  const mine = p.builds.filter((b) => b.school === state.school).sort((a, b) => a.level - b.level);
  if (!mine.length) return '';
  const chips = mine.map((b) => {
    const near = Math.abs(b.level - state.level) <= 20;
    return `<a class="preset-chip ${near ? 'near' : ''}" href="${esc(b.url)}" target="_blank" rel="noopener">
      Lvl ${b.level}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>`;
  }).join('');
  return `<div class="presets-strip">
    <div class="presets-head">
      <span class="presets-title">Recommended ${esc(state.school)} builds</span>
      <a class="presets-credit" href="${esc(p.source.url)}" target="_blank" rel="noopener">by ${esc(p.source.author)} · ${esc(p.source.title)}</a>
    </div>
    <div class="presets-chips">${chips}</div>
  </div>`;
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
        <span class="pick-name">${esc(it.name)}</span>
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

function togglePetMenu() {
  const menu = $('petMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.innerHTML = PET_TALENTS.filter((t) => !state.petTalents.includes(t.id))
    .map((t) => `<button class="talent-opt" data-talent="${t.id}">${esc(t.name)}</button>`).join('')
    || '<span class="talent-none">all added</span>';
  menu.hidden = false;
  menu.querySelectorAll('.talent-opt').forEach((b) => b.addEventListener('click', () => {
    if (state.petTalents.length < 5) state.petTalents.push(b.dataset.talent);
    rerender(); syncUrl();
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
    await navigator.clipboard.writeText(location.href).catch(() => {});
    const btn = $('buildShare'); const t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = t), 1400);
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
