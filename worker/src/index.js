// Mini-serveur de la Ludothèque (Cloudflare Worker).
//
//   GET  /search?q=zelda   → suggestions de jeux depuis IGDB (public, mis en cache 24 h)
//   POST /login            → vérifie le mot de passe
//   POST /add              → lance l'Action GitHub « Ajouter un jeu » (protégé par mot de passe)
//   GET  /status?name=…    → état de cette Action (le site affiche un échec au lieu d'attendre)
//
// Secrets (npx wrangler secret put …) : IGDB_CLIENT_ID, IGDB_CLIENT_SECRET, GITHUB_TOKEN, ADMIN_PASSWORD
// Variables (wrangler.toml) : GITHUB_REPO, ALLOWED_ORIGINS

import { PLATFORMS, findPlatform } from '../../assets/platforms.js';

const IGDB_API = 'https://api.igdb.com/v4';
const IGDB_IMG = (size, id) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;
const SEARCH_TTL = 24 * 3600;
const CACHE_VERSION = 2; // à augmenter quand le classement change, pour vider le cache

let igdbToken = null; // { value, expires } — gardé tant que l'instance du Worker vit

/* ---------- Réponses ---------- */

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

/* ---------- IGDB ---------- */

async function getIgdbToken(env, force = false) {
  if (!force && igdbToken && igdbToken.expires > Date.now() + 60_000) return igdbToken.value;
  const params = new URLSearchParams({ client_id: env.IGDB_CLIENT_ID, client_secret: env.IGDB_CLIENT_SECRET, grant_type: 'client_credentials' });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Connexion Twitch refusée (${res.status})`);
  const data = await res.json();
  igdbToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return igdbToken.value;
}

async function igdb(env, endpoint, body) {
  for (const force of [false, true]) {
    const token = await getIgdbToken(env, force);
    const res = await fetch(`${IGDB_API}/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': env.IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body,
    });
    if (res.status === 401 && !force) continue; // jeton expiré : on en redemande un
    if (!res.ok) throw new Error(`IGDB a répondu ${res.status}`);
    return res.json();
  }
  return [];
}

const simplify = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function searchGames(env, term) {
  const t = term.replace(/["\\]/g, ' ').trim();
  const fields = 'name,first_release_date,cover.image_id,platforms.name,total_rating_count';
  // « search » trouve les titres pertinents, « ~ » rattrape les débuts de mots (« zel » → Zelda)
  const [byRelevance, byName] = await Promise.all([
    igdb(env, 'games', `search "${t}"; fields ${fields}; where version_parent = null; limit 12;`),
    igdb(env, 'games', `fields ${fields}; where name ~ *"${t}"* & version_parent = null; sort total_rating_count desc; limit 12;`),
  ]);

  const target = simplify(t);
  const scored = new Map();
  const add = (list, bonus) => list.forEach((g, i) => {
    const n = simplify(g.name);
    let score = (scored.get(g.id)?.score ?? 0) + bonus - i;
    if (!scored.has(g.id)) {
      if (n === target) score += 100;
      else if (n.startsWith(target)) score += 30;
      else if (` ${n}`.includes(` ${target}`)) score += 25; // un mot commence par la recherche : « silks » → Silksong
      else if (n.includes(target)) score += 10;
      score += Math.log10((g.total_rating_count ?? 0) + 1) * 15; // les jeux connus d'abord
    }
    scored.set(g.id, { g, score });
  });
  add(byRelevance, 20);
  add(byName, 12);

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ g }) => ({
      igdbId: g.id,
      name: g.name,
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
      cover: g.cover ? IGDB_IMG('cover_small_2x', g.cover.image_id) : null,
      platforms: platformsOf(g),
    }));
}

/** Plateformes de la Ludothèque où le jeu existe ; uniquement d'anciennes consoles → « Rétro ». */
function platformsOf(game) {
  const names = (game.platforms ?? []).map((p) => p.name);
  const ids = PLATFORMS.filter((p) => p.igdb && names.some((n) => p.igdb.test(n))).map((p) => p.id);
  return ids.length || !names.length ? ids : ['Rétro'];
}

/* ---------- Routes ---------- */

async function handleSearch(request, env, ctx, cors) {
  const term = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 80);
  if (term.length < 2) return json({ results: [] }, 200, cors);

  const cache = caches.default;
  const key = new Request(`https://cache.ludotheque/v${CACHE_VERSION}/search?q=${encodeURIComponent(simplify(term))}`);
  const cached = await cache.match(key);
  if (cached) return json(await cached.json(), 200, cors);

  const body = { results: await searchGames(env, term) };
  ctx.waitUntil(cache.put(key, json(body, 200, { 'Cache-Control': `public, max-age=${SEARCH_TTL}` })));
  return json(body, 200, cors);
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function checkPassword(request, env) {
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const ok = Boolean(env.ADMIN_PASSWORD) && safeEqual(given, env.ADMIN_PASSWORD);
  if (!ok) await new Promise((r) => setTimeout(r, 600)); // ralentit les essais au hasard
  return ok;
}

async function handleAdd(request, env, cors) {
  if (!(await checkPassword(request, env))) return json({ error: 'Mot de passe incorrect.' }, 401, cors);

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const platform = findPlatform(body.platform);
  const igdbId = body.igdbId ? String(body.igdbId) : '';
  if (!name) return json({ error: 'Il manque le nom du jeu.' }, 400, cors);
  if (!platform) return json({ error: 'Plateforme inconnue.' }, 400, cors);
  if (igdbId && !/^\d+$/.test(igdbId)) return json({ error: 'ID IGDB invalide.' }, 400, cors);

  const res = await fetch(`${workflowUrl(env)}/dispatches`, {
    method: 'POST',
    headers: githubHeaders(env),
    body: JSON.stringify({ ref: 'main', inputs: { name, platform: platform.id, igdb_id: igdbId } }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    return json({ error: `GitHub a refusé la demande (${res.status}). ${detail}` }, 502, cors);
  }
  return json({ ok: true, name, platform: platform.id }, 202, cors);
}

const workflowUrl = (env) => `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/add-game.yml`;

const githubHeaders = (env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ludotheque-worker',
});

/** État de l'Action lancée pour un jeu, pour que le site affiche un échec au lieu d'attendre. */
async function handleStatus(request, env, cors) {
  const params = new URL(request.url).searchParams;
  const name = (params.get('name') ?? '').trim();
  const since = Number(params.get('since')) || 0;
  if (!name) return json({ error: 'Il manque le nom du jeu.' }, 400, cors);

  const res = await fetch(`${workflowUrl(env)}/runs?per_page=20`, { headers: githubHeaders(env) });
  if (!res.ok) return json({ error: `GitHub a répondu ${res.status}` }, 502, cors);
  const { workflow_runs: runs = [] } = await res.json();
  // Le titre vient de « run-name » dans .github/workflows/add-game.yml
  const run = runs.find((r) => r.display_title === `Ajout : ${name}` && Date.parse(r.created_at) >= since - 60_000);
  return json(run
    ? { found: true, status: run.status, conclusion: run.conclusion, url: run.html_url }
    : { found: false }, 200, cors);
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/search' && request.method === 'GET') return await handleSearch(request, env, ctx, cors);
      if (pathname === '/login' && request.method === 'POST') {
        return (await checkPassword(request, env)) ? json({ ok: true }, 200, cors) : json({ error: 'Mot de passe incorrect.' }, 401, cors);
      }
      if (pathname === '/add' && request.method === 'POST') return await handleAdd(request, env, cors);
      if (pathname === '/status' && request.method === 'GET') return await handleStatus(request, env, cors);
      if (pathname === '/') return json({ ok: true, service: 'ludotheque' }, 200, cors);
      return json({ error: 'Introuvable' }, 404, cors);
    } catch (err) {
      return json({ error: err.message }, 500, cors);
    }
  },
};
