// Fiches des jeux canoniques : IGDB, visuels SteamGridDB, résumé en français, bande-annonce Steam.
// Une fiche ne contient aucune donnée personnelle : elle est partagée par tous les utilisateurs (table games).

import { platformsFromIgdb } from '../../assets/platforms.js';
import { frenchSummary, enwikiTitleFrom } from '../../scripts/lib/summary-fr.mjs';
import { pickTrailer, scoreTitle, best, matchKey } from '../../scripts/lib/igdb.mjs';
import { steamTrailer } from '../../scripts/lib/steam.mjs';
import { genreFr } from '../../scripts/lib/genres-fr.mjs';
import { igdb, IGDB_IMG, igdbString } from './igdb.js';
import { HttpError } from './http.js';

const FIELDS = [
  'name', 'slug', 'url', 'summary', 'first_release_date', 'total_rating', 'genres.name', 'themes.name',
  'involved_companies.developer', 'involved_companies.company.name',
  'cover.image_id', 'artworks.image_id', 'screenshots.image_id',
  'platforms.name', 'websites.url', 'external_games.url', 'videos.name', 'videos.video_id', 'similar_games',
].join(',');

const isoDate = (seconds) => (seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : null);

function steamAppIdFrom(game) {
  const urls = [...(game.websites ?? []), ...(game.external_games ?? [])].map((x) => x.url).filter(Boolean);
  for (const url of urls) {
    const m = url.match(/store\.steampowered\.com\/app\/(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

/* ---------- Correspondances : jeu d'une plateforme → jeu IGDB ---------- */

/**
 * Jeux Steam → IGDB grâce aux liens officiels « external_games » d'IGDB (fiabilité « exact »).
 * Renvoie une Map appId → igdbId pour ceux qu'IGDB connaît.
 */
export async function igdbIdsFromSteam(env, appIds) {
  const found = new Map();
  const ids = [...new Set(appIds.map(Number).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await igdb(env, 'external_games', `fields game,uid,url; where uid = (${chunk.map((id) => `"${id}"`).join(',')}); limit 500;`);
    for (const r of rows) if (/store\.steampowered\.com\/app\//.test(r.url ?? '') && r.game) found.set(Number(r.uid), r.game);
  }
  return found;
}

/**
 * Recherche par titre : on n'accepte que les titres identiques une fois normalisés
 * (« Baldur's Gate III » = « baldur s gate 3 ») ; une simple ressemblance ne suffit jamais.
 */
export async function igdbIdFromExactTitle(env, name, platform) {
  const results = await igdb(env, 'games', `search "${igdbString(name)}"; fields name,platforms.name,cover,total_rating; where version_parent = null; limit 15;`);
  const exact = results.filter((g) => matchKey(g.name) === matchKey(name));
  const pick = best(exact, (g, i) => {
    let score = scoreTitle(g.name, name, i, exact.length);
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

/* ---------- Fiches ---------- */

/** Fiche canonique d'un jeu IGDB (sans console ni données personnelles). */
export async function buildGameMeta(env, igdbId) {
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
    name: info.name,
    releaseDate: isoDate(info.first_release_date),
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
  };
}

/** Fiche minimale d'un jeu Steam qu'IGDB ne connaît pas (à associer plus tard à la main). */
export function steamOnlyMeta(appId, name) {
  const cdn = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}`;
  return {
    name: name || `Jeu Steam ${appId}`,
    releaseDate: null,
    summary: null,
    genres: [],
    developers: [],
    igdbId: null,
    steamAppId: Number(appId),
    images: { grid: `${cdn}/library_600x900.jpg`, gridThumb: `${cdn}/library_600x900.jpg`, cover: `${cdn}/library_600x900.jpg`, hero: `${cdn}/library_hero.jpg`, heroThumb: null, logo: `${cdn}/logo.png`, screenshots: [] },
  };
}

/** Élément de la liste d'envies. */
export async function wishlistItem(env, igdbId) {
  const [g] = await igdb(env, 'games', `fields name,cover.image_id,first_release_date,platforms.name,total_rating,hypes,genres.name; where id = ${Number(igdbId)};`);
  if (!g) throw new HttpError(404, 'Jeu introuvable sur IGDB.');
  return {
    igdbId: g.id,
    name: g.name,
    cover: g.cover ? IGDB_IMG('cover_big', g.cover.image_id) : null,
    releaseDate: isoDate(g.first_release_date),
    platforms: platformsFromIgdb((g.platforms ?? []).map((p) => p.name)),
    genres: (g.genres ?? []).map((x) => genreFr(x.name)).slice(0, 3),
    igdbRating: g.total_rating ? Math.round(g.total_rating) : null,
    hypes: g.hypes ?? 0,
  };
}
