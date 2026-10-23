#!/usr/bin/env node
// Ajoute un jeu à data/games.json : infos depuis IGDB, visuels depuis SteamGridDB.
//
// En local (depuis la racine du projet) :
//   IGDB_CLIENT_ID=… IGDB_CLIENT_SECRET=… SGDB_API_KEY=… node scripts/add-game.mjs "Hollow Knight" --platform Switch
//
// Options : --igdb <id>  force le jeu IGDB quand la recherche se trompe
//           --dry-run    affiche le résultat sans rien écrire
//           --force      remplace le jeu s'il est déjà dans la collection
//
// Dans GitHub Actions, le nom et la plateforme viennent du formulaire d'issue (ISSUE_BODY / ISSUE_TITLE)
// ou des champs du lancement manuel (GAME_NAME / GAME_PLATFORM / IGDB_ID).
// Sans identifiants IGDB, le script se contente de SteamGridDB (nom, date de sortie, visuels).

import { readFile, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PLATFORMS, findPlatform } from '../assets/platforms.js';

const DATA_FILE = new URL('../data/games.json', import.meta.url);
const SGDB_API = 'https://www.steamgriddb.com/api/v2';
const IGDB_API = 'https://api.igdb.com/v4';
const IGDB_IMG = (size, id) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

const GENRES_FR = {
  'Adventure': 'Aventure',
  'Arcade': 'Arcade',
  "Card & Board Game": 'Cartes & plateau',
  'Fighting': 'Combat',
  "Hack and slash/Beat 'em up": "Beat'em all",
  'Indie': 'Indé',
  'MOBA': 'MOBA',
  'Music': 'Musique',
  'Pinball': 'Flipper',
  'Platform': 'Plateforme',
  'Point-and-click': 'Point & click',
  'Puzzle': 'Réflexion',
  'Quiz/Trivia': 'Quiz',
  'Racing': 'Course',
  'Real Time Strategy (RTS)': 'Stratégie temps réel',
  'Role-playing (RPG)': 'RPG',
  'Shooter': 'Tir',
  'Simulator': 'Simulation',
  'Sport': 'Sport',
  'Strategy': 'Stratégie',
  'Tactical': 'Tactique',
  'Turn-based strategy (TBS)': 'Stratégie tour par tour',
  'Visual Novel': 'Visual novel',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const simplify = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slugify = (s) => simplify(s).replace(/ /g, '-');

// Pour comparer des titres : « Baldur's Gate III » == « baldur s gate 3 »
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const matchKey = (s) => simplify(s).replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (r) => ROMAN[r]);
// Ce qui n'est pas le jeu lui-même : outils, mods, bandes-son…
const NOT_A_GAME = /\b(toolkit|mod manager|mod|soundtrack|ost|demo|dlc|editor|sdk|dedicated server|benchmark|artbook)\b/i;

function scoreTitle(candidate, target, index, total) {
  const n = matchKey(candidate);
  const t = matchKey(target);
  let score = total - index; // les API classent déjà par pertinence
  if (n === t) score += 50;
  else if (n.startsWith(t) || t.startsWith(n)) score += 12;
  if (NOT_A_GAME.test(candidate) && !NOT_A_GAME.test(target)) score -= 40;
  return score;
}

const best = (list, score) => list
  .map((item, i) => ({ item, score: score(item, i) }))
  .sort((a, b) => b.score - a.score)[0]?.item ?? null;

/* ---------- Lecture de la demande ---------- */

function parseIssueForm(body) {
  const out = {};
  for (const chunk of body.replace(/\r\n/g, '\n').split(/^###\s+/m).slice(1)) {
    const [label, ...rest] = chunk.split('\n');
    let value = rest.join('\n').trim();
    if (value === '_No response_') value = '';
    const l = simplify(label);
    if (l.startsWith('nom')) out.name = value;
    else if (l.startsWith('plateforme')) out.platform = value;
    else if (l.includes('igdb')) out.igdb = value;
  }
  return out;
}

function readRequest() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, force: false };
  const words = [];
  let platform;
  let igdb;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--platform' || a === '-p') platform = args[++i];
    else if (a === '--igdb') igdb = args[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else words.push(a);
  }
  let name = words.join(' ');

  const env = process.env;
  if (env.ISSUE_BODY?.trim()) {
    const form = parseIssueForm(env.ISSUE_BODY);
    name ||= form.name;
    platform ||= form.platform;
    igdb ||= form.igdb;
  }
  if (env.ISSUE_TITLE && (!name || !platform)) {
    const m = env.ISSUE_TITLE.match(/^\s*\[Ajout\]\s*(.*?)\s*(?:\(([^()]*)\))?\s*$/i);
    name ||= m?.[1];
    platform ||= m?.[2];
  }
  name ||= env.GAME_NAME;
  platform ||= env.GAME_PLATFORM;
  igdb ||= env.IGDB_ID;

  name = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Il manque le nom du jeu.');
  if (name.length > 120) throw new Error('Le nom du jeu est trop long (120 caractères max).');

  const p = findPlatform(platform);
  if (!p) {
    throw new Error(`Plateforme inconnue : « ${platform ?? ''} ». Valeurs possibles : ${PLATFORMS.map((x) => x.id).join(', ')}.`);
  }

  igdb = String(igdb ?? '').trim();
  if (igdb && !/^\d+$/.test(igdb)) throw new Error(`L'ID IGDB doit être un nombre (reçu : « ${igdb} »).`);

  return { name, platform: p, igdbId: igdb ? Number(igdb) : null, ...opts };
}

/* ---------- HTTP ---------- */

async function request(label, url, options = {}) {
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

/* ---------- IGDB ---------- */

const IGDB_FIELDS = [
  'name', 'url', 'summary', 'first_release_date', 'total_rating', 'genres.name',
  'involved_companies.developer', 'involved_companies.company.name',
  'cover.image_id', 'artworks.image_id', 'screenshots.image_id',
  'platforms.name', 'websites.url', 'external_games.url',
].join(',');

async function igdbClient() {
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
  if (platform.igdb && game.platforms?.some((p) => platform.igdb.test(p.name))) score += 15;
  if (game.cover) score += 3;
  if (game.total_rating) score += 2;
  return score;
}

async function findOnIgdb(igdb, { name, platform, igdbId }) {
  if (igdbId) {
    const [game] = (await igdb('games', `fields ${IGDB_FIELDS}; where id = ${igdbId};`)) ?? [];
    if (!game) throw new Error(`Aucun jeu IGDB avec l'ID ${igdbId}.`);
    return game;
  }
  const term = name.replace(/["\\]/g, ' ');
  const results = (await igdb('games', `search "${term}"; fields ${IGDB_FIELDS}; where version_parent = null; limit 15;`)) ?? [];
  return best(results, (g, i) => scoreCandidate(g, i, results.length, name, platform));
}

function steamAppIdFrom(game) {
  const urls = [...(game.websites ?? []), ...(game.external_games ?? [])].map((x) => x.url).filter(Boolean);
  for (const url of urls) {
    const m = url.match(/store\.steampowered\.com\/app\/(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

/* ---------- SteamGridDB ---------- */

function sgdbClient() {
  const key = process.env.SGDB_API_KEY;
  if (!key) return null;
  return (path) => request('SteamGridDB', `${SGDB_API}${path}`, { headers: { Authorization: `Bearer ${key}` } })
    .then((json) => (json?.success ? json.data : null));
}

async function findOnSgdb(sgdb, name, steamAppId) {
  if (steamAppId) {
    const game = await sgdb(`/games/steam/${steamAppId}`);
    if (game) return game;
  }
  const results = (await sgdb(`/search/autocomplete/${encodeURIComponent(name)}`)) ?? [];
  return best(results, (g, i) => scoreTitle(g.name, name, i, results.length) + (g.verified ? 2 : 0));
}

async function sgdbImages(sgdb, gameId) {
  const filters = 'nsfw=false&humor=false&types=static';
  const first = async (kind, extra = '', prefer) => {
    try {
      const list = (await sgdb(`/${kind}/game/${gameId}?${filters}${extra}`)) ?? [];
      return (prefer && list.find(prefer)) ?? list[0] ?? null;
    } catch (err) {
      console.warn(`⚠️  SteamGridDB (${kind}) : ${err.message}`);
      return null;
    }
  };
  const [grid, hero, logo, icon] = await Promise.all([
    first('grids', '&dimensions=600x900'),
    first('heroes'),
    first('logos', '', (l) => l.style === 'official'),
    first('icons'),
  ]);
  return {
    grid: grid?.url ?? null,
    gridThumb: grid?.thumb ?? null,
    hero: hero?.url ?? null,
    heroThumb: hero?.thumb ?? null, // les heroes HD pèsent parfois plusieurs Mo : le site affiche d'abord la miniature
    logo: logo?.url ?? null,
    icon: icon?.url ?? null,
  };
}

/* ---------- Collection ---------- */

async function readGames() {
  try {
    const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    return Array.isArray(data) ? data : data.games ?? [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`data/games.json est illisible : ${err.message}`);
  }
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delimiter = `EOF_${randomBytes(8).toString('hex')}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

/* ---------- Programme principal ---------- */

async function main() {
  const req = readRequest();
  const igdb = await igdbClient();
  const sgdb = sgdbClient();
  if (!igdb && !sgdb) {
    throw new Error('Aucune clé d\'API : définis SGDB_API_KEY et/ou IGDB_CLIENT_ID + IGDB_CLIENT_SECRET.');
  }
  if (!igdb) console.warn('⚠️  Pas d\'identifiants IGDB : uniquement SteamGridDB (pas de résumé ni de genres).');
  if (!sgdb) console.warn('⚠️  Pas de clé SteamGridDB : visuels IGDB uniquement.');

  console.log(`🔎 Recherche de « ${req.name} » (${req.platform.id})…`);

  const info = igdb ? await findOnIgdb(igdb, req) : null;
  if (igdb && !info) throw new Error(`IGDB ne trouve aucun jeu pour « ${req.name} ». Essaie un autre nom ou précise l'ID IGDB.`);
  if (info) console.log(`   IGDB : ${info.name} (#${info.id})`);

  const name = info?.name ?? req.name;
  const steamAppId = info ? steamAppIdFrom(info) : null;

  const sgdbGame = sgdb ? await findOnSgdb(sgdb, name, steamAppId) : null;
  if (sgdbGame) console.log(`   SteamGridDB : ${sgdbGame.name} (#${sgdbGame.id})`);
  else if (sgdb) console.warn('⚠️  SteamGridDB ne connaît pas ce jeu : visuels IGDB à la place.');
  if (!info && !sgdbGame) throw new Error(`SteamGridDB ne trouve aucun jeu pour « ${req.name} ».`);

  const art = sgdbGame ? await sgdbImages(sgdb, sgdbGame.id) : {};
  const steamCdn = steamAppId ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}` : null;

  const releaseUnix = info?.first_release_date ?? sgdbGame?.release_date;
  const displayName = info?.name ?? sgdbGame?.name ?? req.name;
  const game = {
    id: slugify(`${displayName} ${req.platform.short}`),
    name: displayName,
    platform: req.platform.id,
    addedAt: new Date().toISOString(),
    releaseDate: releaseUnix ? new Date(releaseUnix * 1000).toISOString().slice(0, 10) : null,
    summary: info?.summary ?? null,
    genres: (info?.genres ?? []).map((g) => GENRES_FR[g.name] ?? g.name),
    developers: (info?.involved_companies ?? []).filter((c) => c.developer).map((c) => c.company?.name).filter(Boolean),
    rating: info?.total_rating ? Math.round(info.total_rating) : null,
    igdbId: info?.id ?? null,
    igdbUrl: info?.url ?? null,
    sgdbId: sgdbGame?.id ?? null,
    steamAppId,
    images: {
      grid: art.grid ?? null,
      gridThumb: art.gridThumb ?? null,
      cover: info?.cover ? IGDB_IMG('cover_big_2x', info.cover.image_id) : (steamCdn && `${steamCdn}/library_600x900.jpg`),
      hero: art.hero
        ?? (info?.artworks?.[0] && IGDB_IMG('1080p', info.artworks[0].image_id))
        ?? (steamCdn && `${steamCdn}/library_hero.jpg`),
      heroThumb: art.heroThumb
        ?? (!art.hero && info?.artworks?.[0] ? IGDB_IMG('screenshot_med', info.artworks[0].image_id) : null),
      logo: art.logo ?? null,
      icon: art.icon ?? null,
      screenshots: (info?.screenshots ?? []).slice(0, 6).map((s) => IGDB_IMG('1080p', s.image_id)),
    },
  };

  const games = await readGames();
  const sameGame = (g) => g.platform === game.platform
    && ((game.igdbId && g.igdbId === game.igdbId) || (game.sgdbId && g.sgdbId === game.sgdbId)
      || matchKey(g.name) === matchKey(game.name));
  const existing = games.findIndex(sameGame);
  if (existing !== -1 && !req.force) {
    throw new Error(`${game.name} est déjà dans la collection sur ${req.platform.id} (utilise --force pour le remplacer).`);
  }
  if (existing !== -1) games.splice(existing, 1);

  const taken = new Set(games.map((g) => g.id));
  while (taken.has(game.id)) game.id += '-2';
  games.push(game);

  if (req.dryRun) {
    console.log(JSON.stringify(game, null, 2));
    console.log('\n(--dry-run : rien n\'a été écrit)');
  } else {
    await writeFile(DATA_FILE, `${JSON.stringify(games, null, 2)}\n`);
    console.log(`✅ ${game.name} ajouté (${req.platform.id}).`);
  }

  const found = ['grid', 'hero', 'logo', 'icon'].filter((k) => game.images[k]).join(', ') || 'aucun';
  setOutput('name', game.name);
  setOutput('platform', game.platform);
  setOutput('id', game.id);
  summary(`### ✅ ${game.name}\n\n- Plateforme : ${game.platform}\n- IGDB : ${game.igdbId ?? '—'}\n- SteamGridDB : ${game.sgdbId ?? '—'}\n- Visuels : ${found}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  setOutput('error', err.message);
  summary(`### ❌ Échec de l'ajout\n\n${err.message}`);
  process.exit(1);
});
