// Stage 2: download archived pages listed in data/pages.json into data/raw/<slug>.html.
// Throttled (~1 req/s), exponential backoff on 429/5xx, resumable (skips existing files).
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';

const pages = JSON.parse(readFileSync('data/pages.json', 'utf8'));
mkdirSync('data/raw', { recursive: true });

const UA = 'W101CheatDB/0.1 (fan project; contact: ra09997@uga.edu)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let done = 0, skipped = 0, failed = 0;
const failures = [];

for (const [i, page] of pages.entries()) {
  const dest = `data/raw/${page.slug}.html`;
  if (existsSync(dest) && statSync(dest).size > 5000) { skipped++; continue; }

  const snapUrl = `https://web.archive.org/web/${page.timestamp}id_/${page.url}`;
  let ok = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(snapUrl, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        const wait = 20000 * (attempt + 1);
        console.log(`[${i + 1}/${pages.length}] ${page.slug}: HTTP ${res.status}, backing off ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        console.log(`[${i + 1}/${pages.length}] ${page.slug}: HTTP ${res.status}, giving up`);
        break;
      }
      const body = await res.text();
      if (body.length < 3000) {
        console.log(`[${i + 1}/${pages.length}] ${page.slug}: suspiciously small (${body.length}b), retrying`);
        await sleep(10000);
        continue;
      }
      writeFileSync(dest, body);
      ok = true;
      break;
    } catch (e) {
      console.log(`[${i + 1}/${pages.length}] ${page.slug}: ${e.message}, retrying`);
      await sleep(15000 * (attempt + 1));
    }
  }
  if (ok) {
    done++;
    if (done % 25 === 0) console.log(`progress: ${done} downloaded, ${skipped} cached, ${failed} failed, ${i + 1}/${pages.length} scanned`);
  } else {
    failed++;
    failures.push(page.slug);
  }
  await sleep(1100);
}

writeFileSync('data/download_failures.json', JSON.stringify(failures, null, 1));
console.log(`DONE: ${done} downloaded, ${skipped} already cached, ${failed} failed (see data/download_failures.json)`);
