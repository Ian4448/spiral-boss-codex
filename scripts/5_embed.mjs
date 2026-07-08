// Stage 5: build semantic-search vectors for site/data/bosses.json using
// all-MiniLM-L6-v2 (same model the browser loads for the query side).
// Output: site/data/embeddings.bin (int8-quantized) + embeddings.meta.json.
import { readFileSync, writeFileSync } from 'fs';
import { pipeline } from '@xenova/transformers';

const bosses = JSON.parse(readFileSync('site/data/bosses.json', 'utf8'));
const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });

const texts = bosses.map((b) => {
  const parts = [
    b.name,
    b.world || '',
    (b.locations || []).join('. '),
    b.school ? `${b.school} school boss` : '',
    (b.tagLabels || []).join('. '),
    (b.cheats || []).join(' ').replace(/\[[^\]]*\]/g, ' ').slice(0, 1500),
  ];
  return parts.filter(Boolean).join('. ');
});

const dims = 384;
const all = new Float32Array(bosses.length * dims);
for (let i = 0; i < texts.length; i++) {
  const out = await embedder(texts[i], { pooling: 'mean', normalize: true });
  all.set(out.data, i * dims);
  if ((i + 1) % 100 === 0) console.log(`embedded ${i + 1}/${texts.length}`);
}

let maxAbs = 0;
for (const v of all) maxAbs = Math.max(maxAbs, Math.abs(v));
const scale = maxAbs / 127;
const int8 = new Int8Array(all.length);
for (let i = 0; i < all.length; i++) int8[i] = Math.round(all[i] / scale);

writeFileSync('site/data/embeddings.bin', Buffer.from(int8.buffer));
writeFileSync('site/data/embeddings.meta.json', JSON.stringify({
  dims,
  scale,
  model: 'Xenova/all-MiniLM-L6-v2',
  slugs: bosses.map((b) => b.slug),
}));
console.log(`wrote ${bosses.length} vectors (${(int8.length / 1024).toFixed(0)} KB) + meta`);
