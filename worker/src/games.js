// Fiches de jeux : construction (IGDB, SteamGridDB, Steam, Wikipédia) et modifications de la collection.

import { findPlatform, platformsFromIgdb } from '../../assets/platforms.js';
import { frenchSummary, enwikiTitleFrom } from '../../scripts/lib/summary-fr.mjs';
import { pickTrailer, scoreTitle, best, simplify } from '../../scripts/lib/igdb.mjs';
import { steamTrailer } from '../../scripts/lib/steam.mjs';
import { genreFr } from '../../scripts/lib/genres-fr.mjs';
import { igdb, IGDB_IMG, igdbString } from './igdb.js';
import { HttpError } from './store.js';

export const STATUSES = ['backlog', 'playing', 'finished', 'completed', 'dropped'];
export const RATING_KEYS = ['gameplay', 'story', 'visuals', 'audio', 'lifespan', 'fun'];

const FIELDS = [
  'name', 'slug', 'url', 'summary', 'first_release_date', 'total_rating', 'genres.name', 'themes.name',
  'involved_companies.developer', 'involved_companies.company.name',
  'cover.image_id', 'artworks.image_id', 'screenshots.image_id',
  'platforms.name', 'websites.url', 'external_games.url', 'videos.name', 'videos.video_id', 'similar_games',
].join(',');

const slugify = (s) => simplify(s).replace(/ /g, '-');
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- Recherche du jeu sur IGDB ---------- */

function steamAppIdFrom(game) {
  const urls = [...(game.websites ?? []), ...(game.external_games ?? [])].map((x) => x.url).filter(Boolean);
  for (const url of urls) {
    const m = url.match(/store\.steampowered\.com\/app\/(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** ID IGDB d'un jeu Steam, grâce aux liens « external_games ». */
async function igdbIdFromSteam(env, appId) {
  const rows = await igdb(env, 'external_games', `fields game,url; where uid = "${Number(appId)}"; limit 20;`);
  return rows.find((r) => /steampowered/.test(r.url ?? ''))?.game ?? null;
}

async function igdbIdFromName(env, name, platform) {
  const results = await igdb(env, 'games', `search "${igdbString(name)}"; fields name,platforms.name,cover,total_rating; where version_parent = null; limit 15;`);
  const pick = best(results, (g, i) => {
    let score = scoreTitle(g.name, name, i, results.length);
    if (platform?.igdb && g.platforms?.some((p) => platform.igdb.test(p.name))) score += 15;
    return score + (g.cover ? 3 : 0) + (g.total_rating ? 2 : 0);
  });
  return pick?.id ?? null;
}

/* ---------- SteamGridDB (facultatif : sans clé, on prend les visuels d'IGDB) ---------- */

async function sgdb(env, path) {
  const res = await fetch(`https://www.steamgriddb.com/api/v2${path}`, { headers: { Authorization: `Bearer ${env.SGDB_API_KEY}` } });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.success ? json.data : null;
}

async function sgdbImages(env, name, steamAppId) {
  if (!env.SGDB_API_KEY) return {};
  try {
    let game = steamAppId ? await sgdb(env, `/games/steam/${steamAppId}`) : null;
    if (!game) {
      const results = (await sgdb(env, `/search/autocomplete/${encodeURIComponent(name)}`)) ?? [];
      game = best(results, (g, i) => scoreTitle(g.name, name, i, results.length) + (g.verified ? 2 : 0));
    }
    if (!game) return {};
    const filters = 'nsfw=false&humor=false&types=static';
    const first = async (kind, extra = '', prefer) => {
      const list = (await sgdb(env, `/${kind}/game/${game.id}?${filters}${extra}`)) ?? [];
      return (prefer && list.find(prefer)) ?? list[0] ?? null;
    };
    const [grid, hero, logo] = await Promise.all([
      first('grids', '&dimensions=600x900'),
      first('heroes'),
      first('logos', '', (l) => l.style === 'official'),
    ]);
    return {
      sgdbId: game.id,
      grid: grid?.url ?? null,
      gridThumb: grid?.thumb ?? null,
      hero: hero?.url ?? null,
      heroThumb: hero?.thumb ?? null,
      logo: logo?.url ?? null,
    };
  } catch {
    return {};
  }
}

/* ---------- Construction d'une fiche ---------- */

async function buildGame(env, igdbId, platform) {
  const [info] = await igdb(env, 'games', `fields ${FIELDS}; where id = ${Number(igdbId)};`);
  if (!info) throw new HttpError(404, 'Jeu introuvable sur IGDB.');

  const steamAppId = steamAppIdFrom(info);
  const [ttb] = await igdb(env, 'game_time_to_beats', `fields hastily,normally,completely; where game_id = ${info.id};`).catch(() => []);
  const [art, fr, steamVideo] = await Promise.all([
    sgdbImages(env, info.name, steamAppId),
    frenchSummary({
      name: info.name,
      steamAppId,
      igdbSlug: info.slug,
      enwikiTitle: enwikiTitleFrom((info.websites ?? []).map((w) => w.url)),
      english: info.summary,
    }, { deeplKey: env.DEEPL_API_KEY }).catch(() => ({ summary: info.summary ?? null, summarySource: 'igdb', summaryUrl: null })),
    steamTrailer(steamAppId),
  ]);

  const hours = (seconds) => (seconds ? Math.round(seconds / 360) / 10 : null);
  const steamCdn = steamAppId ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}` : null;

  return {
    id: slugify(`${info.name} ${platform.short}`),
    name: info.name,
    platform: platform.id,
    addedAt: new Date().toISOString(),
    releaseDate: info.first_release_date ? new Date(info.first_release_date * 1000).toISOString().slice(0, 10) : null,
    ...fr,
    genres: [...new Set((info.genres ?? []).map((g) => genreFr(g.name)))],
    developers: (info.involved_companies ?? []).filter((c) => c.developer).map((c) => c.company?.name).filter(Boolean),
    igdbRating: info.total_rating ? Math.round(info.total_rating) : null,
    igdbId: info.id,
    igdbUrl: info.url ?? null,
    sgdbId: art.sgdbId ?? null,
    steamAppId,
    similar: (info.similar_games ?? []).slice(0, 10),
    timeToBeat: ttb ? { hastily: hours(ttb.hastily), normally: hours(ttb.normally), completely: hours(ttb.completely) } : null,
    trailer: pickTrailer(info.videos),
    steamTrailer: steamVideo,
    images: {
      grid: art.grid ?? (info.cover ? IGDB_IMG('cover_big_2x', info.cover.image_id) : null),
      gridThumb: art.gridThumb ?? (info.cover ? IGDB_IMG('cover_big', info.cover.image_id) : null),
      cover: info.cover ? IGDB_IMG('cover_big_2x', info.cover.image_id) : null,
      hero: art.hero
        ?? (info.artworks?.[0] && IGDB_IMG('1080p', info.artworks[0].image_id))
        ?? (steamCdn && `${steamCdn}/library_hero.jpg`)
        ?? (info.screenshots?.[0] && IGDB_IMG('1080p', info.screenshots[0].image_id)),
      heroThumb: art.heroThumb ?? (info.artworks?.[0] ? IGDB_IMG('screenshot_med', info.artworks[0].image_id) : null),
      logo: art.logo ?? null,
      screenshots: (info.screenshots ?? []).slice(0, 6).map((s) => IGDB_IMG('1080p', s.image_id)),
    },
    // Données personnelles
    status: 'backlog',
    favorite: false,
    ratings: {},
    review: '',
    playtimeMinutes: null,
    playtimeSource: null,
    achievements: null,
    startedAt: null,
    finishedAt: null,
  };
}

/* ---------- Modifications de la collection ---------- */

export async function addGame(env, state, body) {
  const platform = findPlatform(body.platform);
  if (!platform) throw new HttpError(400, 'Console inconnue.');

  let igdbId = Number(body.igdbId) || null;
  if (!igdbId && body.steamAppId) igdbId = await igdbIdFromSteam(env, body.steamAppId);
  if (!igdbId && body.name) igdbId = await igdbIdFromName(env, body.name, platform);
  if (!igdbId) throw new HttpError(404, 'Jeu introuvable sur IGDB.');

  const duplicate = state.games.find((g) => g.igdbId === igdbId && g.platform === platform.id);
  if (duplicate) throw new HttpError(409, `${duplicate.name} est déjà dans ta collection sur ${platform.short}.`);

  const game = await buildGame(env, igdbId, platform);
  if (STATUSES.includes(body.status)) game.status = body.status;
  if (game.status === 'playing') game.startedAt = today();
  const taken = new Set(state.games.map((g) => g.id));
  while (taken.has(game.id)) game.id += '-2';

  state.games.push(game);
  state.wishlist = state.wishlist.filter((w) => w.igdbId !== igdbId);
  if (body.playlist && !state.playlist.includes(game.id)) state.playlist.push(game.id);
  return game;
}

const isDate = (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
const clampInt = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v))));

/** Applique les modifications autorisées (et seulement elles) à une fiche. */
export function patchGame(state, id, patch) {
  const game = state.games.find((g) => g.id === id);
  if (!game) throw new HttpError(404, 'Jeu introuvable dans la collection.');

  if ('status' in patch) {
    if (!STATUSES.includes(patch.status)) throw new HttpError(400, 'Statut inconnu.');
    game.status = patch.status;
    if (patch.status === 'playing' && !game.startedAt) game.startedAt = today();
    if (['finished', 'completed'].includes(patch.status)) {
      game.finishedAt ??= today();
      game.startedAt ??= game.finishedAt;
      state.playlist = state.playlist.filter((x) => x !== id); // terminé : on le sort de la liste « à jouer »
    }
  }
  if ('favorite' in patch) game.favorite = Boolean(patch.favorite);
  if ('ratings' in patch && patch.ratings && typeof patch.ratings === 'object') {
    game.ratings = { ...(game.ratings ?? {}) };
    for (const [key, value] of Object.entries(patch.ratings)) {
      if (!RATING_KEYS.includes(key)) continue;
      if (value === null) { delete game.ratings[key]; continue; }
      const n = Math.round(Number(value) * 2) / 2;
      if (Number.isFinite(n) && n >= 0 && n <= 10) game.ratings[key] = n;
    }
  }
  if ('review' in patch) game.review = String(patch.review ?? '').slice(0, 5000);
  if ('playtimeMinutes' in patch) {
    game.playtimeMinutes = patch.playtimeMinutes === null ? null : clampInt(patch.playtimeMinutes, 1_000_000);
    game.playtimeSource = game.playtimeMinutes === null ? null : 'manual';
  }
  if ('achievements' in patch) {
    const a = patch.achievements;
    if (a === null) game.achievements = null;
    else if (a && Number.isFinite(Number(a.percent))) game.achievements = { percent: clampInt(a.percent, 100), source: 'manual' };
    else if (a && Number(a.total) > 0) {
      const total = clampInt(a.total, 100_000);
      const unlocked = Math.min(total, clampInt(a.unlocked, 100_000));
      game.achievements = { unlocked, total, percent: Math.round((unlocked / total) * 100), source: 'manual' };
    }
  }
  for (const key of ['startedAt', 'finishedAt']) {
    if (key in patch) {
      if (!isDate(patch[key])) throw new HttpError(400, 'Date invalide.');
      game[key] = patch[key];
    }
  }
  if ('platform' in patch) {
    const platform = findPlatform(patch.platform);
    if (!platform) throw new HttpError(400, 'Console inconnue.');
    game.platform = platform.id;
  }
  return game;
}

export function removeGame(state, id) {
  const before = state.games.length;
  state.games = state.games.filter((g) => g.id !== id);
  state.playlist = state.playlist.filter((x) => x !== id);
  if (state.games.length === before) throw new HttpError(404, 'Jeu introuvable dans la collection.');
}

export function setPlaylist(state, ids) {
  if (!Array.isArray(ids)) throw new HttpError(400, 'Liste invalide.');
  const owned = new Set(state.games.map((g) => g.id));
  state.playlist = [...new Set(ids.map(String))].filter((id) => owned.has(id));
  return state.playlist;
}

export async function addWishlist(env, state, body) {
  const igdbId = Number(body.igdbId);
  if (!igdbId) throw new HttpError(400, 'Il manque l\'ID IGDB.');
  if (state.wishlist.some((w) => w.igdbId === igdbId)) throw new HttpError(409, 'Déjà dans tes envies.');
  const [g] = await igdb(env, 'games', `fields name,cover.image_id,first_release_date,platforms.name,total_rating,hypes,genres.name; where id = ${igdbId};`);
  if (!g) throw new HttpError(404, 'Jeu introuvable sur IGDB.');
  const item = {
    igdbId,
    name: g.name,
    cover: g.cover ? IGDB_IMG('cover_big', g.cover.image_id) : null,
    releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
    platforms: platformsFromIgdb((g.platforms ?? []).map((p) => p.name)),
    genres: (g.genres ?? []).map((x) => genreFr(x.name)).slice(0, 3),
    igdbRating: g.total_rating ? Math.round(g.total_rating) : null,
    hypes: g.hypes ?? 0,
    addedAt: new Date().toISOString(),
  };
  state.wishlist.push(item);
  return item;
}

export function removeWishlist(state, igdbId) {
  state.wishlist = state.wishlist.filter((w) => w.igdbId !== Number(igdbId));
}

export function patchSettings(state, patch) {
  const s = (state.settings ??= {});
  if ('name' in patch) s.name = String(patch.name ?? '').trim().slice(0, 40) || null;
  if ('consoleTrailers' in patch && patch.consoleTrailers && typeof patch.consoleTrailers === 'object') {
    s.consoleTrailers = { ...(s.consoleTrailers ?? {}) };
    for (const [platform, value] of Object.entries(patch.consoleTrailers)) {
      if (!findPlatform(platform)) continue;
      const id = String(value ?? '').match(/(?:v=|youtu\.be\/|embed\/|^)([\w-]{11})(?:\b|$)/)?.[1];
      if (id) s.consoleTrailers[findPlatform(platform).id] = id;
      else delete s.consoleTrailers[findPlatform(platform).id];
    }
  }
  return s;
}
