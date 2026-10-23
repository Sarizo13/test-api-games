// Mini-serveur d'Asobi (Cloudflare Worker) : la collection vit dans Cloudflare KV.
//
// Lecture (public)
//   GET    /collection           jeux, envies, liste « à jouer », réglages publics
//   GET    /search?q=zelda       propositions IGDB pendant la frappe (cache 24 h)
//   GET    /today                sorties récentes, à venir, « ce jour-là » (cache 6 h)
//   GET    /discover?ids=1,2     jeux similaires à ceux que tu as aimés (cache 24 h)
//   GET    /recommend?genres=RPG,Aventure&mode=match|explore   « Pour toi » / « Découvertes » (cache 6 h)
//   GET    /platform-logos       logos des consoles (cache 7 j)
// Écriture (mot de passe : Authorization: Bearer …)
//   POST   /login
//   POST   /games                { igdbId | steamAppId | name, platform, status?, playlist? }
//   PATCH  /games/:id            statut, notes, avis, temps de jeu, trophées, dates, console…
//   DELETE /games/:id
//   POST   /wishlist             { igdbId }      DELETE /wishlist/:igdbId
//   PUT    /playlist             { ids: [...] }
//   PATCH  /settings             { name, consoleTrailers, steam }
//   POST   /steam/sync           { offset }      GET /steam/library
//
// Secrets : IGDB_CLIENT_ID, IGDB_CLIENT_SECRET, ADMIN_PASSWORD
//           SGDB_API_KEY (visuels), STEAM_API_KEY (Steam), DEEPL_API_KEY (résumés) — facultatifs
// Variables (wrangler.toml) : ALLOWED_ORIGINS — Stockage : KV « LUDO »

import { loadState, saveState, publicState, HttpError } from './store.js';
import { addGame, patchGame, removeGame, setPlaylist, addWishlist, removeWishlist, patchSettings } from './games.js';
import { resolveSteamId, syncSteam, steamLibrary } from './steam.js';
import { searchGames, todayFeed, discover, platformLogos, recommend } from './feed.js';
import { simplify } from '../../scripts/lib/igdb.mjs';

const CACHE_VERSION = 3; // à augmenter quand le format d'une réponse en cache change

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function requireAuth(request, env) {
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (env.ADMIN_PASSWORD && safeEqual(given, env.ADMIN_PASSWORD)) return;
  await new Promise((r) => setTimeout(r, 600)); // ralentit les essais au hasard
  throw new HttpError(401, 'Mot de passe incorrect.');
}

/** Réponse mise en cache à la périphérie de Cloudflare. */
async function cached(ctx, key, ttl, compute) {
  const cache = caches.default;
  const request = new Request(`https://cache.ludotheque/v${CACHE_VERSION}/${key}`);
  const hit = await cache.match(request);
  if (hit) return hit.json();
  const data = await compute();
  ctx.waitUntil(cache.put(request, new Response(JSON.stringify(data), { headers: { 'Cache-Control': `public, max-age=${ttl}` } })));
  return data;
}

const body = (request) => request.json().catch(() => ({}));

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const [, section, param] = path.split('/');

  /* ----- Lecture ----- */
  if (method === 'GET') {
    if (path === '/') return { ok: true, service: 'ludotheque', version: 2 };
    if (path === '/collection') return publicState(await loadState(env));
    if (path === '/search') {
      const term = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
      if (term.length < 2) return { results: [] };
      return { results: await cached(ctx, `search/${encodeURIComponent(simplify(term))}`, 86400, () => searchGames(env, term)) };
    }
    if (path === '/today') return cached(ctx, `today/${new Date().toISOString().slice(0, 10)}`, 6 * 3600, () => todayFeed(env));
    if (path === '/discover') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number).filter(Boolean).slice(0, 10);
      const exclude = (url.searchParams.get('exclude') ?? '').split(',').map(Number).filter(Boolean).slice(0, 400);
      return { results: await cached(ctx, `discover/${ids.join('-')}/${exclude.length}`, 86400, () => discover(env, ids, exclude)) };
    }
    if (path === '/platform-logos') return cached(ctx, 'platform-logos', 7 * 86400, () => platformLogos(env));
    if (path === '/recommend') {
      const genres = (url.searchParams.get('genres') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
      const mode = url.searchParams.get('mode') === 'explore' ? 'explore' : 'match';
      const exclude = (url.searchParams.get('exclude') ?? '').split(',').map(Number).filter(Boolean).slice(0, 300);
      const key = `recommend/${mode}/${encodeURIComponent(genres.join('|'))}/${exclude.length}/${new Date().toISOString().slice(0, 10)}`;
      return { results: await cached(ctx, key, 6 * 3600, () => recommend(env, { genres, mode, exclude })) };
    }
    if (path === '/steam/library') {
      await requireAuth(request, env);
      return { results: await steamLibrary(env, await loadState(env)) };
    }
  }

  /* ----- Écriture ----- */
  if (path === '/login' && method === 'POST') { await requireAuth(request, env); return { ok: true }; }

  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    await requireAuth(request, env);
    const state = await loadState(env);
    let result;

    if (section === 'games' && !param && method === 'POST') result = { game: await addGame(env, state, await body(request)) };
    else if (section === 'games' && param && method === 'PATCH') result = { game: patchGame(state, decodeURIComponent(param), await body(request)) };
    else if (section === 'games' && param && method === 'DELETE') { removeGame(state, decodeURIComponent(param)); result = { ok: true }; }
    else if (section === 'wishlist' && !param && method === 'POST') result = { item: await addWishlist(env, state, await body(request)) };
    else if (section === 'wishlist' && param && method === 'DELETE') { removeWishlist(state, param); result = { ok: true }; }
    else if (path === '/playlist' && method === 'PUT') result = { playlist: setPlaylist(state, (await body(request)).ids) };
    else if (path === '/settings' && method === 'PATCH') {
      const patch = await body(request);
      if ('steam' in patch) state.settings.steamId = patch.steam ? await resolveSteamId(env, patch.steam) : null;
      patchSettings(state, patch);
      result = { settings: publicState(state).settings };
    } else if (path === '/steam/sync' && method === 'POST') result = await syncSteam(env, state, Number((await body(request)).offset) || 0);
    else throw new HttpError(404, 'Introuvable');

    await saveState(env, state);
    return result;
  }

  throw new HttpError(404, 'Introuvable');
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      return json(await route(request, env, ctx), 200, cors);
    } catch (err) {
      return json({ error: err.message }, err.status ?? 500, cors);
    }
  },
};
