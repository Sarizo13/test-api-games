// Accès à IGDB (via un jeton Twitch gardé en mémoire). Au plus 4 requêtes à la fois, comme IGDB le demande.

const IGDB_API = 'https://api.igdb.com/v4';

export const IGDB_IMG = (size, id) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

let token = null; // { value, expires }

async function getToken(env, force = false) {
  if (!force && token && token.expires > Date.now() + 60_000) return token.value;
  const params = new URLSearchParams({ client_id: env.IGDB_CLIENT_ID, client_secret: env.IGDB_CLIENT_SECRET, grant_type: 'client_credentials' });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Connexion Twitch refusée (${res.status})`);
  const data = await res.json();
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

// File d'attente : 4 requêtes en cours au maximum (limite d'IGDB : 4 par seconde, 8 ouvertes)
let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= 4) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Requête IGDB (syntaxe Apicalypse). Renouvelle le jeton s'il a expiré, patiente si IGDB limite le débit. */
export const igdb = (env, endpoint, body) => slot(() => igdbRequest(env, endpoint, body));

async function igdbRequest(env, endpoint, body) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) throw new Error('Clés IGDB manquantes (IGDB_CLIENT_ID, IGDB_CLIENT_SECRET).');
  let force = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${IGDB_API}/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': env.IGDB_CLIENT_ID, Authorization: `Bearer ${await getToken(env, force)}`, 'Content-Type': 'text/plain' },
      body,
    });
    if (res.status === 401 && !force) { force = true; continue; }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`IGDB a répondu ${res.status}`);
    return res.json();
  }
  throw new Error('IGDB ne répond pas');
}

/** Plusieurs requêtes en une (10 au maximum) : { nom: résultats }. */
export async function multiquery(env, queries) {
  const body = queries.map((q) => `query ${q.endpoint} "${q.name}" { ${q.body} };`).join('\n');
  const results = await igdb(env, 'multiquery', body);
  return Object.fromEntries(results.map((r) => [r.name, r.result ?? []]));
}

/** Échappe une chaîne pour une requête IGDB. */
export const igdbString = (s) => String(s ?? '').replace(/["\\]/g, ' ').trim();
