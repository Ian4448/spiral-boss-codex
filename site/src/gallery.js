// Community Builds gallery — browse curated + community-published + your own builds.
import { fetchBuilds, fetchBuild } from './galleryApi.js';
import { loadBuildIntoCreator, loadMyBuilds } from './build.js';
import { SCHOOL_COLORS, SLOT_LABEL, esc, describeStats, schoolIcon } from './display.js';
import { computeStats, SCHOOLS } from './stats.js';

const $ = (id) => document.getElementById(id);

const gstate = {
  school: '',            // '' = all schools
  tab: 'curated',        // curated | community | mine (curated has content on first load)
  curated: null,         // normalized curated builds
  published: null,       // index summaries from the API
  publishError: null,
  loading: false,
};

/* ---- curated builds (Riddler presets) ---- */

async function ensureCurated() {
  if (gstate.curated) return gstate.curated;
  try {
    const p = await (await fetch('./data/presets.json')).json();
    const src = p.source || {};
    gstate.curated = (p.builds || []).map((b) => {
      const gear = {};
      for (const [slot, id] of Object.entries(b.gear || {})) {
        const it = p.items[id];
        if (it) gear[slot] = it;
      }
      return {
        id: `curated-${b.school}-${b.level}`, kind: 'curated',
        title: `${b.school} progression — Lvl ${b.level}`,
        author: src.author || 'Riddler208', school: b.school, level: b.level,
        gear, talents: [], notes: '',
        source: src,
      };
    }).sort((a, b) => a.level - b.level);
  } catch { gstate.curated = []; }
  return gstate.curated;
}

async function ensurePublished(force) {
  if (gstate.published && !force) return gstate.published;
  try {
    const data = await fetchBuilds();
    gstate.published = data.builds || [];
    gstate.publishError = null;
  } catch (e) {
    gstate.published = [];
    gstate.publishError = e.message || 'could not load';
  }
  return gstate.published;
}

/* ---- rendering ---- */

function crest(school) {
  const c = SCHOOL_COLORS[school] || 'var(--accent)';
  return `<span class="gc-crest" style="--sc:${c}">${schoolIcon(school)}</span>`;
}

function topStatLine(build) {
  const items = Object.values(build.gear || {});
  if (!items.length) return '';
  const t = computeStats(items);
  const s = build.school;
  const parts = [];
  if (t.maxHealth) parts.push(`${t.maxHealth} hp`);
  if (t.damage[s]) parts.push(`+${t.damage[s]}% dmg`);
  if (t.critical[s]) parts.push(`+${t.critical[s]} crit`);
  if (t.resist[s]) parts.push(`+${t.resist[s]}% res`);
  return parts.slice(0, 3).map((p) => `<span>${esc(p)}</span>`).join('');
}

function card(build) {
  const c = SCHOOL_COLORS[build.school] || 'var(--accent)';
  const count = build.itemCount != null ? build.itemCount : Object.keys(build.gear || {}).length;
  const badge = build.kind === 'curated' ? '<span class="gc-badge curated">curated</span>'
    : build.published || build.kind === 'community' ? '<span class="gc-badge community">community</span>'
    : '<span class="gc-badge mine">saved</span>';
  return `<button class="gcard" style="--sc:${c}" data-id="${esc(build.id)}" data-kind="${esc(build.kind || 'community')}">
    <div class="gc-top">${crest(build.school)}<div class="gc-titles">
      <span class="gc-title">${esc(build.title)}</span>
      <span class="gc-sub">${esc(build.school)} · Lvl ${build.level} · ${count} pieces</span>
    </div>${badge}</div>
    ${build.gear ? `<div class="gc-stats">${topStatLine(build)}</div>` : ''}
    <div class="gc-foot"><span class="gc-author">by ${esc(build.author || 'Anonymous')}</span></div>
  </button>`;
}

function activeList() {
  const bySchool = (arr) => (gstate.school ? arr.filter((b) => b.school === gstate.school) : arr);
  if (gstate.tab === 'curated') return bySchool(gstate.curated || []);
  if (gstate.tab === 'mine') return bySchool(loadMyBuilds().map((b) => ({ ...b, kind: 'mine' })));
  return bySchool(gstate.published || []);
}

function render() {
  const body = $('galleryBody');
  const list = activeList();
  const schoolChips = ['', ...SCHOOLS].map((s) =>
    `<button class="g-schip ${gstate.school === s ? 'on' : ''}" data-school="${s}" ${s ? `style="--sc:${SCHOOL_COLORS[s]}"` : ''}>${s || 'All'}</button>`).join('');
  const tabBtn = (id, label, n) => `<button class="g-tab ${gstate.tab === id ? 'on' : ''}" data-tab="${id}">${label}<b>${n}</b></button>`;
  const mineCount = loadMyBuilds().length;

  let listHtml;
  if (gstate.tab === 'community' && gstate.publishError) {
    listHtml = `<p class="g-empty">Couldn’t load community builds (${esc(gstate.publishError)}).</p>`;
  } else if (!list.length) {
    listHtml = gstate.tab === 'mine'
      ? `<p class="g-empty">No saved builds yet. Open the <a href="#build">Build Creator</a>, assemble a build, then <b>Save / Publish</b>.</p>`
      : gstate.tab === 'community'
        ? `<p class="g-empty">No community builds${gstate.school ? ` for ${esc(gstate.school)}` : ''} yet — <a href="#build">be the first to publish one</a>.</p>`
        : `<p class="g-empty">No builds${gstate.school ? ` for ${esc(gstate.school)}` : ''}.</p>`;
  } else {
    listHtml = `<div class="gallery-grid">${list.map(card).join('')}</div>`;
  }

  body.innerHTML = `
    <div class="gallery-hero">
      <div>
        <h1 class="gallery-title">Community Builds</h1>
        <p class="gallery-lede">Browse curated progressions and builds shared by other wizards — or publish your own.</p>
      </div>
      <a class="g-create" href="#build">＋ Create &amp; publish</a>
    </div>
    <div class="g-tabs">
      ${tabBtn('curated', 'Curated', (gstate.curated || []).length)}
      ${tabBtn('community', 'Community', (gstate.published || []).length)}
      ${tabBtn('mine', 'My Builds', mineCount)}
    </div>
    <div class="g-schools">${schoolChips}</div>
    ${listHtml}
    <div class="gallery-detail" id="galleryDetail" hidden></div>`;

  body.querySelectorAll('.g-tab').forEach((b) => b.addEventListener('click', () => { gstate.tab = b.dataset.tab; render(); }));
  body.querySelectorAll('.g-schip').forEach((b) => b.addEventListener('click', () => { gstate.school = b.dataset.school; render(); }));
  body.querySelectorAll('.gcard').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.id, b.dataset.kind)));
}

/* ---- detail overlay ---- */

async function openDetail(id, kind) {
  let build = null;
  if (kind === 'curated') build = (gstate.curated || []).find((b) => b.id === id);
  else if (kind === 'mine') build = loadMyBuilds().find((b) => b.id === id);
  if (!build || !build.gear) {
    try { build = await fetchBuild(id); build.kind = build.kind || 'community'; }
    catch { return; }
  }
  const items = Object.values(build.gear || {});
  const totals = computeStats(items);
  const sf = build.school;
  const c = SCHOOL_COLORS[sf] || 'var(--accent)';
  const cell = (label, val) => `<div class="cb-stat"><span>${label}</span><b>${val}</b></div>`;
  const gearRows = Object.keys(SLOT_LABEL).map((slot) => {
    const it = build.gear[slot];
    if (!it) return `<div class="cb-slot"><span class="cb-slot-tag">${SLOT_LABEL[slot]}</span><span class="cb-item empty">— no ${slot} at this level</span></div>`;
    const desc = describeStats(it.stats, { max: 6 }).map((d) => `<span class="cb-mini">${esc(d)}</span>`).join('');
    const tag = it.suggested ? '<span class="cb-suggested">suggested</span>' : '';
    return `<div class="cb-slot col"><div class="cb-slot-top"><span class="cb-slot-tag">${SLOT_LABEL[slot]}</span>
      <span class="cb-item">${esc(it.name)} <b>Lvl ${it.level || 0}</b>${tag}</span></div>
      <div class="cb-mini-row">${desc}</div></div>`;
  }).join('');
  const talents = (build.talents || []).length
    ? `<p class="cb-section">Pet talents</p><div class="cb-talents">${build.talents.map((t) => `<span class="cb-talent">${esc(typeof t === 'string' ? t : t.name)}</span>`).join('')}</div>`
    : '';
  const shareLink = (build.kind === 'community' || build.published) ? `${location.origin}/#builds?b=${build.id}` : '';
  const overlay = $('galleryDetail');
  overlay.hidden = false;
  document.body.classList.add('gdetail-open');
  overlay.innerHTML = `<div class="gd-panel" style="--sc:${c}">
    <div class="gd-head">
      <div><span class="cb-eyebrow">${esc(sf)} · Level ${build.level}</span><div class="cb-title">${esc(build.title || 'Build')}</div>
      <span class="gd-author">by ${esc(build.author || 'Anonymous')}</span></div>
      <button class="picker-close" id="gdClose">esc</button>
    </div>
    <div class="gd-body">
      <div class="gd-actions">
        <button class="cb-load" id="gdLoad">Load into creator</button>
        ${shareLink ? `<button class="cb-load ghost" id="gdShare">Copy share link</button>` : ''}
      </div>
      ${build.notes ? `<p class="gd-notes">${esc(build.notes)}</p>` : ''}
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
      ${talents}
      ${build.kind === 'curated' && build.source ? `<p class="cb-note">From ${esc(build.source.author)}'s <a href="${esc(build.source.url)}" target="_blank" rel="noopener">${esc(build.source.title)}</a>. Item stats via WizBuilder.</p>` : ''}
    </div>
  </div>`;
  const close = () => { overlay.hidden = true; document.body.classList.remove('gdetail-open'); };
  $('gdClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { once: true });
  $('gdLoad').addEventListener('click', () => { close(); loadBuildIntoCreator(build); });
  $('gdShare')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(shareLink).catch(() => {});
    const btn = $('gdShare'); const t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = t), 1400);
  });
}

/* ---- entry ---- */

export async function renderGallery(hash) {
  const body = $('galleryBody');
  if (!gstate.published || !gstate.curated) {
    body.innerHTML = '<div class="gallery-loading">Loading builds…</div>';
  }
  await Promise.all([ensureCurated(), ensurePublished()]);
  render();
  // deep link to a specific published build: #builds?b=<id>
  const m = hash.match(/[?&]b=([^&]+)/);
  if (m) openDetail(decodeURIComponent(m[1]), 'community');
}
