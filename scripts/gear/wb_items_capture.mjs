// For each community build, capture the WizBuilder item shareIds it loads
// (from the /builder/items/by-compact-share-ids request). Output: data/gear/wb_build_ids.json
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const presets = JSON.parse(readFileSync('data/gear/wb_builds.json', 'utf8'));  // has .url per build
const browser = await chromium.launch();
const out = [];
for (const [i, b] of presets.entries()) {
  const page = await browser.newPage();     // fresh page => full load => request fires
  let ids = [];
  page.on('response', (r) => {
    const m = r.url().match(/(?:by-compact-share-ids|legacy-items\/by-ids)\?ids=([^&\s]+)/);
    if (m) { const got = decodeURIComponent(m[1]).split(',').map(Number).filter(Boolean);
      ids = [...new Set([...ids, ...got])]; }   // accumulate across all item requests
  });
  try {
    await page.goto(b.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
  } catch (e) { /* ignore */ }
  // give all item batches time to fire, then a bit more
  for (let t = 0; t < 8; t++) await page.waitForTimeout(700);
  await page.close();
  out.push({ school: b.school, level: b.level, ids });
  console.log(`[${i + 1}/${presets.length}] ${b.school} L${b.level}: ${ids.length} item ids`);
}
writeFileSync('data/gear/wb_build_ids.json', JSON.stringify(out, null, 1));
console.log(`unique ids: ${new Set(out.flatMap((o) => o.ids)).size}`);
await browser.close();
