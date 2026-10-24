// Collection d'un utilisateur : jeux (fiche canonique + données personnelles), envies, liste « à jouer », réglages.
// Chaque requête est limitée à l'utilisateur connecté (user_id) : impossible de toucher à la collection d'un autre.

import { findPlatform } from '../../assets/platforms.js';
import { simplify } from '../../scripts/lib/igdb.mjs';
import { buildGameMeta, wishlistItem } from './metadata.js';
import { HttpError } from './http.js';
import { now, parseJson, transaction } from './db.js';

export const STATUSES = ['backlog', 'playing', 'finished', 'completed', 'dropped'];
export const RATING_KEYS = ['gameplay', 'story', 'visuals', 'audio', 'lifespan', 'fun'];

const today = () => new Date().toISOString().slice(0, 10);
const slugify = (s) => simplify(s).replace(/ /g, '-');
const isDate = (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
const clampInt = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v))));

/* ---------- Lecture ---------- */

/** Fiche canonique d'un jeu IGDB : depuis la base, ou construite puis gardée pour tout le monde. */
export async function gameMeta(db, env, igdbId, { refresh = false } = {}) {
  const row = db.prepare('SELECT meta FROM games WHERE igdb_id = ?').get(igdbId);
  if (row && !refresh) return parseJson(row.meta);
  const meta = await buildGameMeta(env, igdbId);
  db.prepare('INSERT INTO games (igdb_id, meta, updated_at) VALUES (?, ?, ?) ON CONFLICT(igdb_id) DO UPDATE SET meta = excluded.meta, updated_at = excluded.updated_at')
    .run(igdbId, JSON.stringify(meta), now());
  return meta;
}

/** Ligne SQL → objet « jeu » attendu par le site. */
export function toGame(row) {
  const meta = parseJson(row.game_meta ?? row.meta, {});
  return {
    ...meta,
    id: row.id,
    platform: row.platform,
    igdbId: row.igdb_id ?? null,
    steamAppId: row.steam_app_id ?? meta.steamAppId ?? null,
    matchStatus: row.match_status,
    addedAt: row.added_at,
    status: row.status,
    favorite: Boolean(row.favorite),
    ratings: parseJson(row.ratings, {}),
    review: row.review ?? '',
    playtimeMinutes: row.playtime_minutes,
    playtimeSource: row.playtime_source,
    achievements: parseJson(row.achievements),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastPlayedAt: row.last_played_at,
  };
}

const SELECT_GAMES = `SELECT c.*, g.meta AS game_meta FROM collection c LEFT JOIN games g ON g.igdb_id = c.igdb_id`;

export function getGame(db, userId, id) {
  const row = db.prepare(`${SELECT_GAMES} WHERE c.user_id = ? AND c.id = ?`).get(userId, id);
  if (!row) throw new HttpError(404, 'Jeu introuvable dans la collection.');
  return toGame(row);
}

export function getUser(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

/** Tout ce qu'il faut au site pour afficher la collection d'un utilisateur. */
export function readCollection(db, userId) {
  const user = getUser(db, userId);
  const games = db.prepare(`${SELECT_GAMES} WHERE c.user_id = ? ORDER BY c.added_at`).all(userId).map(toGame);
  const wishlist = db.prepare('SELECT item, added_at FROM wishlist WHERE user_id = ? ORDER BY added_at').all(userId)
    .map((r) => ({ ...parseJson(r.item, {}), addedAt: r.added_at }));
  const settings = parseJson(user.settings, {});
  return {
    games,
    wishlist,
    playlist: parseJson(user.playlist, []),
    settings: { name: settings.name ?? user.display_name ?? null, consoleTrailers: settings.consoleTrailers ?? {} },
  };
}

/* ---------- Jeux ---------- */

function setPlaylistIds(db, userId, ids) {
  db.prepare('UPDATE users SET playlist = ? WHERE id = ?').run(JSON.stringify(ids), userId);
}
const playlistOf = (db, userId) => parseJson(getUser(db, userId).playlist, []);

/**
 * Ajoute un jeu IGDB sur une console. `extra` permet à un import (Steam…) de fixer le lien et le temps de jeu.
 * Doublon (même jeu, même console) → 409.
 */
export async function addGame(db, env, userId, body, extra = {}) {
  const platform = findPlatform(body.platform);
  if (!platform) throw new HttpError(400, 'Console inconnue.');
  const igdbId = Number(body.igdbId) || null;
  if (!igdbId) throw new HttpError(400, 'Choisis le jeu dans les propositions.');

  const duplicate = db.prepare(`${SELECT_GAMES} WHERE c.user_id = ? AND c.igdb_id = ? AND c.platform = ?`).get(userId, igdbId, platform.id);
  if (duplicate) throw new HttpError(409, `${toGame(duplicate).name} est déjà dans ta collection sur ${platform.short}.`);

  const meta = await gameMeta(db, env, igdbId);
  return insertEntry(db, userId, {
    baseId: slugify(`${meta.name} ${platform.short}`),
    igdbId,
    platform: platform.id,
    steamAppId: extra.steamAppId ?? (platform.id === 'PC' ? meta.steamAppId ?? null : null),
    status: body.status,
    playlist: body.playlist,
    ...extra,
  });
}

/** Jeu sans correspondance IGDB fiable : gardé avec sa fiche minimale, à associer à la main. */
export function addUnmatchedGame(db, userId, { platform, meta, ...rest }) {
  return insertEntry(db, userId, { baseId: slugify(`${meta.name} ${findPlatform(platform).short}`), igdbId: null, platform, meta, matchStatus: 'unmatched', ...rest });
}

function insertEntry(db, userId, e) {
  return transaction(db, () => {
    let id = e.baseId || 'jeu';
    const taken = (x) => db.prepare('SELECT 1 FROM collection WHERE user_id = ? AND id = ?').get(userId, x);
    while (taken(id)) id += '-2';
    const status = STATUSES.includes(e.status) ? e.status : 'backlog';
    const t = now();
    db.prepare(`INSERT INTO collection (user_id, id, igdb_id, platform, steam_app_id, meta, match_status, status, playtime_minutes,
        playtime_source, achievements, started_at, last_played_at, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId, id, e.igdbId, e.platform, e.steamAppId ?? null, e.meta ? JSON.stringify(e.meta) : null, e.matchStatus ?? 'matched', status,
      e.playtimeMinutes ?? null, e.playtimeSource ?? null, e.achievements ? JSON.stringify(e.achievements) : null,
      // Un import ne connaît pas la date de début (startedAt: null) ; un ajout « en cours » commence aujourd'hui
      'startedAt' in e ? e.startedAt : status === 'playing' ? today() : null, e.lastPlayedAt ?? null, t, t,
    );
    if (e.igdbId) db.prepare('DELETE FROM wishlist WHERE user_id = ? AND igdb_id = ?').run(userId, e.igdbId);
    if (e.playlist) {
      const list = playlistOf(db, userId);
      if (!list.includes(id)) setPlaylistIds(db, userId, [...list, id]);
    }
    return getGame(db, userId, id);
  });
}

/** Modifications autorisées (et seulement elles) sur un jeu de la collection. */
export function patchGame(db, userId, id, patch) {
  const game = getGame(db, userId, id);
  const set = {};

  if ('status' in patch) {
    if (!STATUSES.includes(patch.status)) throw new HttpError(400, 'Statut inconnu.');
    set.status = patch.status;
    if (patch.status === 'playing' && !game.startedAt) set.started_at = today();
    if (['finished', 'completed'].includes(patch.status)) {
      set.finished_at = game.finishedAt ?? today();
      if (!game.startedAt) set.started_at = set.finished_at;
    }
  }
  if ('favorite' in patch) set.favorite = patch.favorite ? 1 : 0;
  if ('ratings' in patch && patch.ratings && typeof patch.ratings === 'object') {
    const ratings = { ...game.ratings };
    for (const [key, value] of Object.entries(patch.ratings)) {
      if (!RATING_KEYS.includes(key)) continue;
      if (value === null) { delete ratings[key]; continue; }
      const n = Math.round(Number(value) * 2) / 2;
      if (Number.isFinite(n) && n >= 0 && n <= 10) ratings[key] = n;
    }
    set.ratings = JSON.stringify(ratings);
  }
  if ('review' in patch) set.review = String(patch.review ?? '').slice(0, 5000);
  if ('playtimeMinutes' in patch) {
    set.playtime_minutes = patch.playtimeMinutes === null ? null : clampInt(patch.playtimeMinutes, 1_000_000);
    set.playtime_source = set.playtime_minutes === null ? null : 'manual'; // une synchro ne l'écrasera plus
  }
  if ('achievements' in patch) {
    const a = patch.achievements;
    let value = null;
    if (a && Number.isFinite(Number(a.percent))) value = { percent: clampInt(a.percent, 100), source: 'manual' };
    else if (a && Number(a.total) > 0) {
      const total = clampInt(a.total, 100_000);
      const unlocked = Math.min(total, clampInt(a.unlocked, 100_000));
      value = { unlocked, total, percent: Math.round((unlocked / total) * 100), source: 'manual' };
    }
    set.achievements = value ? JSON.stringify(value) : null;
  }
  for (const [key, col] of [['startedAt', 'started_at'], ['finishedAt', 'finished_at']]) {
    if (key in patch) {
      if (!isDate(patch[key])) throw new HttpError(400, 'Date invalide.');
      set[col] = patch[key];
    }
  }
  if ('platform' in patch) {
    const platform = findPlatform(patch.platform);
    if (!platform) throw new HttpError(400, 'Console inconnue.');
    set.platform = platform.id;
    if (platform.id !== 'PC') set.steam_app_id = null; // Steam ne concerne que les jeux rangés dans PC
  }

  const cols = Object.keys(set);
  if (cols.length) {
    transaction(db, () => {
      db.prepare(`UPDATE collection SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE user_id = ? AND id = ?`)
        .run(...cols.map((c) => set[c]), now(), userId, id);
      if (['finished', 'completed'].includes(set.status)) {
        setPlaylistIds(db, userId, playlistOf(db, userId).filter((x) => x !== id)); // terminé : sort de la liste « à jouer »
      }
    });
  }
  return getGame(db, userId, id);
}

export function removeGame(db, userId, id) {
  transaction(db, () => {
    const { changes } = db.prepare('DELETE FROM collection WHERE user_id = ? AND id = ?').run(userId, id);
    if (!changes) throw new HttpError(404, 'Jeu introuvable dans la collection.');
    setPlaylistIds(db, userId, playlistOf(db, userId).filter((x) => x !== id));
  });
}

/** Associe à la main un jeu importé sans correspondance (ou corrige une correspondance) à un jeu IGDB. */
export async function matchGame(db, env, userId, id, igdbId) {
  const game = getGame(db, userId, id);
  const target = Number(igdbId);
  if (!target) throw new HttpError(400, 'Choisis le jeu IGDB correspondant.');
  const clash = db.prepare('SELECT id FROM collection WHERE user_id = ? AND igdb_id = ? AND platform = ? AND id <> ?').get(userId, target, game.platform, id);
  if (clash) throw new HttpError(409, 'Ce jeu est déjà dans ta collection sur cette console.');
  await gameMeta(db, env, target);
  db.prepare('UPDATE collection SET igdb_id = ?, meta = NULL, match_status = ?, updated_at = ? WHERE user_id = ? AND id = ?')
    .run(target, 'matched', now(), userId, id);
  if (game.steamAppId) {
    db.prepare(`INSERT INTO external_games (provider, external_game_id, name, igdb_id, confidence, checked_at) VALUES ('steam', ?, ?, ?, 'manual', ?)
      ON CONFLICT(provider, external_game_id) DO UPDATE SET igdb_id = excluded.igdb_id, confidence = 'manual', checked_at = excluded.checked_at`)
      .run(String(game.steamAppId), game.name, target, now());
  }
  return getGame(db, userId, id);
}

/* ---------- Liste « à jouer », envies, réglages ---------- */

export function setPlaylist(db, userId, ids) {
  if (!Array.isArray(ids)) throw new HttpError(400, 'Liste invalide.');
  const owned = new Set(db.prepare('SELECT id FROM collection WHERE user_id = ?').all(userId).map((r) => r.id));
  const list = [...new Set(ids.map(String))].filter((id) => owned.has(id)).slice(0, 500);
  setPlaylistIds(db, userId, list);
  return list;
}

export async function addWishlist(db, env, userId, body) {
  const igdbId = Number(body.igdbId);
  if (!igdbId) throw new HttpError(400, 'Il manque l\'ID IGDB.');
  if (db.prepare('SELECT 1 FROM wishlist WHERE user_id = ? AND igdb_id = ?').get(userId, igdbId)) throw new HttpError(409, 'Déjà dans tes envies.');
  const item = await wishlistItem(env, igdbId);
  const addedAt = now();
  db.prepare('INSERT INTO wishlist (user_id, igdb_id, item, added_at) VALUES (?, ?, ?, ?)').run(userId, igdbId, JSON.stringify(item), addedAt);
  return { ...item, addedAt };
}

export function removeWishlist(db, userId, igdbId) {
  db.prepare('DELETE FROM wishlist WHERE user_id = ? AND igdb_id = ?').run(userId, Number(igdbId));
}

export function patchSettings(db, userId, patch) {
  const user = getUser(db, userId);
  const s = parseJson(user.settings, {});
  if ('name' in patch) s.name = String(patch.name ?? '').trim().slice(0, 40) || null;
  if ('consoleTrailers' in patch && patch.consoleTrailers && typeof patch.consoleTrailers === 'object') {
    s.consoleTrailers = { ...(s.consoleTrailers ?? {}) };
    for (const [platform, value] of Object.entries(patch.consoleTrailers)) {
      const p = findPlatform(platform);
      if (!p) continue;
      const id = String(value ?? '').match(/(?:v=|youtu\.be\/|embed\/|^)([\w-]{11})(?:\b|$)/)?.[1];
      if (id) s.consoleTrailers[p.id] = id;
      else delete s.consoleTrailers[p.id];
    }
  }
  const profilePublic = 'profilePublic' in patch ? (patch.profilePublic ? 1 : 0) : user.profile_public;
  db.prepare('UPDATE users SET settings = ?, profile_public = ? WHERE id = ?').run(JSON.stringify(s), profilePublic, userId);
  return readCollection(db, userId).settings;
}
