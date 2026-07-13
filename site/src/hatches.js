// Hatch Tracker — plan a pet you're hatching toward: set the talents you want,
// then log each hatch (new pet + which parents / body it used). The lineage is
// drawn as a topology graph so you can see your progress toward the goal.
import { esc, SCHOOL_COLORS } from './display.js';

const KEY = 'sbc_hatch_projects';
const $ = (id) => document.getElementById(id);

let CATALOG = [];        // pets.json (for species + talent suggestions)
let TALENTS = [];        // unique talent names
let SPECIES = [];        // { name, slug, school }
let mount = null;        // container element
let openId = null;       // currently open project id

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

/* ---------- goal matching ---------- */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function matchCount(pet, goal) {
  const have = new Set((pet.talents || []).map(norm));
  return (goal || []).filter((g) => have.has(norm(g))).length;
}
const speciesSchool = (slug) => (SPECIES.find((s) => s.slug === slug) || {}).school || '';

/* ---------- topology layout (layered DAG) ---------- */
function computeDepths(pets) {
  const memo = {};
  const map = pets;
  const depth = (id, seen) => {
    if (memo[id] != null) return memo[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    const p = map[id];
    const par = (p && p.parents || []).filter((pid) => map[pid]);
    const d = par.length ? 1 + Math.max(...par.map((pid) => depth(pid, seen))) : 0;
    seen.delete(id);
    return (memo[id] = d);
  };
  Object.keys(map).forEach((id) => depth(id, new Set()));
  return memo;
}

const NODE_W = 148, NODE_H = 52, ROW_H = 108, GAP_X = 26, PAD = 24;

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
    let row = rows[gen];
    // order by barycenter of parents to reduce edge crossings
    row = row.sort((a, b) => bary(a, petsMap, pos) - bary(b, petsMap, pos));
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = PAD + (contentW - rowW) / 2;
    row.forEach((id, i) => {
      pos[id] = { x: startX + i * (NODE_W + GAP_X), y: PAD + gen * ROW_H };
    });
  });
  const nodes = ids.map((id) => ({ id, pet: petsMap[id], ...pos[id] }));
  const edges = [];
  ids.forEach((id) => (petsMap[id].parents || []).forEach((pid) => {
    if (pos[pid]) edges.push({ from: pos[pid], to: pos[id], body: petsMap[id].bodyFrom === pid });
  }));
  const h = PAD * 2 + (Math.max(...Object.keys(rows).map(Number)) + 1) * ROW_H - (ROW_H - NODE_H);
  return { nodes, edges, w: contentW + PAD * 2, h };
}
function bary(id, map, pos) {
  const par = (map[id].parents || []).filter((p) => pos[p]);
  if (!par.length) return 0;
  return par.reduce((s, p) => s + pos[p].x, 0) / par.length;
}

function graphSvg(proj) {
  const pets = proj.pets || {};
  const lay = layout(pets);
  if (!lay.nodes.length) {
    return '<div class="hx-graph-empty">No pets yet. Add the pet you’re hatching with as a seed, then record hatches.</div>';
  }
  const goal = proj.goal || [];
  const gmax = goal.length;
  const edgeP = lay.edges.map((e) => {
    const x1 = e.from.x + NODE_W / 2, y1 = e.from.y + NODE_H, x2 = e.to.x + NODE_W / 2, y2 = e.to.y;
    const my = (y1 + y2) / 2;
    return `<path class="hx-edge ${e.body ? 'body' : ''}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
  }).join('');
  const nodeP = lay.nodes.map((n) => {
    const m = matchCount(n.pet, goal);
    const cls = gmax && m === gmax ? 'full' : m ? 'partial' : '';
    const sc = SCHOOL_COLORS[speciesSchool(n.pet.species)] || 'var(--accent)';
    const sub = n.pet.species ? esc((SPECIES.find((s) => s.slug === n.pet.species) || {}).name || '') : (n.pet.parents && n.pet.parents.length ? 'hatched' : 'seed');
    return `<g class="hx-node ${cls}" data-pet="${esc(n.id)}" transform="translate(${n.x},${n.y})" style="--sc:${sc}">
      <rect width="${NODE_W}" height="${NODE_H}" rx="10"/>
      <text class="hx-nname" x="10" y="21">${esc(trim(n.pet.name || 'Pet', 20))}</text>
      <text class="hx-nsub" x="10" y="38">${esc(trim(sub, 22))}</text>
      ${gmax ? `<text class="hx-nbadge" x="${NODE_W - 10}" y="21" text-anchor="end">${m}/${gmax}</text>` : ''}
    </g>`;
  }).join('');
  return `<div class="hx-graph-scroll"><svg class="hx-graph" viewBox="0 0 ${lay.w} ${lay.h}" width="${lay.w}" height="${lay.h}">
    <g>${edgeP}</g><g>${nodeP}</g></svg></div>`;
}
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* ---------- datalists ---------- */
function datalists() {
  return `<datalist id="hxTalents">${TALENTS.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    <datalist id="hxSpecies">${SPECIES.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>`;
}
const speciesSlugByName = (name) => (SPECIES.find((s) => norm(s.name) === norm(name)) || {}).slug || '';

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
          <ol>
            <li>Create a project and pick the talents you want.</li>
            <li>Add the pets you’re hatching with as <b>seeds</b>.</li>
            <li>Log each hatch — name the new pet and pick its two parents.</li>
            <li>The topology graph shows your lineage and which pets hit the goal.</li>
          </ol>
        </div>`}
    ${datalists()}`;
  $('hxNew').addEventListener('click', () => openEditor(null));
  mount.querySelectorAll('.hx-proj').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-del]')) { deleteProject(el.dataset.id); return; }
    open(el.dataset.id);
  }));
}

function projectCard(p) {
  const pets = Object.values(p.pets || {});
  const best = pets.reduce((m, pet) => Math.max(m, matchCount(pet, p.goal)), 0);
  const gmax = (p.goal || []).length;
  const done = gmax && best === gmax;
  return `<div class="hx-proj" data-id="${esc(p.id)}">
    <div class="hx-proj-top"><span class="hx-proj-name">${esc(p.name)}</span>
      <button class="hx-del" data-del title="Delete project">×</button></div>
    <div class="hx-goal">${(p.goal || []).slice(0, 6).map((t) => `<span class="hx-goal-chip">${esc(t)}</span>`).join('') || '<span class="pt-none">no goal talents</span>'}</div>
    <div class="hx-proj-foot">
      <span>${pets.length} pet${pets.length === 1 ? '' : 's'}</span>
      ${gmax ? `<span class="hx-progress ${done ? 'done' : ''}">best ${best}/${gmax}${done ? ' ✓' : ''}</span>` : ''}
    </div>
  </div>`;
}

/* ---------- project detail ---------- */
function open(id) {
  const p = getProject(id);
  if (!p) return renderList();
  openId = id;
  const pets = p.pets || {};
  const list = Object.values(pets).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
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
    <div class="hx-title-row">
      <h1 class="gallery-title">${esc(p.name)}</h1>
      <button class="hx-edit" id="hxEdit">Edit goal</button>
    </div>
    <div class="hx-goalbar">
      <span class="hx-goal-label">Goal</span>
      ${(p.goal || []).map((t) => `<span class="hx-goal-chip">${esc(t)}</span>`).join('') || '<span class="pt-none">no talents set</span>'}
      ${gmax ? `<span class="hx-progress ${best === gmax ? 'done' : ''}">best pet ${best}/${gmax}${best === gmax ? ' ✓ goal reached!' : ''}</span>` : ''}
    </div>
    ${graphSvg(p)}
    <p class="cb-section">Pets in this lineage</p>
    <div class="hx-petlist">${list.length ? list.map((pet) => petRow(pet, p)).join('') : '<span class="pt-none">none yet</span>'}</div>
    ${datalists()}
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
  const m = matchCount(pet, proj.goal);
  const gmax = (proj.goal || []).length;
  const parents = (pet.parents || []).map((pid) => proj.pets[pid]?.name).filter(Boolean);
  return `<div class="hx-petrow" data-pet="${esc(pet.id)}">
    <div class="hx-petrow-main">
      <span class="hx-petname">${esc(pet.name || 'Pet')}</span>
      <span class="hx-petmeta">${parents.length ? 'from ' + parents.map(esc).join(' × ') : 'seed pet'}${pet.species ? ' · ' + esc((SPECIES.find((s) => s.slug === pet.species) || {}).name || '') : ''}</span>
      <span class="hx-pettals">${(pet.talents || []).map((t) => `<span class="${matchCount({ talents: [t] }, proj.goal) ? 'hit' : ''}">${esc(t)}</span>`).join('') || '<em>no talents recorded</em>'}</span>
    </div>
    <div class="hx-petrow-side">${gmax ? `<span class="hx-progress sm ${m === gmax ? 'done' : ''}">${m}/${gmax}</span>` : ''}<button class="hx-del" data-delpet title="Remove pet">×</button></div>
  </div>`;
}

/* ---------- project editor (name + goal talents) ---------- */
function openEditor(id) {
  const p = id ? getProject(id) : { id: uid('p'), name: '', goal: [], pets: {}, createdAt: Date.now() };
  let goal = [...(p.goal || [])];
  const panel = ensurePanel();
  const chips = () => goal.map((t, i) => `<span class="hx-chip">${esc(t)}<b data-rm="${i}">×</b></span>`).join('');
  panel.innerHTML = `<div class="gd-panel hx-form" style="--sc:var(--accent)">
    <div class="gd-head"><div><span class="cb-eyebrow">${id ? 'Edit' : 'New'} project</span><div class="cb-title">Hatching goal</div></div>
      <button class="picker-close" id="hxClose">esc</button></div>
    <div class="gd-body">
      <label class="sv-field"><span>Project name</span><input id="hxName" maxlength="60" value="${esc(p.name)}" placeholder="e.g. Fire hitter pet"></label>
      <label class="sv-field"><span>Goal talents — the stats you want on the pet</span>
        <span class="hx-addrow"><input id="hxGoalIn" list="hxTalents" placeholder="Type a talent, e.g. Fire-Dealer"><button class="hx-add" id="hxGoalAdd">Add</button></span></label>
      <div class="hx-chips" id="hxGoalChips">${chips()}</div>
      <div class="sv-actions"><button class="cb-load" id="hxSave">${id ? 'Save' : 'Create project'}</button></div>
    </div></div>`;
  showPanel();
  const redraw = () => { $('hxGoalChips').innerHTML = chips(); bindRm(); };
  const bindRm = () => $('hxGoalChips').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { goal.splice(+b.dataset.rm, 1); redraw(); }));
  const addGoal = () => { const v = $('hxGoalIn').value.trim(); if (v && !goal.some((g) => norm(g) === norm(v))) goal.push(v); $('hxGoalIn').value = ''; $('hxGoalIn').focus(); redraw(); };
  bindRm();
  $('hxClose').addEventListener('click', hidePanel);
  $('hxGoalAdd').addEventListener('click', addGoal);
  $('hxGoalIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGoal(); } });
  $('hxSave').addEventListener('click', () => {
    p.name = $('hxName').value.trim() || 'Untitled project';
    p.goal = goal;
    upsertProject(p);
    hidePanel();
    openId === p.id ? open(p.id) : (id ? open(p.id) : open(p.id));
  });
  setTimeout(() => $('hxName').focus(), 30);
}

/* ---------- add / edit pet (seed or hatched) ---------- */
function openPetForm(proj, petId) {
  const editing = petId ? proj.pets[petId] : null;
  const pet = editing ? { ...editing, talents: [...(editing.talents || [])] } : { id: uid('h'), name: '', species: '', talents: [], parents: [], createdAt: Date.now() };
  let talents = [...(pet.talents || [])];
  const panel = ensurePanel();
  const parentNames = (pet.parents || []).map((pid) => proj.pets[pid]?.name).filter(Boolean);
  const chips = () => talents.map((t, i) => `<span class="hx-chip ${matchCount({ talents: [t] }, proj.goal) ? 'hit' : ''}">${esc(t)}<b data-rm="${i}">×</b></span>`).join('');
  panel.innerHTML = `<div class="gd-panel hx-form" style="--sc:var(--accent)">
    <div class="gd-head"><div><span class="cb-eyebrow">${editing ? 'Edit pet' : 'Add seed pet'}</span>
      <div class="cb-title">${editing ? esc(pet.name || 'Pet') : 'Seed pet'}</div>
      ${parentNames.length ? `<span class="gd-author">hatched from ${parentNames.map(esc).join(' × ')}</span>` : ''}</div>
      <button class="picker-close" id="hxClose">esc</button></div>
    <div class="gd-body">
      <label class="sv-field"><span>Pet name / nickname</span><input id="hxPName" maxlength="60" value="${esc(pet.name)}" placeholder="e.g. Enkindled Wildclaw"></label>
      <label class="sv-field"><span>Species / body <em>(optional)</em></span><input id="hxPSpecies" list="hxSpecies" value="${esc((SPECIES.find((s) => s.slug === pet.species) || {}).name || '')}" placeholder="e.g. Enkindled Wildclaw"></label>
      <label class="sv-field"><span>Talents it has</span>
        <span class="hx-addrow"><input id="hxPTalIn" list="hxTalents" placeholder="Add a talent it manifested"><button class="hx-add" id="hxPTalAdd">Add</button></span></label>
      <div class="hx-chips" id="hxPChips">${chips()}</div>
      <div class="sv-actions">
        <button class="cb-load" id="hxPSave">${editing ? 'Save' : 'Add pet'}</button>
      </div>
    </div></div>`;
  showPanel();
  const redraw = () => { $('hxPChips').innerHTML = chips(); bindRm(); };
  const bindRm = () => $('hxPChips').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { talents.splice(+b.dataset.rm, 1); redraw(); }));
  const add = () => { const v = $('hxPTalIn').value.trim(); if (v && !talents.some((t) => norm(t) === norm(v))) talents.push(v); $('hxPTalIn').value = ''; $('hxPTalIn').focus(); redraw(); };
  bindRm();
  $('hxClose').addEventListener('click', hidePanel);
  $('hxPTalAdd').addEventListener('click', add);
  $('hxPTalIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  $('hxPSave').addEventListener('click', () => {
    pet.name = $('hxPName').value.trim() || 'Unnamed pet';
    pet.species = speciesSlugByName($('hxPSpecies').value.trim());
    pet.talents = talents;
    const fresh = getProject(proj.id);
    fresh.pets[pet.id] = pet;
    upsertProject(fresh);
    hidePanel();
    open(proj.id);
  });
  setTimeout(() => $('hxPName').focus(), 30);
}

/* ---------- record a hatch (child of two parents) ---------- */
function openHatchForm(proj) {
  const pets = Object.values(proj.pets || {});
  const child = { id: uid('h'), name: '', species: '', talents: [], parents: [], bodyFrom: '', createdAt: Date.now() };
  let talents = [];
  const opts = (sel) => pets.map((p) => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>${esc(p.name || 'Pet')}</option>`).join('');
  const panel = ensurePanel();
  const chips = () => talents.map((t, i) => `<span class="hx-chip ${matchCount({ talents: [t] }, proj.goal) ? 'hit' : ''}">${esc(t)}<b data-rm="${i}">×</b></span>`).join('');
  panel.innerHTML = `<div class="gd-panel hx-form" style="--sc:var(--accent)">
    <div class="gd-head"><div><span class="cb-eyebrow">Record hatch</span><div class="cb-title">New pet from a hatch</div></div>
      <button class="picker-close" id="hxClose">esc</button></div>
    <div class="gd-body">
      <div class="hx-parents">
        <label class="sv-field"><span>Parent A</span><select id="hxPA">${opts(pets[0]?.id)}</select></label>
        <span class="hx-x">×</span>
        <label class="sv-field"><span>Parent B</span><select id="hxPB">${opts(pets[1]?.id || pets[0]?.id)}</select></label>
      </div>
      <label class="sv-field"><span>New pet name</span><input id="hxPName" maxlength="60" placeholder="Name the hatched pet"></label>
      <label class="sv-field"><span>Body from <em>(which parent it looks like)</em></span><select id="hxBody"><option value="">—</option></select></label>
      <label class="sv-field"><span>Talents it manifested</span>
        <span class="hx-addrow"><input id="hxPTalIn" list="hxTalents" placeholder="Add a talent it got"><button class="hx-add" id="hxPTalAdd">Add</button></span></label>
      <div class="hx-chips" id="hxPChips">${chips()}</div>
      <div class="sv-actions"><button class="cb-load" id="hxPSave">Record hatch</button></div>
    </div></div>`;
  showPanel();
  const syncBody = () => {
    const a = $('hxPA').value, b = $('hxPB').value;
    const mk = (id) => id ? `<option value="${esc(id)}">${esc(proj.pets[id]?.name || '')}</option>` : '';
    $('hxBody').innerHTML = '<option value="">—</option>' + mk(a) + (b && b !== a ? mk(b) : '');
  };
  const redraw = () => { $('hxPChips').innerHTML = chips(); bindRm(); };
  const bindRm = () => $('hxPChips').querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', () => { talents.splice(+btn.dataset.rm, 1); redraw(); }));
  const add = () => { const v = $('hxPTalIn').value.trim(); if (v && !talents.some((t) => norm(t) === norm(v))) talents.push(v); $('hxPTalIn').value = ''; $('hxPTalIn').focus(); redraw(); };
  syncBody(); bindRm();
  $('hxPA').addEventListener('change', syncBody);
  $('hxPB').addEventListener('change', syncBody);
  $('hxClose').addEventListener('click', hidePanel);
  $('hxPTalAdd').addEventListener('click', add);
  $('hxPTalIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  $('hxPSave').addEventListener('click', () => {
    const a = $('hxPA').value, b = $('hxPB').value;
    child.parents = [...new Set([a, b].filter(Boolean))];
    child.bodyFrom = $('hxBody').value || '';
    child.species = child.bodyFrom ? (proj.pets[child.bodyFrom]?.species || '') : '';
    child.name = $('hxPName').value.trim() || 'Hatchling';
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

/* ---------- overlay panel helpers ---------- */
function ensurePanel() { return $('hxPanel') || (() => { const d = document.createElement('div'); d.className = 'gallery-detail'; d.id = 'hxPanel'; d.hidden = true; mount.appendChild(d); return d; })(); }
function showPanel() { const p = $('hxPanel'); p.hidden = false; document.body.classList.add('gdetail-open'); p.addEventListener('click', (e) => { if (e.target === p) hidePanel(); }, { once: true }); }
function hidePanel() { const p = $('hxPanel'); if (p) p.hidden = true; document.body.classList.remove('gdetail-open'); }

/* ---------- entry ---------- */
export function renderHatchTracker(container, catalog) {
  mount = container;
  if (catalog && catalog.length && CATALOG !== catalog) {
    CATALOG = catalog;
    SPECIES = catalog.map((p) => ({ name: p.name, slug: p.slug, school: p.school }));
    TALENTS = [...new Set(catalog.flatMap((p) => p.talents || []))].sort();
  }
  if (openId && getProject(openId)) open(openId); else renderList();
}
