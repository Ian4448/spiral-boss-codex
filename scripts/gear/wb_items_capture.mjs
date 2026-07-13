// For each community build, capture the WizBuilder item shareIds it loads
// (from the /builder/items/by-compact-share-ids request). Output: data/gear/wb_build_ids.json
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const presets = JSON.parse(readFileSync('site/data/presets.json', 'utf8')).builds;
const browser = await chromium.launch();
const out = [];
for (const [i, b] of presets.entries()) {
  const page = await browser.newPage();     // fresh page => full load => request fires
  let ids = [];
  page.on('response', (r) => {
    const m = r.url().match(/by-compact-share-ids\?ids=([^&\s]+)/);
    if (m) { const got = decodeURIComponent(m[1]).split(',').map(Number).filter(Boolean); if (got.length) ids = got; }
  });
  try {
    await page.goto(b.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
  } catch (e) { /* ignore */ }
  // poll until ids captured or timeout
  for (let t = 0; t < 12 && !ids.length; t++) await page.waitForTimeout(700);
  await page.close();
  out.push({ school: b.school, level: b.level, ids });
  console.log(`[${i + 1}/${presets.length}] ${b.school} L${b.level}: ${ids.length} item ids`);
}
writeFileSync('data/gear/wb_build_ids.json', JSON.stringify(out, null, 1));
console.log(`unique ids: ${new Set(out.flatMap((o) => o.ids)).size}`);
await browser.close();
