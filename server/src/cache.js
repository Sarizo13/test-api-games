// Cache des réponses IGDB publiques (recherche, actualité…) dans SQLite.

const CACHE_VERSION = 1; // à augmenter quand le format d'une réponse en cache change
const inflight = new Map(); // une seule requête en vol par clé

export async function cached(db, key, ttlSeconds, compute) {
  const fullKey = `v${CACHE_VERSION}/${key}`;
  const row = db.prepare('SELECT value FROM cache WHERE key = ? AND expires_at > ?').get(fullKey, Date.now());
  if (row) return JSON.parse(row.value);
  if (inflight.has(fullKey)) return inflight.get(fullKey);
  const promise = (async () => {
    const value = await compute();
    db.prepare('INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
      .run(fullKey, JSON.stringify(value), Date.now() + ttlSeconds * 1000);
    return value;
  })().finally(() => inflight.delete(fullKey));
  inflight.set(fullKey, promise);
  return promise;
}
