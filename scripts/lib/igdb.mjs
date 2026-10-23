// Accès à IGDB et comparaison de titres, partagés par les scripts d'ajout et de mise à jour.

const IGDB_API = 'https://api.igdb.com/v4';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const simplify = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Pour comparer des titres : « Baldur's Gate III » == « baldur s gate 3 »
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
export const matchKey = (s) => simplify(s).replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (r) => ROMAN[r]);
// Ce qui n'est pas le jeu lui-même : outils, mods, bandes-son…
const NOT_A_GAME = /\b(toolkit|mod manager|mod|soundtrack|ost|demo|dlc|editor|sdk|dedicated server|benchmark|artbook)\b/i;

export function scoreTitle(candidate, target, index, total) {
  const n = matchKey(candidate);
  const t = matchKey(target);
  let score = total - index; // les API classent déjà par pertinence
  if (n === t) score += 50;
  else if (n.startsWith(t) || t.startsWith(n)) score += 12;
  if (NOT_A_GAME.test(candidate) && !NOT_A_GAME.test(target)) score -= 40;
  return score;
}

export const best = (list, score) => list
  .map((item, i) => ({ item, score: score(item, i) }))
  .sort((a, b) => b.score - a.score)[0]?.item ?? null;

export async function request(label, url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < 4) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`${label} a répondu ${res.status} ${res.statusText} : ${text}`);
    }
    return res.json();
  }
}

/** Client IGDB authentifié, ou null sans IGDB_CLIENT_ID / IGDB_CLIENT_SECRET. */
export async function igdbClient() {
  const { IGDB_CLIENT_ID: id, IGDB_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return null;
  const params = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' });
  const auth = await request('Twitch (connexion IGDB)', `https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  if (!auth?.access_token) throw new Error('Twitch n\'a pas renvoyé de jeton : vérifie IGDB_CLIENT_ID et IGDB_CLIENT_SECRET.');
  const headers = { 'Client-ID': id, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'text/plain' };
  return (endpoint, query) => request('IGDB', `${IGDB_API}/${endpoint}`, { method: 'POST', headers, body: query });
}

function scoreCandidate(game, index, total, name, platform) {
  let score = scoreTitle(game.name, name, index, total);
  if (platform?.igdb && game.platforms?.some((p) => platform.igdb.test(p.name))) score += 15;
  if (game.cover) score += 3;
  if (game.total_rating) score += 2;
  return score;
}

/**
 * Trouve un jeu sur IGDB, par son ID ou par son nom (en tenant compte de la plateforme).
 * `fields` doit contenir platforms.name, cover.image_id et total_rating pour bien classer les résultats.
 */
export async function findGame(igdb, { name, platform, igdbId }, fields) {
  if (igdbId) {
    const [game] = (await igdb('games', `fields ${fields}; where id = ${igdbId};`)) ?? [];
    if (!game) throw new Error(`Aucun jeu IGDB avec l'ID ${igdbId}.`);
    return game;
  }
  const term = name.replace(/["\\]/g, ' ');
  const results = (await igdb('games', `search "${term}"; fields ${fields}; where version_parent = null; limit 15;`)) ?? [];
  return best(results, (g, i) => scoreCandidate(g, i, results.length, name, platform));
}

/** Choisit la bande-annonce la plus représentative parmi les vidéos YouTube d'IGDB. */
export function pickTrailer(videos = []) {
  const rank = (v) => {
    const n = (v.name ?? '').toLowerCase();
    if (/launch|release|lancement/.test(n)) return 0;
    if (/announce|reveal|annonce/.test(n)) return 2;
    if (/trailer|bande/.test(n) && !/gameplay|teaser|dlc|update|season|patch/.test(n)) return 1;
    if (/trailer|teaser/.test(n)) return 3;
    return 4;
  };
  const video = [...videos].filter((v) => /^[\w-]{11}$/.test(v.video_id ?? '')).sort((a, b) => rank(a) - rank(b))[0];
  return video ? { youtubeId: video.video_id, name: video.name ?? null } : null;
}
