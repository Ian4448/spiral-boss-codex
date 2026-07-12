// Wizard101 build stat engine — pure, deterministic, shared by the UI and tests.
//
// Combines equipped gear + pet talents into per-school and global totals.
// Rule: a "Global" value on a per-school stat adds to every school. Critical and
// block are raw RATINGS (the game converts them to a chance via a level curve —
// see criticalChance()).

export const SCHOOLS = ['Fire', 'Ice', 'Storm', 'Myth', 'Life', 'Death', 'Balance'];
export const PER_SCHOOL = ['damage', 'resist', 'critical', 'block', 'pierce', 'accuracy'];
const FLAT = ['maxHealth', 'maxMana', 'powerPipChance', 'shadowPipRating',
  'pipConversion', 'stunResist', 'incHealing', 'outHealing', 'archmastery', 'startPips'];

export function emptyTotals() {
  const t = {};
  for (const k of FLAT) t[k] = 0;
  for (const k of PER_SCHOOL) t[k] = Object.fromEntries(SCHOOLS.map((s) => [s, 0]));
  return t;
}

// sources: array of items (each with .stats) and/or raw stat objects (pet talents).
export function computeStats(sources) {
  const t = emptyTotals();
  for (const src of sources) {
    if (!src) continue;
    const stats = src.stats || src;
    for (const [key, val] of Object.entries(stats)) {
      if (PER_SCHOOL.includes(key) && val && typeof val === 'object') {
        for (const [school, n] of Object.entries(val)) {
          if (school === 'Global') for (const s of SCHOOLS) t[key][s] += n;
          else if (t[key][school] !== undefined) t[key][school] += n;
        }
      } else if (typeof val === 'number') {
        t[key] = (t[key] || 0) + val;
      }
    }
  }
  return t;
}

// Approximate critical/block chance from a rating, for a same-level target.
// W101's exact curve is level-dependent; this is the commonly-used approximation
// and is labeled as an estimate in the UI. Refine with KI's published constants.
export function criticalChance(rating, level = 170) {
  if (!rating) return 0;
  // Approximation: rating vs a level-scaled baseline. Not KI's exact curve
  // (which depends on caster+target level); labeled as an estimate in the UI.
  const c = rating / (rating + level * 3);
  return Math.max(0, Math.min(0.9, c));
}

// Difference between two totals, for the compare view and hover deltas.
export function diffTotals(a, b) {
  const d = {};
  for (const k of FLAT) d[k] = (b[k] || 0) - (a[k] || 0);
  for (const k of PER_SCHOOL) {
    d[k] = Object.fromEntries(SCHOOLS.map((s) => [s, (b[k][s] || 0) - (a[k][s] || 0)]));
  }
  return d;
}
