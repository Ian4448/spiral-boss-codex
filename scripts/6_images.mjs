// Stage 6: mirror boss portrait thumbnails from Wayback into site/img/<slug>.png.
// Tries the page's own snapshot timestamp, then any nearest snapshot, then the
// full-size original. Not every image was ever archived — misses are recorded in
// data/img_missing.json so re-runs skip them; the UI falls back to a monogram.
// Writes site/data/images.json (slugs that have a portrait) for the frontend.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

const bosses = JSON.parse(readFileSync('site/data/bosses.json', 'utf8'));
mkdirSync('site/img', { recursive: true });

const MISSING_FILE = process.env.NSHARDS ? `data/img_missing_${process.env.SHARD}.json` : 'data/img_missing.json';
const globalMissing = existsSync('data/img_missing.json') ? JSON.parse(readFileSync('data/img_missing.json', 'utf8')) : [];
const missing = new Set([...(existsSync(MISSING_FILE) ? JSON.parse(readFileSync(MISSING_FILE, 'utf8')) : []), ...globalMissing]);
const UA = 'W101CheatDB/0.1 (fan project; contact: ra09997@uga.edu)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function candidates(b) {
  const base = `https://wiki.wizard101central.com${b.image}`;
  const urls = [];
  if (b.snapshotTs) urls.push(`https://web.archive.org/web/${b.snapshotTs}id_/${base}`);
  urls.push(`https://web.archive.org/web/2024id_/${base}`);
  // full-size original: /wiki/images/thumb/a/b/X.png/240px-X.png -> /wiki/images/a/b/X.png
  const full = b.image.replace(/\/thumb(\/.+?\/[^/]+)\/[^/]+$/, '$1');
  if (full !== b.image) urls.push(`https://web.archive.org/web/2024id_/https://wiki.wizard101central.com${full}`);
  return urls;
}

// Last resort: ask the CDX index whether ANY size of this image was ever captured
// (the wiki serves thumbs at many widths; pages we crawled reference just one).
async function cdxFallback(b) {
  const m = b.image.match(/\/wiki\/images\/(?:thumb\/)?(.+?\/[^/]+?\.(?:png|jpg|gif))/);
  if (!m) return null;
  const q = `wiki.wizard101central.com/wiki/images/thumb/${m[1]}*`;
  const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(q)}&output=json&filter=statuscode:200&fl=original,timestamp&collapse=urlkey&limit=8`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const rows = await res.json();
    rows.shift();
    if (!rows.length) return null;
    // prefer the widest thumb available
    rows.sort((a, z) => {
      const w = (u) => +(u.match(/\/(\d+)px-/)?.[1] ?? 0);
      return w(z[0]) - w(a[0]);
    });
    const [orig, ts] = rows[0];
    return `https://web.archive.org/web/${ts}id_/${orig}`;
  } catch {
    return null;
  }
}

const SHARD = parseInt(process.env.SHARD || '0', 10);
const NSHARDS = parseInt(process.env.NSHARDS || '1', 10);

let done = 0, skipped = 0, failed = 0;
const todo = bosses.filter((b) => b.image).filter((_, i) => i % NSHARDS === SHARD);
for (const [i, b] of todo.entries()) {
  const dest = `site/img/${b.slug}.png`;
  if (existsSync(dest) || missing.has(b.slug)) { skipped++; continue; }

  let ok = false;
  const urls = candidates(b);
  for (let c = 0; c < urls.length + 1; c++) {
    let url = urls[c];
    if (!url) {
      // all direct candidates 404'd — ask the CDX index for any captured size
      url = await cdxFallback(b).catch(() => null);
      if (!url) break;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        if (res.status === 429 || res.status >= 500) {
          const wait = 25000 * (attempt + 1);
          console.log(`[${i + 1}/${todo.length}] ${b.slug}: HTTP ${res.status}, backing off ${wait / 1000}s`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) break; // 404 -> next candidate
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 500) break;
        writeFileSync(dest, buf);
        ok = true;
        break;
      } catch (e) {
        console.log(`[${i + 1}/${todo.length}] ${b.slug}: ${e.message}, retrying`);
        await sleep(15000);
      }
    }
    if (ok) break;
    await sleep(600);
  }
  if (ok) done++; else { failed++; missing.add(b.slug); }
  if ((done + failed) % 20 === 0) {
    console.log(`shard ${SHARD}: ${done} fetched, ${skipped} cached, ${failed} missing, ${i + 1}/${todo.length} scanned`);
    writeFileSync(MISSING_FILE, JSON.stringify([...missing], null, 1));
  }
  await sleep(900);
}

writeFileSync(MISSING_FILE, JSON.stringify([...missing], null, 1));
const have = new Set(readdirSync('site/img').filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
writeFileSync('site/data/images.json', JSON.stringify([...have].sort()));
console.log(`DONE shard ${SHARD}: ${done} fetched, ${skipped} skipped, ${failed} missing; ${have.size} portraits total`);
