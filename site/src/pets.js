// Pets catalog — browse every first-generation pet with art, base stats, and talent pools.
import { IMG_BASE, SCHOOL_COLORS, esc, schoolIcon } from './display.js';

const $ = (id) => document.getElementById(id);
const SCHOOLS = ['Fire', 'Ice', 'Storm', 'Myth', 'Life', 'Death', 'Balance'];
const STAT_KEYS = [['strength', 'Strength'], ['intellect', 'Intellect'], ['agility', 'Agility'], ['will', 'Will'], ['power', 'Power']];
const STAT_MAX = 260;

const pstate = { loaded: false, list: [], school: '', q: '', sort: 'name', limit: 60 };

const petImg = (p) => `${IMG_BASE}/pets/${p.slug}.webp`;

function crest(school) {
  const c = SCHOOL_COLORS[school] || 'var(--accent)';
  return school && school !== 'Any'
    ? `<span class="pt-crest" style="--sc:${c}">${schoolIcon(school)}</span>` : '';
}

function petCard(p) {
  const c = SCHOOL_COLORS[p.school] || 'var(--accent)';
  const tal = (p.talents || []).slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join('');
  return `<button class="petcard" style="--sc:${c}" data-slug="${esc(p.slug)}">
    <span class="pt-art"><img loading="lazy" decoding="async" src="${petImg(p)}" alt="${esc(p.name)}"
      onerror="this.style.display='none';this.parentNode.classList.add('noimg')"><span class="pt-fallback">${esc(p.school?.[0] || '?')}</span></span>
    <span class="pt-body">
      <span class="pt-name">${esc(p.name)}</span>
      <span class="pt-meta">${crest(p.school)}<span>${esc(p.school || 'Any')}${p.pedigree ? ` · Ped ${p.pedigree}` : ''}</span></span>
      ${tal ? `<span class="pt-tals">${tal}</span>` : ''}
    </span>
  </button>`;
}

function results() {
  const q = pstate.q.trim().toLowerCase();
  let list = pstate.list.filter((p) => {
    if (pstate.school && p.school !== pstate.school) return false;
    if (q && !(p.name.toLowerCase().includes(q)
      || (p.talents || []).some((t) => t.toLowerCase().includes(q))
      || (p.derby || []).some((t) => t.toLowerCase().includes(q)))) return false;
    return true;
  });
  if (pstate.sort === 'pedigree') list = [...list].sort((a, b) => (b.pedigree || 0) - (a.pedigree || 0));
  return list;
}

function render() {
  const body = $('petsBody');
  const list = results();
  const shown = list.slice(0, pstate.limit);
  const schoolChips = ['', ...SCHOOLS].map((s) =>
    `<button class="g-schip ${pstate.school === s ? 'on' : ''}" data-school="${s}" ${s ? `style="--sc:${SCHOOL_COLORS[s]}"` : ''}>${s || 'All'}</button>`).join('');

  body.innerHTML = `
    <div class="pets-hero">
      <div>
        <h1 class="gallery-title">Pets</h1>
        <p class="gallery-lede">Every first-generation pet — art, base stats, and the talents &amp; derby abilities it can pass on.</p>
      </div>
    </div>
    <div class="pets-controls">
      <input id="petSearch" class="pets-search" placeholder="Search pets or talents…" autocomplete="off" value="${esc(pstate.q)}">
      <select id="petSort" class="pets-sort">
        <option value="name" ${pstate.sort === 'name' ? 'selected' : ''}>A–Z</option>
        <option value="pedigree" ${pstate.sort === 'pedigree' ? 'selected' : ''}>Highest pedigree</option>
      </select>
    </div>
    <div class="g-schools">${schoolChips}</div>
    <p class="pets-count">${list.length} pet${list.length === 1 ? '' : 's'}</p>
    ${shown.length ? `<div class="pets-grid">${shown.map(petCard).join('')}</div>` : '<p class="g-empty">No pets match.</p>'}
    ${list.length > shown.length ? `<button class="browse-more" id="petMore">Show more (${list.length - shown.length} left)</button>` : ''}
    <div class="gallery-detail" id="petDetail" hidden></div>`;

  const s = $('petSearch');
  s.addEventListener('input', () => { pstate.q = s.value; pstate.limit = 60; const pos = s.selectionStart; render(); const n = $('petSearch'); n.focus(); n.setSelectionRange(pos, pos); });
  $('petSort').addEventListener('change', (e) => { pstate.sort = e.target.value; render(); });
  body.querySelectorAll('.g-schip').forEach((b) => b.addEventListener('click', () => { pstate.school = b.dataset.school; pstate.limit = 60; render(); }));
  $('petMore')?.addEventListener('click', () => { pstate.limit += 120; render(); });
  body.querySelectorAll('.petcard').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.slug)));
}

function statBar(label, v) {
  const pct = Math.min(100, Math.round((v / STAT_MAX) * 100));
  return `<div class="pt-stat"><span class="pt-stat-l">${label}</span>
    <span class="pt-bar"><span class="pt-bar-fill" style="width:${pct}%"></span></span>
    <b>${v}</b></div>`;
}

function openDetail(slug) {
  const p = pstate.list.find((x) => x.slug === slug);
  if (!p) return;
  const c = SCHOOL_COLORS[p.school] || 'var(--accent)';
  const bs = p.baseStats || {};
  const bars = STAT_KEYS.filter(([k]) => bs[k] != null).map(([k, l]) => statBar(l, bs[k])).join('');
  const pool = (arr, cls) => (arr && arr.length)
    ? arr.map((t) => `<span class="pt-talent ${cls}">${esc(t)}</span>`).join('')
    : '<span class="pt-none">none discovered</span>';
  const overlay = $('petDetail');
  overlay.hidden = false;
  document.body.classList.add('gdetail-open');
  overlay.innerHTML = `<div class="gd-panel pt-panel" style="--sc:${c}">
    <div class="gd-head">
      <div><span class="cb-eyebrow">${esc(p.school || 'Pet')}${p.pedigree ? ` · Pedigree ${p.pedigree}` : ''}</span>
        <div class="cb-title">${esc(p.name)}</div></div>
      <button class="picker-close" id="ptClose">esc</button>
    </div>
    <div class="gd-body">
      <div class="pt-hero"><span class="pt-art big"><img src="${petImg(p)}" alt="${esc(p.name)}"
        onerror="this.style.display='none';this.parentNode.classList.add('noimg')"><span class="pt-fallback">${esc(p.school?.[0] || '?')}</span></span>
        <div class="pt-facts">
          ${p.card ? `<div class="pt-fact"><span>Gives card</span><b>${esc(p.card)}</b></div>` : ''}
          ${p.egg ? `<div class="pt-fact"><span>Egg</span><b>${esc(p.egg)}</b></div>` : ''}
        </div>
      </div>
      ${bars ? `<p class="cb-section">Base stats</p><div class="pt-stats">${bars}</div>` : ''}
      <p class="cb-section">Talents</p><div class="pt-pool">${pool(p.talents, 'tal')}</div>
      <p class="cb-section">Derby abilities</p><div class="pt-pool">${pool(p.derby, 'derby')}</div>
      <p class="cb-note">Talents shown are those discovered on the wiki; a pet can carry up to 10 of each. Actual manifested talents depend on how the pet was trained/hatched.
        <a href="${esc(p.wikiUrl)}" target="_blank" rel="noopener">Wiki page ↗</a></p>
    </div>
  </div>`;
  const close = () => { overlay.hidden = true; document.body.classList.remove('gdetail-open'); };
  $('ptClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { once: true });
}

export async function renderPets() {
  const body = $('petsBody');
  if (!pstate.loaded) {
    body.innerHTML = '<div class="pets-loading">Loading pet catalog…</div>';
    try { pstate.list = await (await fetch('./data/pets/pets.json')).json(); }
    catch { pstate.list = []; }
    pstate.loaded = true;
  }
  render();
}
