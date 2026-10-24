// Outils de test : serveur Asobi sur un port libre, base en mémoire, faux Discord / Steam / IGDB.
// Aucun appel réel n'est fait : toute adresse non simulée répond 404 (et est notée dans `unexpected`).

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

process.env.ENV_FILE = join(tmpdir(), 'asobi-no-env-file');
const realFetch = globalThis.fetch;

/** Remplace fetch : `handlers` = [[/regex sur l'URL/, (url, init) => réponse JSON ou Response]]. */
export function mockInternet(base) {
  const handlers = [];
  const calls = [];
  const unexpected = [];
  const previous = globalThis.fetch; // remis en place à la fin (les simulations peuvent s'empiler)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith(base)) return realFetch(input, init);
    calls.push({ url, init });
    for (const [re, fn] of handlers) {
      if (re.test(url)) {
        const out = await fn(url, init);
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    unexpected.push(url);
    return new Response('{}', { status: 404 });
  };
  return {
    calls,
    unexpected,
    on(re, fn) { handlers.unshift([re, fn]); return this; },
    restore() { globalThis.fetch = previous; },
  };
}

export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export async function startTestServer(overrides = {}) {
  const config = loadConfig({
    PUBLIC_URL: 'http://asobi.test',
    DISCORD_CLIENT_ID: 'client-id',
    DISCORD_CLIENT_SECRET: 'client-secret',
    STEAM_API_KEY: 'steam-key',
    IGDB_CLIENT_ID: 'igdb-id',
    IGDB_CLIENT_SECRET: 'igdb-secret',
    TRUST_PROXY: '0',
    ...overrides,
  });
  const db = openDb(':memory:');
  const ctx = { db, config, key: randomBytes(32), log: () => {}, awaitJobs: true };
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const net = mockInternet(base);
  // IGDB : jeton Twitch toujours accepté
  net.on(/id\.twitch\.tv\/oauth2\/token/, () => ({ access_token: 'twitch', expires_in: 3600 }));
  return {
    base, ctx, db, config, net,
    async close() {
      net.restore();
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

/** Navigateur minimal : garde ses cookies, ajoute l'en-tête X-Asobi aux écritures, ne suit pas les redirections. */
export function browser(base, origin = 'http://asobi.test') {
  const jar = new Map();
  const store = (res) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (attrs.some((a) => /max-age=0/i.test(a)) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
  };
  async function request(method, path, { body, headers = {} } = {}) {
    const h = { ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET' && !('X-Asobi' in h)) { h['X-Asobi'] = '1'; h.Origin ??= origin; }
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    store(res);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* pas du JSON */ }
    return { status: res.status, headers: res.headers, data, location: res.headers.get('location') };
  }
  return {
    jar,
    get: (p, o) => request('GET', p, o),
    post: (p, body, o) => request('POST', p, { ...o, body }),
    patch: (p, body, o) => request('PATCH', p, { ...o, body }),
    put: (p, body, o) => request('PUT', p, { ...o, body }),
    del: (p, body, o) => request('DELETE', p, { ...o, body }),
  };
}

/** Faux Discord : un utilisateur et ses connexions. Renvoie les compteurs d'appels. */
export function fakeDiscord(net, { user, connections = [], tokenExpiresIn = 604800 }) {
  const seen = { token: 0, refresh: 0, me: 0, connections: 0, revoke: 0 };
  let current = { user, connections };
  net.on(/discord\.com\/api\/v10\/oauth2\/token\/revoke/, () => { seen.revoke++; return {}; });
  net.on(/discord\.com\/api\/v10\/oauth2\/token$/, async (url, init) => {
    const form = new URLSearchParams(String(init.body));
    if (form.get('grant_type') === 'refresh_token') {
      seen.refresh++;
      if (form.get('refresh_token') === 'revoked') return json({ error: 'invalid_grant' }, 400);
      return { access_token: `access-${current.user.id}-r${seen.refresh}`, refresh_token: `refresh-${current.user.id}`, expires_in: 604800, scope: 'identify connections' };
    }
    if (form.get('code') !== `code-${current.user.id}`) return json({ error: 'invalid_grant' }, 400);
    seen.token++;
    return { access_token: `access-${current.user.id}`, refresh_token: `refresh-${current.user.id}`, expires_in: tokenExpiresIn, scope: 'identify connections' };
  });
  net.on(/discord\.com\/api\/v10\/users\/@me$/, () => { seen.me++; return current.user; });
  net.on(/discord\.com\/api\/v10\/users\/@me\/connections/, () => { seen.connections++; return current.connections; });
  return { seen, set(next) { current = { ...current, ...next }; } };
}

/** Connexion complète d'un navigateur avec un compte Discord simulé. */
export async function login(t, discordUser) {
  const b = browser(t.base);
  const start = await b.get('/api/auth/discord/login?next=%23%2Fconsoles');
  const state = new URL(start.location).searchParams.get('state');
  const done = await b.get(`/api/auth/discord/callback?code=code-${discordUser.id}&state=${encodeURIComponent(state)}`);
  return { b, start, done, state };
}

/** Faux IGDB : `games` = { id: { name, ... } }, `steam` = { appid: igdbId }. */
export function fakeIgdb(net, { games = {}, steam = {} } = {}) {
  net.on(/api\.igdb\.com\/v4\/external_games/, (url, init) => {
    const uids = [...String(init.body).matchAll(/"(\d+)"/g)].map((m) => m[1]);
    return uids.filter((u) => steam[u]).map((u) => ({ game: steam[u], uid: u, url: `https://store.steampowered.com/app/${u}` }));
  });
  net.on(/api\.igdb\.com\/v4\/game_time_to_beats/, () => []);
  net.on(/api\.igdb\.com\/v4\/games/, (url, init) => {
    const body = String(init.body);
    const id = Number(body.match(/where id = (\d+)/)?.[1]);
    if (id) return games[id] ? [{ id, ...games[id] }] : [];
    const search = body.match(/search "([^"]+)"/)?.[1];
    if (search) return Object.entries(games).filter(([, g]) => g.name.toLowerCase().includes(search.toLowerCase())).map(([gid, g]) => ({ id: Number(gid), ...g }));
    return [];
  });
}

/** Faux Steam : bibliothèque, succès (par appid), et profil privé si `private`. */
export function fakeSteam(net, { owned = [], achievements = {}, private: isPrivate = false } = {}) {
  const seen = { owned: 0, achievements: 0, private: isPrivate }; // `seen.private = true` : le profil devient privé
  net.on(/api\.steampowered\.com\/IPlayerService\/GetOwnedGames/, () => {
    seen.owned++;
    return seen.private ? { response: {} } : { response: { game_count: owned.length, games: owned } };
  });
  net.on(/api\.steampowered\.com\/ISteamUserStats\/GetPlayerAchievements/, (url) => {
    seen.achievements++;
    const appid = new URL(url).searchParams.get('appid');
    const a = achievements[appid];
    return a ? { playerstats: { achievements: Array.from({ length: a[1] }, (_, i) => ({ achieved: i < a[0] ? 1 : 0 })) } } : { playerstats: { error: 'no stats' } };
  });
  net.on(/api\.steampowered\.com\/ISteamUser\/GetPlayerSummaries/, () => ({ response: { players: [{ personaname: 'Sarizo', communityvisibilitystate: 3 }] } }));
  return seen;
}

export const DISCORD_USER = { id: '111111111111111111', username: 'sarizo', global_name: 'Sarizo', avatar: null };
export const OTHER_USER = { id: '222222222222222222', username: 'rival', global_name: 'Rival', avatar: 'abc' };
export const STEAM_ID = '76561198988944789';
