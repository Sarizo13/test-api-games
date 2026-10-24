// Moteur commun des bibliothèques de plateformes (PlayStation, Xbox, Epic, Nintendo).
//
// Un connecteur n'a qu'à fournir `fetchLibrary(ctx, account)`, qui renvoie ses jeux sous une forme commune :
//   { id, name, platform, playtimeMinutes, firstPlayedAt, lastPlayedAt, achievements: { unlocked, total, percent } | null, image }
// Le moteur garde ces données brutes (platform_games), propose les jeux pas encore dans la collection, les importe
// et synchronise les jeux reliés, avec les mêmes règles que Steam :
//   - fiche IGDB seulement si le titre est identique une fois normalisé, sinon le jeu est gardé « à associer » ;
//   - le statut n'est fixé qu'à la création, une valeur saisie à la main (ou venue d'une autre plateforme) n'est jamais écrasée ;
//   - un jeu absent d'une réponse n'est jamais retiré de la collection.

import { ACCOUNT_STATUS, defineProvider } from './provider.js';
import { ProviderError, mapLimit } from './sync.js';
import { addGame, addUnmatchedGame } from '../../collection.js';
import { igdbIdFromExactTitle } from '../../metadata.js';
import { now, transaction, parseJson } from '../../db.js';
import { HttpError } from '../../http.js';
import { findPlatform } from '../../../../assets/platforms.js';
import { matchKey } from '../../../../scripts/lib/igdb.mjs';

const RECHECK_DAYS = 30;
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

export const setAccount = (db, id, fields) => {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE connected_accounts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
};

export const accountData = (account) => parseJson(account.external_data, {});

/** Garde un identifiant interne de la plateforme sur le compte (accountId PSN, XUID…). */
export function saveAccountData(db, account, patch) {
  const data = { ...accountData(account), ...patch };
  setAccount(db, account.id, { external_data: JSON.stringify(data) });
  account.external_data = JSON.stringify(data);
  return data;
}

/**
 * Compte relié par une connexion directe à la plateforme (Epic, Nintendo) : la propriété est prouvée.
 * Un compte déjà vérifié chez un autre utilisateur d'Asobi est refusé.
 */
export function upsertLinkedAccount(ctx, userId, provider, { externalId, username, externalData }) {
  const { db } = ctx;
  const owner = db.prepare('SELECT user_id FROM connected_accounts WHERE provider = ? AND external_user_id = ? AND verified = 1').get(provider, externalId);
  if (owner && owner.user_id !== userId) throw new HttpError(409, 'Ce compte est déjà relié à un autre utilisateur d\'Asobi.');
  const row = db.prepare('SELECT * FROM connected_accounts WHERE user_id = ? AND provider = ? AND external_user_id = ?').get(userId, provider, externalId);
  const message = 'Compte relié : tu peux importer ta bibliothèque.';
  if (row) {
    const keep = [ACCOUNT_STATUS.SYNCED].includes(row.status);
    db.prepare('UPDATE connected_accounts SET verified = 1, external_username = ?, external_data = ?, status = ?, status_message = ? WHERE id = ?')
      .run(username ?? row.external_username, JSON.stringify({ ...parseJson(row.external_data, {}), ...externalData }),
        keep ? row.status : ACCOUNT_STATUS.CONNECTED, keep ? row.status_message : message, row.id);
    return row.id;
  }
  const { lastInsertRowid } = db.prepare(`INSERT INTO connected_accounts (user_id, provider, external_user_id, external_username, verified, detected_via, status, status_message, connected_at, external_data)
    VALUES (?, ?, ?, ?, 1, 'login', ?, ?, ?, ?)`).run(userId, provider, externalId, username ?? null, ACCOUNT_STATUS.CONNECTED, message, now(), JSON.stringify(externalData ?? {}));
  return Number(lastInsertRowid);
}

/* ---------- Données brutes ---------- */

function storeLibrary(db, account, games) {
  const t = now();
  const stmt = db.prepare(`INSERT INTO platform_games (connected_account_id, external_game_id, name, platform, image_url, playtime_minutes,
      first_played_at, last_played_at, achievements_unlocked, achievements_total, achievements_percent, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connected_account_id, external_game_id) DO UPDATE SET name = excluded.name, platform = excluded.platform,
      image_url = COALESCE(excluded.image_url, platform_games.image_url),
      playtime_minutes = COALESCE(excluded.playtime_minutes, platform_games.playtime_minutes),
      first_played_at = COALESCE(platform_games.first_played_at, excluded.first_played_at),
      last_played_at = COALESCE(excluded.last_played_at, platform_games.last_played_at),
      achievements_unlocked = COALESCE(excluded.achievements_unlocked, platform_games.achievements_unlocked),
      achievements_total = COALESCE(excluded.achievements_total, platform_games.achievements_total),
      achievements_percent = COALESCE(excluded.achievements_percent, platform_games.achievements_percent),
      last_seen_at = excluded.last_seen_at`);
  transaction(db, () => {
    for (const g of games) {
      stmt.run(account.id, String(g.id), g.name ?? null, g.platform, g.image ?? null, g.playtimeMinutes ?? null, day(g.firstPlayedAt), day(g.lastPlayedAt),
        g.achievements?.unlocked ?? null, g.achievements?.total ?? null, g.achievements?.percent ?? null, t, t);
    }
  });
}

const rowToGame = (r) => ({
  id: r.external_game_id,
  name: r.name,
  platform: r.platform,
  image: r.image_url,
  playtimeMinutes: r.playtime_minutes,
  firstPlayedAt: r.first_played_at,
  lastPlayedAt: r.last_played_at,
  achievements: achievementsOf(r.achievements_unlocked ?? 0, r.achievements_total ?? 0, r.achievements_percent ?? undefined),
});

/** { unlocked, total, percent } ; seulement { percent } quand la plateforme ne donne que la progression ; null si rien. */
export const achievementsOf = (unlocked, total, percent) => {
  if (!(total > 0) && !Number.isFinite(percent)) return null;
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? Math.round(percent) : Math.round((unlocked / total) * 100)));
  return total > 0 ? { unlocked: Math.min(unlocked, total), total, percent: p } : { percent: p };
};

/* ---------- Correspondances ---------- */

/** Fiche IGDB par titre identique (sur la bonne console), mémorisée dans external_games. */
async function matchByTitle(ctx, providerId, game) {
  const { db, config } = ctx;
  const row = db.prepare('SELECT igdb_id, checked_at FROM external_games WHERE provider = ? AND external_game_id = ?').get(providerId, String(game.id));
  if (row && (row.igdb_id || Date.parse(row.checked_at) > Date.now() - RECHECK_DAYS * 86400000)) return row.igdb_id;
  const title = String(game.name ?? '').replace(/[™®©]/g, '').trim(); // « Bloodborne™ » se cherche « Bloodborne »
  const igdbId = title ? await igdbIdFromExactTitle(config.env, title, findPlatform(game.platform)).catch(() => null) : null;
  db.prepare(`INSERT INTO external_games (provider, external_game_id, name, igdb_id, confidence, checked_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, external_game_id) DO UPDATE SET name = excluded.name, igdb_id = excluded.igdb_id, confidence = excluded.confidence, checked_at = excluded.checked_at
    WHERE external_games.confidence <> 'manual'`).run(providerId, String(game.id), game.name ?? null, igdbId, igdbId ? 'title' : 'none', now());
  return igdbId;
}

/** Fiche minimale d'un jeu qu'IGDB ne connaît pas sous ce titre (à associer plus tard à la main). */
const platformOnlyMeta = (game) => ({
  name: game.name || 'Jeu sans titre',
  releaseDate: null,
  summary: null,
  genres: [],
  developers: [],
  igdbId: null,
  images: { grid: game.image, gridThumb: game.image, cover: game.image, hero: null, heroThumb: null, logo: null, screenshots: [] },
});

/* ---------- Bibliothèque, import, synchronisation ---------- */

const linksOf = (db, account) => new Set(db.prepare('SELECT external_game_id FROM collection_links WHERE connected_account_id = ?').all(account.id).map((r) => r.external_game_id));

function link(db, account, collectionId, externalId) {
  db.prepare('INSERT OR IGNORE INTO collection_links (user_id, collection_id, connected_account_id, external_game_id) VALUES (?, ?, ?, ?)')
    .run(account.user_id, collectionId, account.id, String(externalId));
}

async function fetchAndStore(ctx, provider, account) {
  const games = (await provider.fetchLibrary(ctx, account)).filter((g) => g.id && findPlatform(g.platform));
  storeLibrary(ctx.db, account, games);
  return games;
}

async function library(ctx, provider, account) {
  const games = await fetchAndStore(ctx, provider, account);
  const linked = linksOf(ctx.db, account);
  return games
    .filter((g) => !linked.has(String(g.id)))
    .sort((a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0) || String(b.lastPlayedAt ?? '').localeCompare(String(a.lastPlayedAt ?? '')))
    .map((g) => ({ id: String(g.id), name: g.name, platform: g.platform, playtimeMinutes: g.playtimeMinutes ?? 0, icon: g.image ?? null, achievements: g.achievements ?? null }));
}

/** Données de la plateforme reportées sur un jeu de la collection, sauf saisie à la main ou autre source. */
function applyPlatformData(db, providerId, entry, g) {
  const set = {};
  const mine = (source) => !source || source === providerId;
  if (g.playtimeMinutes != null && mine(entry.playtime_source)) {
    set.playtime_minutes = g.playtimeMinutes;
    set.playtime_source = providerId;
  }
  if (g.lastPlayedAt && (!entry.last_played_at || day(g.lastPlayedAt) > entry.last_played_at)) set.last_played_at = day(g.lastPlayedAt);
  const current = parseJson(entry.achievements);
  if (g.achievements && mine(current?.source)) set.achievements = JSON.stringify({ ...g.achievements, source: providerId });
  const cols = Object.keys(set);
  if (!cols.length) return { playtime: false, achievements: false };
  db.prepare(`UPDATE collection SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE user_id = ? AND id = ?`)
    .run(...cols.map((c) => set[c]), now(), entry.user_id, entry.id);
  return { playtime: 'playtime_minutes' in set, achievements: 'achievements' in set };
}

async function importGames(ctx, provider, account, ids, job) {
  const { db, config } = ctx;
  const wanted = new Set(ids.map(String));
  // Seulement des jeux que la plateforme a renvoyés pour CE compte
  const games = db.prepare('SELECT * FROM platform_games WHERE connected_account_id = ?').all(account.id)
    .filter((r) => wanted.has(r.external_game_id)).map(rowToGame);
  const linked = linksOf(db, account);
  const stats = { added: 0, linked: 0, unmatched: 0, skipped: 0, failed: 0 };
  let done = 0;
  job.progress(0, games.length);

  await mapLimit(games, 2, async (g) => {
    try {
      if (linked.has(String(g.id))) { stats.skipped++; return; }
      const platform = findPlatform(g.platform).id;
      const igdbId = await matchByTitle(ctx, provider.id, g);
      const existing = igdbId
        ? db.prepare('SELECT * FROM collection WHERE user_id = ? AND igdb_id = ? AND platform = ?').get(account.user_id, igdbId, platform)
        : db.prepare("SELECT * FROM collection WHERE user_id = ? AND igdb_id IS NULL AND platform = ? AND json_extract(meta, '$.name') = ?").get(account.user_id, platform, g.name);
      if (existing) {
        // Déjà dans la collection (ajouté à la main ou depuis une autre plateforme) : relié, pas de doublon
        link(db, account, existing.id, g.id);
        applyPlatformData(db, provider.id, existing, g);
        stats.linked++;
        return;
      }
      const personal = {
        status: g.playtimeMinutes > 0 ? 'playing' : 'backlog', // seulement à la création ; ensuite c'est l'utilisateur qui décide
        steamAppId: null,
        playtimeMinutes: g.playtimeMinutes ?? null,
        playtimeSource: g.playtimeMinutes != null ? provider.id : null,
        achievements: g.achievements ? { ...g.achievements, source: provider.id } : null,
        startedAt: day(g.firstPlayedAt), // date donnée par la plateforme, sinon inconnue
        lastPlayedAt: day(g.lastPlayedAt),
      };
      const game = igdbId
        ? await addGame(db, config.env, account.user_id, { igdbId, platform, status: personal.status }, personal)
        : addUnmatchedGame(db, account.user_id, { platform, meta: platformOnlyMeta(g), ...personal });
      link(db, account, game.id, g.id);
      if (igdbId) stats.added++; else stats.unmatched++;
    } catch (err) {
      // Deux jeux de la plateforme qui mènent au même jeu IGDB, importés en même temps : on relie le second
      const igdbId = /UNIQUE/.test(err.message) || err.status === 409 ? db.prepare('SELECT igdb_id FROM external_games WHERE provider = ? AND external_game_id = ?').get(provider.id, String(g.id))?.igdb_id : null;
      const twin = igdbId && db.prepare('SELECT * FROM collection WHERE user_id = ? AND igdb_id = ? AND platform = ?').get(account.user_id, igdbId, findPlatform(g.platform).id);
      if (twin) { link(db, account, twin.id, g.id); stats.linked++; return; }
      ctx.log?.(`import ${provider.id} ${g.id} : ${err.message}`);
      stats.failed++;
    } finally {
      job.progress(++done);
    }
  });
  setAccount(db, account.id, { games_count: Math.max(account.games_count ?? 0, db.prepare('SELECT COUNT(*) n FROM platform_games WHERE connected_account_id = ?').get(account.id).n) });
  return stats;
}

async function sync(ctx, provider, account, job) {
  const { db } = ctx;
  setAccount(db, account.id, { status: ACCOUNT_STATUS.SYNCING, status_message: null });
  try {
    const games = await fetchAndStore(ctx, provider, account);
    const byId = new Map(games.map((g) => [String(g.id), g]));
    const entries = db.prepare(`SELECT c.*, l.external_game_id FROM collection_links l
      JOIN collection c ON c.user_id = l.user_id AND c.id = l.collection_id WHERE l.connected_account_id = ?`).all(account.id)
      .filter((e) => byId.has(e.external_game_id));
    job?.progress(0, entries.length);
    let playtime = 0;
    let achievements = 0;
    transaction(db, () => {
      entries.forEach((e, i) => {
        const r = applyPlatformData(db, provider.id, e, byId.get(e.external_game_id));
        playtime += r.playtime;
        achievements += r.achievements;
        job?.progress(i + 1);
      });
    });
    setAccount(db, account.id, { status: ACCOUNT_STATUS.SYNCED, status_message: null, last_sync_at: now(), games_count: games.length });
    return { owned: games.length, linked: entries.length, playtimeUpdated: playtime, achievementsUpdated: achievements };
  } catch (err) {
    if (err.code !== 'reauth') setAccount(db, account.id, { status: ACCOUNT_STATUS.ERROR, status_message: err.message });
    throw err;
  }
}

/** Vérifie que la bibliothèque est lisible et passe le compte en « connected ». */
async function enable(ctx, provider, account) {
  const { db } = ctx;
  if (!account.verified) {
    const msg = provider.unverifiedMessage ?? 'Discord n\'a pas vérifié ce compte : impossible de prouver qu\'il est à toi.';
    setAccount(db, account.id, { status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, status_message: msg });
    throw new ProviderError(msg, { status: 403 });
  }
  try {
    const games = await fetchAndStore(ctx, provider, account);
    setAccount(db, account.id, { status: ACCOUNT_STATUS.CONNECTED, status_message: null, games_count: games.length });
  } catch (err) {
    if (err.code !== 'reauth') setAccount(db, account.id, { status: ACCOUNT_STATUS.ERROR, status_message: err.message });
    throw err;
  }
}

/**
 * Connecteur à bibliothèque : `def` = defineProvider() + fetchLibrary(ctx, account),
 * et éventuellement `link` (liaison par copier-coller) et `revoke` (à la déconnexion).
 */
export function libraryProvider(def) {
  const p = defineProvider({ ...def, capabilities: { identify: true, library: true, playtime: true, sync: true, ...def.capabilities } });
  p.enable = (ctx, account) => enable(ctx, p, account);
  p.library = (ctx, account) => library(ctx, p, account);
  p.importGames = (ctx, account, ids, job) => importGames(ctx, p, account, ids, job);
  p.sync = (ctx, account, job) => sync(ctx, p, account, job);
  return p;
}
