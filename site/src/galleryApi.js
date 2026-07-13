// Client for the community gallery serverless API (/api/builds, Vercel Blob-backed).
// Dependency-free so both the creator and the gallery view can import it without cycles.

const API = '/api/builds';

export async function publishBuild(payload) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `publish failed (${r.status})`);
  return data; // { id, ok }
}

export async function fetchBuilds(school) {
  const q = school ? `?school=${encodeURIComponent(school)}` : '';
  const r = await fetch(API + q, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`list failed (${r.status})`);
  return r.json(); // { builds, total }
}

export async function fetchBuild(id) {
  const r = await fetch(`${API}?id=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`fetch failed (${r.status})`);
  return r.json(); // full build
}
