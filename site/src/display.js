// Shared display helpers used by the build creator and the community gallery.

export const IMG_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? './img'
  : 'https://cdn.jsdelivr.net/gh/Ian4448/spiral-boss-codex@main/site/img';

export const SCHOOL_COLORS = {
  Fire: '#e8542f', Ice: '#6db9e8', Storm: '#8b5cf6', Myth: '#e8c02f',
  Life: '#4caf50', Death: '#a0a0b2', Balance: '#c98a3d',
};

export const SLOT_LABEL = {
  hat: 'Hat', robe: 'Robe', boots: 'Boots', wand: 'Wand',
  athame: 'Athame', amulet: 'Amulet', ring: 'Ring', deck: 'Deck',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
export const schoolIcon = (s) => `<img class="school-icon" src="${IMG_BASE}/schools/${s}.png" alt="${s}" title="${s}">`;

export const SCHOOL_ABBR = { Fire: 'Fire', Ice: 'Ice', Storm: 'Storm', Myth: 'Myth', Life: 'Life', Death: 'Death', Balance: 'Bal', Global: 'all' };
export const STAT_UNIT = { damage: '%', resist: '%', pierce: '%', accuracy: '%', critical: '', block: '' };
export const STAT_WORD = { damage: 'dmg', resist: 'resist', pierce: 'pierce', accuracy: 'acc', critical: 'crit', block: 'block' };

// Expressive per-school description of an item's stats, e.g.
// "+1070 hp · +22% Fire dmg · +104 Fire crit · +12% resist"
export function describeStats(stats, { max = 99 } = {}) {
  const out = [];
  if (!stats) return out;
  if (stats.maxHealth) out.push(`+${stats.maxHealth} hp`);
  if (stats.maxMana) out.push(`+${stats.maxMana} mana`);
  for (const k of ['damage', 'critical', 'pierce', 'resist', 'accuracy', 'block']) {
    const perSchool = stats[k];
    if (!perSchool) continue;
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
