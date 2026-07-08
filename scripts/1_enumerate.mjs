// Stage 1: enumerate archived Creature: pages via the Wayback CDX API.
// Output: data/pages.json — [{ url, timestamp, slug }] latest 200-snapshot per page.
import { writeFileSync, mkdirSync } from 'fs';

const CDX =
  'https://web.archive.org/cdx/search/cdx' +
  '?url=wiki.wizard101central.com/wiki/Creature:*' +
  '&output=json&fl=urlkey,original,timestamp,statuscode&filter=statuscode:200';

const res = await fetch(CDX, { headers: { 'User-Agent': 'W101CheatDB/0.1 (fan project; contact: ra09997@uga.edu)' } });
if (!res.ok) throw new Error(`CDX request failed: ${res.status}`);
const rows = await res.json();
rows.shift(); // header row

// Keep latest snapshot per urlkey; skip query-string URLs and non-article pages.
const latest = new Map();
for (const [urlkey, original, timestamp] of rows) {
  if (original.includes('?') || original.includes('index.php')) continue;
  const prev = latest.get(urlkey);
  if (!prev || timestamp > prev.timestamp) latest.set(urlkey, { url: original, timestamp });
}

const pages = [...latest.values()]
  .map(({ url, timestamp }) => {
    const m = url.match(/\/wiki\/(Creature:[^?#]+)/);
    if (!m) return null;
    const title = decodeURIComponent(m[1]);
    const slug = title
      .replace(/^Creature:/, '')
      .replace(/[^A-Za-z0-9()'!-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return { title, url, timestamp, slug };
  })
  .filter(Boolean);

// Dedupe slugs that collide after decoding (encoded vs plain parens etc.) — keep latest.
const bySlug = new Map();
for (const p of pages) {
  const prev = bySlug.get(p.slug);
  if (!prev || p.timestamp > prev.timestamp) bySlug.set(p.slug, p);
}
const out = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));

mkdirSync('data', { recursive: true });
writeFileSync('data/pages.json', JSON.stringify(out, null, 1));
console.log(`wrote data/pages.json with ${out.length} pages (${rows.length} snapshots scanned)`);
