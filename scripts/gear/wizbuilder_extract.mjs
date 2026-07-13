// Render each WizBuilder preset build and extract its gear + pet talents, so we
// can load them natively into our build creator.
// Output: data/gear/wb_builds.json  [{school, level, url, gear:{slot:{name,lvl}}, talents:[...]}]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const SLOTS = ['Hat', 'Robe', 'Boots', 'Wand', 'Athame', 'Amulet', 'Ring', 'Deck', 'Mount'];
const SLOT_KEY = { Hat: 'hat', Robe: 'robe', Boots: 'boots', Wand: 'wand', Athame: 'athame', Amulet: 'amulet', Ring: 'ring', Deck: 'deck' };
const STOP = new Set(['JEWELS', 'Shield Slot', 'Sword Slot', 'None', 'Pet Jewel']);

const presets = JSON.parse(readFileSync('site/data/presets.json', 'utf8')).builds;

function parseBuild(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const gear = {};
  for (let i = 0; i < lines.length; i++) {
    if (SLOTS.includes(lines[i])) {
      // next non-empty, non-STOP line is the item
      let j = i + 1;
      while (j < lines.length && (!lines[j] || STOP.has(lines[j]))) j++;
      const val = lines[j];
      if (val && SLOTS.includes(val)) continue;      // empty slot
      if (val && !STOP.has(val) && lines[i] !== 'Mount') {
        const m = val.match(/^(.*?)\s*\(Lvl\s*(\d+)\)\s*$/);
        const slot = SLOT_KEY[lines[i]];
        if (slot) gear[slot] = { name: (m ? m[1] : val).trim(), lvl: m ? +m[2] : null };
      }
    }
  }
  // pet talents: lines after "Pet Output Stats" that look like TalentName +N%
  const talents = [];
  const petIdx = lines.findIndex((l) => l === 'Pet Output Stats');
  if (petIdx >= 0) {
    for (let i = petIdx + 1; i < lines.length && talents.length < 5; i++) {
      if (/^[A-Z][A-Za-z'-]+(?:\s[A-Za-z'-]+)*$/.test(lines[i]) && lines[i + 1] && /^[+-]/.test(lines[i + 1])) {
        talents.push(lines[i]);
      }
    }
  }
  // headline stats that are cleanly labeled in WizBuilder's Total Stats block
  const num = (re) => { const m = text.match(re); return m ? +m[1] : null; };
  const stats = {
    health: num(/Health:\s*\n?\s*([\d,]+)/),
    mana: num(/Mana:\s*\n?\s*([\d,]+)/),
    powerPip: num(/Power Pip Chance:\s*\n?\s*(\d+)%/),
    shadowPip: num(/Shadow Pip Rating:\s*\n?\s*(\d+)/),
    critical: num(/Critical Rating\s*\n?\s*(\d+)/),
  };
  // build-school damage/resist = the largest value in each block (mono-school builds)
  const block = (label) => {
    const i = text.indexOf(label);
    if (i < 0) return null;
    const seg = text.slice(i + label.length, i + label.length + 120);
    const vals = [...seg.matchAll(/(\d+)%/g)].map((m) => +m[1]);
    return vals.length ? Math.max(...vals) : null;
  };
  stats.damage = block('\nDamage\n');
  stats.resist = block('\nResist\n');
  return { gear, talents, stats };
}

const browser = await chromium.launch();
const page = await browser.newPage();
const out = [];
for (const [idx, b] of presets.entries()) {
  try {
    await page.goto(b.url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    const { gear, talents, stats } = parseBuild(text);
    out.push({ school: b.school, level: b.level, url: b.url, gear, talents, stats });
    console.log(`[${idx + 1}/${presets.length}] ${b.school} L${b.level}: ${Object.keys(gear).length} slots, ${talents.length} talents, hp ${stats.health}`);
  } catch (e) {
    console.log(`[${idx + 1}] ${b.school} L${b.level}: FAILED ${e.message.split('\n')[0]}`);
    out.push({ school: b.school, level: b.level, url: b.url, gear: {}, talents: [] });
  }
}
writeFileSync('data/gear/wb_builds.json', JSON.stringify(out, null, 1));
console.log(`\nwrote ${out.length} builds`);
await browser.close();
