// Contenus tirés d'IGDB : recherche, actualité du jour, jeux similaires, logos des consoles.

import { PLATFORMS, platformsFromIgdb } from '../../assets/platforms.js';
import { genreFr, genreId } from '../../scripts/lib/genres-fr.mjs';
import { simplify } from '../../scripts/lib/igdb.mjs';
import { igdb, multiquery, IGDB_IMG, igdbString } from './igdb.js';

const STUB_FIELDS = 'name,first_release_date,cover.image_id,platforms.name,total_rating,total_rating_count,hypes,genres.name';

/** Résumé d'un jeu IGDB pour les listes (recherche, actualité, suggestions). */
function stub(g) {
  return {
    igdbId: g.id,
    name: g.name,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
    cover: g.cover ? IGDB_IMG('cover_big', g.cover.image_id) : null,
    platforms: platformsFromIgdb((g.platforms ?? []).map((p) => p.name)),
    genres: (g.genres ?? []).map((x) => genreFr(x.name)).slice(0, 3),
    igdbRating: g.total_rating ? Math.round(g.total_rating) : null,
    hypes: g.hypes ?? 0,
  };
}

/* ---------- Recherche (propositions pendant la frappe) ---------- */

export async function searchGames(env, term) {
  const t = igdbString(term);
  const fields = 'name,first_release_date,cover.image_id,platforms.name,total_rating_count';
  // « search » trouve les titres pertinents, « ~ » rattrape les débuts de mots (« zel » → Zelda).
  // Deux requêtes séparées : IGDB n'accepte pas « search » dans une requête groupée (multiquery).
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

  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 8).map(({ g }) => stub(g));
}

/* ---------- Actualité du jour ---------- */

const DAY = 86400;

export async function todayFeed(env) {
  const now = Math.floor(Date.now() / 1000);
  const midnight = now - (now % DAY);
  const base = 'parent_game = null & version_parent = null';

  const queries = [
    // Sorties des deux dernières semaines, les plus attendues d'abord
    { endpoint: 'games', name: 'recent', body: `fields ${STUB_FIELDS}; where ${base} & first_release_date >= ${now - 14 * DAY} & first_release_date <= ${now} & hypes > 3; sort hypes desc; limit 10;` },
    // Sorties des deux prochains mois, par date
    { endpoint: 'games', name: 'upcoming', body: `fields ${STUB_FIELDS}; where ${base} & first_release_date > ${now} & first_release_date < ${now + 60 * DAY} & hypes > 8; sort first_release_date asc; limit 14;` },
  ];
  // « Ce jour-là » : le jeu le plus marquant sorti à cette date il y a 5, 10, 15… ans
  const yearsAgo = [1, 5, 10, 15, 20, 25, 30, 35];
  const thisYear = new Date().getUTCFullYear();
  for (const n of yearsAgo) {
    const d = new Date(midnight * 1000);
    d.setUTCFullYear(thisYear - n);
    const start = Math.floor(d.getTime() / 1000);
    queries.push({
      endpoint: 'games',
      name: `ago${n}`,
      body: `fields ${STUB_FIELDS}; where ${base} & first_release_date >= ${start} & first_release_date < ${start + DAY} & total_rating_count > 15; sort total_rating_count desc; limit 1;`,
    });
  }

  const r = await multiquery(env, queries);
  return {
    date: new Date(midnight * 1000).toISOString().slice(0, 10),
    recent: (r.recent ?? []).map(stub),
    upcoming: (r.upcoming ?? []).map(stub),
    onThisDay: yearsAgo.flatMap((n) => (r[`ago${n}`] ?? []).map((g) => ({ ...stub(g), yearsAgo: n }))),
  };
}

/* ---------- Jeux similaires à ceux que tu as aimés ---------- */

export async function discover(env, ids, exclude = []) {
  const source = ids.map(Number).filter(Boolean).slice(0, 10);
  if (!source.length) return [];
  const rows = await igdb(env, 'games', `fields similar_games; where id = (${source.join(',')}); limit 10;`);
  const counts = new Map();
  for (const row of rows) for (const id of row.similar_games ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const skip = new Set(exclude.map(Number));
  const candidates = [...counts.keys()].filter((id) => !skip.has(id)).slice(0, 40);
  if (!candidates.length) return [];
  const games = await igdb(env, 'games', `fields ${STUB_FIELDS}; where id = (${candidates.join(',')}); limit 40;`);
  return games
    .map((g) => ({ ...stub(g), matches: counts.get(g.id) ?? 1 }))
    .sort((a, b) => b.matches - a.matches || (b.igdbRating ?? 0) - (a.igdbRating ?? 0))
    .slice(0, 16);
}

/* ---------- Recommandations d'après le profil ---------- */

/**
 * « Pour toi » (mode match) : jeux très bien notés dans les genres préférés.
 * « Découvertes » (mode explore) : jeux très bien notés dans des genres que le joueur ne joue pas.
 * La sélection change chaque jour (mélange déterministe), sans jamais proposer un jeu déjà possédé.
 */
export async function recommend(env, { genres = [], mode = 'match', exclude = [] }) {
  const ids = [...new Set(genres.map(genreId).filter(Boolean))].slice(0, 6);
  let where = 'parent_game = null & version_parent = null & total_rating >= 80 & total_rating_count >= 60';
  if (ids.length) where += mode === 'explore' ? ` & genres != (${ids.join(',')})` : ` & genres = (${ids.join(',')})`;
  const skip = exclude.map(Number).filter(Boolean).slice(0, 300);
  if (skip.length) where += ` & id != (${skip.join(',')})`;

  const games = await igdb(env, 'games', `fields ${STUB_FIELDS}; where ${where}; sort total_rating_count desc; limit 60;`);
  // Mélange du jour : la même liste toute la journée, une autre demain
  const day = Math.floor(Date.now() / 86400000);
  const rank = (id) => Math.sin(id * 12.9898 + day * 78.233) * 43758.5453 % 1;
  return games
    .map((g) => ({ ...stub(g), weight: Math.abs(rank(g.id)) + (g.total_rating ?? 0) / 400 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 18)
    .map(({ weight, ...g }) => g);
}

/* ---------- Logos des consoles ---------- */

export async function platformLogos(env) {
  const names = PLATFORMS.flatMap((p) => p.igdbNames.slice(0, 1)); // le nom principal de chaque console
  const rows = await igdb(env, 'platforms', `fields name,platform_logo.image_id; where name = (${names.map((n) => `"${igdbString(n)}"`).join(',')}); limit 50;`);
  const logos = {};
  for (const p of PLATFORMS) {
    const row = rows.find((r) => r.name === p.igdbNames[0]);
    if (row?.platform_logo?.image_id) logos[p.id] = `https://images.igdb.com/igdb/image/upload/t_logo_med/${row.platform_logo.image_id}.png`;
  }
  return logos;
}
