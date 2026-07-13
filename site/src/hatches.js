// Hatch Tracker — plan a pet you're hatching toward: pick the talents you want,
// then log each hatch (new pet + which parents / body it used). The lineage is
// drawn as a topology graph with each pet's face, so you can see your progress.
import { esc, SCHOOL_COLORS } from './display.js';

const KEY = 'sbc_hatch_projects';
const $ = (id) => document.getElementById(id);
const PET_IMG = (slug) => `/img/pets/${slug}.webp`;

let CATALOG = [];
let TALENTS = [];        // unique talent names (catalog + common combat talents)
let SPECIES = [];        // { name, slug, school }
let mount = null;
let openId = null;

/* ---------- storage ---------- */
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* quota */ } };
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const getProject = (id) => load().find((p) => p.id === id);
function upsertProject(proj) {
  const all = load();
  const i = all.findIndex((p) => p.id === proj.id);
  if (i >= 0) all[i] = proj; else all.unshift(proj);
  save(all);
}

/* ---------- talents ---------- */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function matchCount(pet, goal) {
  const have = new Set((pet.talents || []).map(norm));
  return (goal || []).filter((g) => have.has(norm(g))).length;
}
const TAL_CATS = ['Damage', 'Defense & Block', 'Critical', 'Pierce', 'Accuracy', 'Pips', 'Health & Healing', 'Other'];
// A pet manifests one talent per age; Mega pets show all 5.
const STAGES = ['Baby', 'Teen', 'Adult', 'Ancient', 'Epic', 'Mega'];
const STAGE_MAX = { Baby: 0, Teen: 1, Adult: 2, Ancient: 3, Epic: 4, Mega: 5 };
const stageMax = (s) => (STAGE_MAX[s] != null ? STAGE_MAX[s] : 5);
function categorize(n) {
  const s = n.toLowerCase();
  if (/dealer|giver|bringer|boon|-?sniper|assail|amplif|dragonblade|\bblade\b|colossal|monstrous|gargantuan|spear/.test(s)) return 'Damage';
  if (/piercer|breaker|armor pierc/.test(s)) return 'Pierce';
  if (/accurate|sharp-?shot|\baim\b|adroit|attentive|keen/.test(s)) return 'Accuracy';
  if (/critical|striker|hitter/.test(s)) return 'Critical';
  if (/proof|defy|ward|tough|mighty|defender|fortif|absorb|spell-?block|\bblock\b|shield|barrier/.test(s)) return 'Defense & Block';
  if (/pip|mastery/.test(s)) return 'Pips';
  if (/health|heal|spritely|unicorn|fairy|pixie|life-?giver|mana|regen/.test(s)) return 'Health & Healing';
  return 'Other';
}
// common combat talents people hatch for, so they're always pickable
const SCHOOLS7 = ['Fire', 'Ice', 'Storm', 'Myth', 'Life', 'Death', 'Balance'];
const COMMON = ['Pain-Giver', 'Pain-Bringer', 'Spell-Proof', 'Spell-Defying', 'Armor Piercer', 'Mighty', 'Critical Striker', 'Critical Hitter',
  'Pip O’Matic', 'Pip Conserver', 'Add Health', 'Health-Gift', 'Add Mana', 'Sharp-Shot', 'Accurate',
  ...SCHOOLS7.flatMap((s) => [`${s}-Dealer`, `${s}-Boon`, `${s}-Proof`, `${s}-Ward`, `${s}-Sniper`, `${s}-Assailant`, `${s}blade`])];

const speciesSchool = (slug) => (SPECIES.find((s) => s.slug === slug) || {}).school || '';
const speciesName = (slug) => (SPECIES.find((s) => s.slug === slug) || {}).name || '';
const speciesSlugByName = (name) => (SPECIES.find((s) => norm(s.name) === norm(name)) || {}).slug || '';

/* ---------- topology layout (layered DAG) ---------- */
function computeDepths(pets) {
  const memo = {}, map = pets;
  const depth = (id, seen) => {
    if (memo[id] != null) return memo[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    const par = (map[id] && map[id].parents || []).filter((pid) => map[pid]);
    const d = par.length ? 1 + Math.max(...par.map((pid) => depth(pid, seen))) : 0;
    seen.delete(id);
    return (memo[id] = d);
  };
  Object.keys(map).forEach((id) => depth(id, new Set()));
  return memo;
}
const NODE_W = 176, NODE_H = 56, ROW_H = 116, GAP_X = 30, PAD = 26;
function bary(id, map, pos) {
  const par = (map[id].parents || []).filter((p) => pos[p]);
  return par.length ? par.reduce((s, p) => s + pos[p].x, 0) / par.length : 0;
}
function layout(petsMap) {
  const ids = Object.keys(petsMap);
  if (!ids.length) return { nodes: [], edges: [], w: 0, h: 0 };
  const depths = computeDepths(petsMap);
  const rows = {};
  ids.forEach((id) => { (rows[depths[id]] ||= []).push(id); });
  const maxRow = Math.max(...Object.values(rows).map((r) => r.length));
  const contentW = maxRow * NODE_W + (maxRow - 1) * GAP_X;
  const pos = {};
  Object.keys(rows).map(Number).sort((a, b) => a - b).forEach((gen) => {
    const row = rows[gen].sort((a, b) => bary(a, petsMap, pos) - bary(b, petsMap, pos));
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = PAD + (contentW - rowW) / 2;
    row.forEach((id, i) => { pos[id] = { x: startX + i * (NODE_W + GAP_X), y: PAD + gen * ROW_H }; });
  });
  const nodes = ids.map((id) => ({ id, pet: petsMap[id], ...pos[id] }));
  const edges = [];
  ids.forEach((id) => (petsMap[id].parents || []).forEach((pid) => {
    if (pos[pid]) edges.push({ from: pos[pid], to: pos[id], body: petsMap[id].bodyFrom === pid });
  }));
  const h = PAD * 2 + (Math.max(...Object.keys(rows).map(Number)) + 1) * ROW_H - (ROW_H - NODE_H);
  return { nodes, edges, w: contentW + PAD * 2, h };
}
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function graphSvg(proj) {
  const pets = proj.pets || {};
  const lay = layout(pets);
  if (!lay.nodes.length) {
    return `<div class="hx-graph-empty">Your lineage graph appears here. Add the pet you’re hatching with as a <b>seed</b>, then <b>record a hatch</b> to grow the tree.</div>`;
  }
  const goal = proj.goal || [], gmax = goal.length;
  const edgeP = lay.edges.map((e) => {
    const x1 = e.from.x + NODE_W / 2, y1 = e.from.y + NODE_H, x2 = e.to.x + NODE_W / 2, y2 = e.to.y, my = (y1 + y2) / 2;
    return `<path class="hx-edge ${e.body ? 'body' : ''}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
  }).join('');
  const nodeP = lay.nodes.map((n) => {
    const m = matchCount(n.pet, goal);
    const cls = gmax && m === gmax ? 'full' : m ? 'partial' : '';
    const sc = SCHOOL_COLORS[speciesSchool(n.pet.species)] || 'var(--accent)';
    const sub = `${n.pet.stage || 'Mega'}${n.pet.species ? ' · ' + speciesName(n.pet.species) : ''}`;
    const face = n.pet.species
      ? `<clipPath id="clip${n.id}"><rect x="8" y="8" width="40" height="40" rx="9"/></clipPath>
         <rect x="8" y="8" width="40" height="40" rx="9" class="hx-facebg"/>
         <image href="${PET_IMG(n.pet.species)}" x="8" y="8" width="40" height="40" clip-path="url(#clip${n.id})" preserveAspectRatio="xMidYMid slice"/>`
      : '';
    const tx = n.pet.species ? 56 : 12;
    return `<g class="hx-node ${cls}" data-pet="${esc(n.id)}" transform="translate(${n.x},${n.y})" style="--sc:${sc}">
      <rect width="${NODE_W}" height="${NODE_H}" rx="11"/>
      ${face}
      <text class="hx-nname" x="${tx}" y="24">${esc(trim(n.pet.name || 'Pet', 16))}</text>
      <text class="hx-nsub" x="${tx}" y="41">${esc(trim(sub, 18))}</text>
      ${gmax ? `<text class="hx-nbadge" x="${NODE_W - 12}" y="24" text-anchor="end">${m}/${gmax}</text>` : ''}
    </g>`;
  }).join('');
  return `<div class="hx-graph-scroll"><svg class="hx-graph" viewBox="0 0 ${lay.w} ${lay.h}" width="${lay.w}" height="${lay.h}">
    <g>${edgeP}</g><g>${nodeP}</g></svg></div>`;
}

/* ---------- reusable: categorized talent picker (capped by pet stage) ---------- */
function mountTalentPicker(host, selected, getMax) {
  getMax = getMax || (() => 99);
  let q = '';
  const has = (t) => selected.some((s) => norm(s) === norm(t));
  const room = () => Math.max(0, getMax() - selected.length);
  const add = (t) => { if (!has(t) && room() > 0) selected.push(t); };
  const addBulk = (v) => { v.split(',').map((x) => x.trim()).filter(Boolean).forEach(add); draw(); };
  function draw() {
    const max = getMax();
    const full = selected.length >= max;
    const ql = q.trim().toLowerCase();
    const avail = TALENTS.filter((t) => !has(t) && (!ql || t.toLowerCase().includes(ql)));
    const groups = full ? '' : TAL_CATS.map((cat) => {
      const ts = avail.filter((t) => categorize(t) === cat);
      if (!ts.length) return '';
      const cap = cat === 'Other' && !ql ? 30 : 400;
      return `<div class="tp-group"><p class="tp-cat">${cat}<b>${ts.length}</b></p>
        <div class="tp-opts">${ts.slice(0, cap).map((t) => `<button type="button" class="tp-opt" data-add="${esc(t)}">${esc(t)}</button>`).join('')}
        ${ts.length > cap ? `<span class="tp-more">+${ts.length - cap} more — search to find them</span>` : ''}</div></div>`;
    }).join('');
    host.innerHTML = `
      <div class="tp-count">${selected.length}/${max} talents${full ? ' · full for this stage' : ''}</div>
      <div class="tp-chips">${selected.length ? selected.map((t, i) => `<span class="hx-chip ${categorize(t) === 'Damage' ? 'dmg' : ''}">${esc(t)}<b data-rm="${i}">×</b></span>`).join('') : '<span class="pt-none">none yet — pick from below</span>'}</div>
      ${full ? '' : `<div class="tp-controls">
        <input class="tp-search" placeholder="Search talents…" value="${esc(q)}" autocomplete="off">
        <span class="tp-bulk"><input class="tp-bulkin" placeholder="or type A, B, C" autocomplete="off"><button type="button" class="hx-add tp-bulkadd">Add</button></span>
      </div>
      <div class="tp-scroll">${groups || '<span class="pt-none">no matches — press Add to use “' + esc(q) + '”</span>'}</div>`}`;
    host.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { selected.splice(+b.dataset.rm, 1); draw(); }));
    if (full) return;
    const s = host.querySelector('.tp-search');
    s.addEventListener('input', () => { q = s.value; const p = s.selectionStart; draw(); const n = host.querySelector('.tp-search'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    s.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (q.trim()) addBulk(q); q = ''; } });
    const bi = host.querySelector('.tp-bulkin');
    host.querySelector('.tp-bulkadd').addEventListener('click', () => addBulk(bi.value));
    bi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBulk(bi.value); } });
    host.querySelectorAll('.tp-opt').forEach((b) => b.addEventListener('click', () => { add(b.dataset.add); draw(); }));
  }
  draw();
  return draw; // caller can trigger a redraw (e.g. when stage/max changes)
}

/* ---------- reusable: visual pet-body picker (infinite scroll) ---------- */
function mountSpeciesPicker(host, state, onPick) {
  let q = '', browsing = !state.slug, shown = 48;
  const PAGE = 48;
  const filtered = () => { const ql = q.trim().toLowerCase(); return ql ? SPECIES.filter((s) => s.name.toLowerCase().includes(ql)) : SPECIES; };
  const cell = (s) => `<button type="button" class="sp-cell ${s.slug === state.slug ? 'on' : ''}" data-slug="${esc(s.slug)}" title="${esc(s.name)}" style="--sc:${SCHOOL_COLORS[s.school] || 'var(--accent)'}">
    <img loading="lazy" src="${PET_IMG(s.slug)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(s.name)}</span></button>`;
  const bindCells = (root) => root.querySelectorAll('.sp-cell').forEach((b) => {
    if (b.dataset.bound) return; b.dataset.bound = '1';
    b.addEventListener('click', () => { state.slug = b.dataset.slug; browsing = false; draw(); if (onPick) onPick(state.slug); });
  });
  function draw() {
    if (state.slug && !browsing) {
      host.innerHTML = `<div class="sp-chosen">
        <span class="sp-face"><img src="${PET_IMG(state.slug)}" alt="" onerror="this.style.visibility='hidden'"></span>
        <div class="sp-chosen-t"><b>${esc(speciesName(state.slug))}</b><span>${esc(speciesSchool(state.slug))} pet</span></div>
        <button type="button" class="sp-change">Change</button></div>`;
      host.querySelector('.sp-change').addEventListener('click', () => { browsing = true; shown = PAGE; draw(); });
      return;
    }
    const list = filtered();
    host.innerHTML = `<div class="sp-pick">
      <div class="sp-search-row"><input class="sp-search" placeholder="Search ${SPECIES.length} pets…" value="${esc(q)}" autocomplete="off">
        ${state.slug ? '<button type="button" class="sp-clear">Clear</button>' : ''}</div>
      <div class="sp-grid">${list.slice(0, shown).map(cell).join('') || '<span class="pt-none">no pets match</span>'}</div></div>`;
    const se = host.querySelector('.sp-search');
    se.addEventListener('input', () => { q = se.value; shown = PAGE; const p = se.selectionStart; draw(); const n = host.querySelector('.sp-search'); n.focus(); n.setSelectionRange(p, p); });
    host.querySelector('.sp-clear')?.addEventListener('click', () => { state.slug = ''; browsing = true; draw(); });
    const grid = host.querySelector('.sp-grid');
    bindCells(grid);
    grid.addEventListener('scroll', () => {
      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 120) {
        const l = filtered();
        if (shown < l.length) {
          const next = l.slice(shown, shown + PAGE); shown += PAGE;
          grid.insertAdjacentHTML('beforeend', next.map(cell).join(''));
          bindCells(grid);
        }
      }
    });
  }
  draw();
}

/* ---------- project list ---------- */
function renderList() {
  openId = null;
  const projects = load();
  mount.innerHTML = `
    <div class="pets-hero"><div>
      <h1 class="gallery-title">Hatch Tracker</h1>
      <p class="gallery-lede">Working toward a pet with certain talents? Set your goal, then log every hatch — the new pet and which parents it came from — and watch the lineage take shape.</p>
    </div><button class="g-create" id="hxNew">＋ New hatch project</button></div>
    ${projects.length ? `<div class="hx-projects">${projects.map(projectCard).join('')}</div>`
      : `<div class="hx-onboard">
          <p>No projects yet. A project tracks one hatching goal — say, a <b>Fire</b> pet with <em>Pain-Giver, Fire-Dealer, Spell-Proof</em>.</p>
          <ol><li>Create a project and pick the talents you want.</li>
            <li>Add the pets you’re hatching with as <b>seeds</b> (search by picture).</li>
            <li>Log each hatch — name the new pet and pick its two parents.</li>
            <li>The topology graph shows your lineage and which pets hit the goal.</li></ol>
        </div>`}`;
  $('hxNew').addEventListener('click', () => openEditor(null));
  mount.querySelectorAll('.hx-proj').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-del]')) { deleteProject(el.dataset.id); return; }
    open(el.dataset.id);
  }));
}
function projectCard(p) {
  const pets = Object.values(p.pets || {});
  const best = pets.reduce((m, pet) => Math.max(m, matchCount(pet, p.goal)), 0);
  const gmax = (p.goal || []).length, done = gmax && best === gmax;
  const faces = pets.filter((x) => x.species).slice(0, 5).map((x) => `<img src="${PET_IMG(x.species)}" alt="" onerror="this.style.display='none'">`).join('');
  return `<div class="hx-proj" data-id="${esc(p.id)}">
    <div class="hx-proj-top"><span class="hx-proj-name">${esc(p.name)}</span>
      <button class="hx-del" data-del title="Delete project">×</button></div>
    <div class="hx-goal">${(p.goal || []).slice(0, 6).map((t) => `<span class="hx-goal-chip">${esc(t)}</span>`).join('') || '<span class="pt-none">no goal talents</span>'}</div>
    ${faces ? `<div class="hx-proj-faces">${faces}</div>` : ''}
    <div class="hx-proj-foot"><span>${pets.length} pet${pets.length === 1 ? '' : 's'} · view lineage →</span>
      ${gmax ? `<span class="hx-progress ${done ? 'done' : ''}">best ${best}/${gmax}${done ? ' ✓' : ''}</span>` : ''}</div>
  </div>`;
}

/* ---------- project detail ---------- */
function open(id) {
  const p = getProject(id);
  if (!p) return renderList();
  openId = id;
  const list = Object.values(p.pets || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const gmax = (p.goal || []).length;
  const best = list.reduce((m, pet) => Math.max(m, matchCount(pet, p.goal)), 0);
  mount.innerHTML = `
    <div class="hx-detail-head">
      <button class="hx-back" id="hxBack">← All projects</button>
      <div class="hx-actions">
        <button class="cb-load ghost hx-btn" id="hxSeed">＋ Add seed pet</button>
        <button class="cb-load hx-btn" id="hxHatch" ${list.length < 1 ? 'disabled title="Add a seed pet first"' : ''}>＋ Record hatch</button>
      </div>
    </div>
    <div class="hx-title-row"><h1 class="gallery-title">${esc(p.name)}</h1><button class="hx-edit" id="hxEdit">Edit goal</button></div>
    <div class="hx-goalbar"><span class="hx-goal-label">Goal</span>
      ${(p.goal || []).map((t) => `<span class="hx-goal-chip">${esc(t)}</span>`).join('') || '<span class="pt-none">no talents set</span>'}
      ${gmax ? `<span class="hx-progress ${best === gmax ? 'done' : ''}">best pet ${best}/${gmax}${best === gmax ? ' ✓ goal reached!' : ''}</span>` : ''}</div>
    <p class="cb-section">Lineage</p>
    ${graphSvg(p)}
    <p class="cb-section">Pets in this lineage</p>
    <div class="hx-petlist">${list.length ? list.map((pet) => petRow(pet, p)).join('') : '<span class="pt-none">none yet</span>'}</div>
    <div class="gallery-detail" id="hxPanel" hidden></div>`;
  $('hxBack').addEventListener('click', renderList);
  $('hxEdit').addEventListener('click', () => openEditor(p.id));
  $('hxSeed').addEventListener('click', () => openPetForm(p, null));
  $('hxHatch').addEventListener('click', () => openHatchForm(p));
  mount.querySelectorAll('.hx-node').forEach((el) => el.addEventListener('click', () => openPetForm(p, el.dataset.pet)));
  mount.querySelectorAll('.hx-petrow').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-delpet]')) { deletePet(p.id, el.dataset.pet); return; }
    openPetForm(p, el.dataset.pet);
  }));
}
function petRow(pet, proj) {
  const m = matchCount(pet, proj.goal), gmax = (proj.goal || []).length;
  const parents = (pet.parents || []).map((pid) => proj.pets[pid]?.name).filter(Boolean);
  return `<div class="hx-petrow" data-pet="${esc(pet.id)}">
    <span class="hx-petface">${pet.species ? `<img src="${PET_IMG(pet.species)}" alt="" onerror="this.style.visibility='hidden'">` : '<span class="hx-petface-x">🐾</span>'}</span>
    <div class="hx-petrow-main">
      <span class="hx-petname">${esc(pet.name || 'Pet')}</span>
      <span class="hx-petmeta"><b class="hx-stage">${esc(pet.stage || 'Mega')}</b>${parents.length ? ' · from ' + parents.map(esc).join(' × ') : ' · seed'}${pet.species ? ' · ' + esc(speciesName(pet.species)) : ''}</span>
      <span class="hx-pettals">${(pet.talents || []).map((t) => `<span class="${matchCount({ talents: [t] }, proj.goal) ? 'hit' : ''}">${esc(t)}</span>`).join('') || '<em>no talents recorded</em>'}</span>
    </div>
    <div class="hx-petrow-side">${gmax ? `<span class="hx-progress sm ${m === gmax ? 'done' : ''}">${m}/${gmax}</span>` : ''}<button class="hx-del" data-delpet title="Remove pet">×</button></div>
  </div>`;
}

/* ---------- overlay panel ---------- */
function ensurePanel() { return $('hxPanel') || (() => { const d = document.createElement('div'); d.className = 'gallery-detail'; d.id = 'hxPanel'; d.hidden = true; mount.appendChild(d); return d; })(); }
function showPanel() { const p = $('hxPanel'); p.hidden = false; document.body.classList.add('gdetail-open'); p.addEventListener('click', (e) => { if (e.target === p) hidePanel(); }, { once: true }); }
function hidePanel() { const p = $('hxPanel'); if (p) p.hidden = true; document.body.classList.remove('gdetail-open'); }

/* ---------- project editor ---------- */
function openEditor(id) {
  const p = id ? getProject(id) : { id: uid('p'), name: '', goal: [], pets: {}, createdAt: Date.now() };
  const goal = [...(p.goal || [])];
  const panel = ensurePanel();
  panel.innerHTML = `<div class="gd-panel hx-form" style="--sc:var(--accent)">
    <div class="gd-head"><div><span class="cb-eyebrow">${id ? 'Edit' : 'New'} project</span><div class="cb-title">Hatching goal</div></div>
      <button class="picker-close" id="hxClose">esc</button></div>
    <div class="gd-body">
      <label class="sv-field"><span>Project name</span><input id="hxName" maxlength="60" value="${esc(p.name)}" placeholder="e.g. Fire hitter pet"></label>
      <div class="sv-field"><span>Goal talents — the stats you want on the pet</span><div id="hxGoalHost" class="tp-host"></div></div>
      <div class="sv-actions"><button class="cb-load" id="hxSave">${id ? 'Save' : 'Create project'}</button></div>
    </div></div>`;
  showPanel();
  mountTalentPicker($('hxGoalHost'), goal);
  $('hxClose').addEventListener('click', hidePanel);
  $('hxSave').addEventListener('click', () => {
    p.name = $('hxName').value.trim() || 'Untitled project';
    p.goal = goal;
    upsertProject(p);
    hidePanel();
    open(p.id);
  });
  setTimeout(() => $('hxName').focus(), 30);
}

/* ---------- add / edit pet ---------- */
function openPetForm(proj, petId) {
  const editing = petId ? proj.pets[petId] : null;
  const pet = editing ? { ...editing } : { id: uid('h'), name: '', species: '', talents: [], parents: [], createdAt: Date.now() };
  const talents = [...(pet.talents || [])];
  const spState = { slug: pet.species || '' };
  const panel = ensurePanel();
  const parentNames = (pet.parents || []).map((pid) => proj.pets[pid]?.name).filter(Boolean);
  panel.innerHTML = `<div class="gd-panel hx-form" style="--sc:var(--accent)">
    <div class="gd-head"><div><span class="cb-eyebrow">${editing ? 'Edit pet' : 'Add seed pet'}</span>
      <div class="cb-title">${editing ? esc(pet.name || 'Pet') : 'Seed pet'}</div>
      ${parentNames.length ? `<span class="gd-author">hatched from ${parentNames.map(esc).join(' × ')}</span>` : ''}</div>
      <button class="picker-close" id="hxClose">esc</button></div>
    <div class="gd-body">
      ${editing ? '' : '<p class="hx-hint">Add a pet you own or one you’re hatching with. As it ages (Baby → Mega) it reveals one more talent per stage.</p>'}
      <label class="sv-field"><span>Pet name / nickname</span><input id="hxPName" maxlength="60" value="${esc(pet.name)}" placeholder="e.g. Enkindled Wildclaw"></label>
      <div class="sv-field"><span>Pet body — pick which pet this is</span><div id="hxSpecies"></div></div>
      <label class="sv-field"><span>Age / stage — how far it’s trained</span>
        <select id="hxStage">${STAGES.map((s) => `<option ${(pet.stage || 'Mega') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div class="sv-field"><span>Talents it has</span><div id="hxTalHost" class="tp-host"></div></div>
      <div class="sv-actions"><button class="cb-load" id="hxPSave">${editing ? 'Save' : 'Add pet'}</button></div>
    </div></div>`;
  showPanel();
  let stage = pet.stage || 'Mega';
  mountSpeciesPicker($('hxSpecies'), spState, (slug) => { const nm = $('hxPName'); if (!nm.value.trim()) nm.value = speciesName(slug); });
  const redrawTal = mountTalentPicker($('hxTalHost'), talents, () => stageMax(stage));
  $('hxStage').addEventListener('change', (e) => { stage = e.target.value; while (talents.length > stageMax(stage)) talents.pop(); redrawTal(); });
  $('hxClose').addEventListener('click', hidePanel);
  $('hxPSave').addEventListener('click', () => {
    pet.name = $('hxPName').value.trim() || speciesName(spState.slug) || 'Unnamed pet';
    pet.species = spState.slug;
    pet.stage = stage;
    pet.talents = talents;
    const fresh = getProject(proj.id);
    fresh.pets[pet.id] = pet;
    upsertProject(fresh);
    hidePanel();
    open(proj.id);
  });
  setTimeout(() => $('hxPName').focus(), 30);
}

/* ---------- record a hatch ---------- */
function openHatchForm(proj) {
  const pets = Object.values(proj.pets || {});
  const child = { id: uid('h'), name: '', species: '', talents: [], parents: [], bodyFrom: '', createdAt: Date.now() };
  const talents = [];
  const spState = { slug: '' };
  const opts = (sel) => pets.map((p) => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>${esc(p.name || 'Pet')}</option>`).join('');
  const panel = ensurePanel();
  panel.innerHTML = `<div class="gd-panel hx-form" style="--sc:var(--accent)">
    <div class="gd-head"><div><span class="cb-eyebrow">Record hatch</span><div class="cb-title">New pet from a hatch</div></div>
      <button class="picker-close" id="hxClose">esc</button></div>
    <div class="gd-body">
      <p class="hx-hint">Hatching two pets makes a new Baby. Train it up and edit its stage/talents as they reveal.</p>
      <div class="hx-parents">
        <label class="sv-field"><span>Your pet</span><select id="hxPA">${opts(pets[0]?.id)}</select></label>
        <span class="hx-x">×</span>
        <label class="sv-field"><span>Hatched with</span><select id="hxPB">${opts(pets[1]?.id || pets[0]?.id)}</select></label>
      </div>
      <label class="sv-field"><span>New pet name</span><input id="hxPName" maxlength="60" placeholder="Name the hatched pet"></label>
      <div class="sv-field"><span>Pet body — which pet it hatched into</span><div id="hxSpecies"></div></div>
      <label class="sv-field"><span>Age / stage</span><select id="hxStage">${STAGES.map((s) => `<option ${s === 'Baby' ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div class="sv-field"><span>Talents it manifested</span><div id="hxTalHost" class="tp-host"></div></div>
      <div class="sv-actions"><button class="cb-load" id="hxPSave">Record hatch</button></div>
    </div></div>`;
  showPanel();
  let stage = 'Baby';
  mountSpeciesPicker($('hxSpecies'), spState, (slug) => { const nm = $('hxPName'); if (!nm.value.trim()) nm.value = speciesName(slug); });
  const redrawTal = mountTalentPicker($('hxTalHost'), talents, () => stageMax(stage));
  $('hxStage').addEventListener('change', (e) => { stage = e.target.value; while (talents.length > stageMax(stage)) talents.pop(); redrawTal(); });
  $('hxClose').addEventListener('click', hidePanel);
  $('hxPSave').addEventListener('click', () => {
    const a = $('hxPA').value, b = $('hxPB').value;
    child.parents = [...new Set([a, b].filter(Boolean))];
    // body = whichever parent matches the chosen species, else first parent
    child.species = spState.slug;
    child.bodyFrom = child.parents.find((pid) => proj.pets[pid]?.species === spState.slug) || '';
    child.name = $('hxPName').value.trim() || speciesName(spState.slug) || 'Hatchling';
    child.stage = stage;
    child.talents = talents;
    const fresh = getProject(proj.id);
    fresh.pets[child.id] = child;
    upsertProject(fresh);
    hidePanel();
    open(proj.id);
  });
  setTimeout(() => $('hxPName').focus(), 30);
}

/* ---------- deletes ---------- */
function deleteProject(id) {
  if (!confirm('Delete this hatch project? This cannot be undone.')) return;
  save(load().filter((p) => p.id !== id));
  renderList();
}
function deletePet(projId, petId) {
  const p = getProject(projId);
  if (!p) return;
  delete p.pets[petId];
  Object.values(p.pets).forEach((pet) => { pet.parents = (pet.parents || []).filter((x) => x !== petId); if (pet.bodyFrom === petId) pet.bodyFrom = ''; });
  upsertProject(p);
  open(projId);
}

/* ---------- entry ---------- */
export function renderHatchTracker(container, catalog) {
  mount = container;
  if (catalog && catalog.length && CATALOG !== catalog) {
    CATALOG = catalog;
    SPECIES = catalog.map((p) => ({ name: p.name, slug: p.slug, school: p.school })).sort((a, b) => a.name.localeCompare(b.name));
    TALENTS = [...new Set([...COMMON, ...catalog.flatMap((p) => p.talents || [])])].sort();
  }
  if (openId && getProject(openId)) open(openId); else renderList();
}
