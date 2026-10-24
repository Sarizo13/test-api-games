// Normalisation : relier un jeu d'une plateforme (appid Steam…) au jeu canonique IGDB.
// Règle : jamais de fusion sur une simple ressemblance de titre. Fiabilités acceptées :
//   exact  — lien officiel donné par IGDB (external_games)
//   title  — titre strictement identique une fois normalisé (« Portal 2 » = « portal 2 »)
//   manual — choisi par l'utilisateur
// Sinon « none » : le jeu est gardé avec sa fiche minimale et proposé à l'association manuelle.

import { igdbIdsFromSteam, igdbIdFromExactTitle } from '../../metadata.js';
import { now } from '../../db.js';
import { findPlatform } from '../../../../assets/platforms.js';

const RECHECK_DAYS = 30; // une absence de correspondance est revérifiée au bout d'un mois

function save(db, provider, id, name, igdbId, confidence) {
  db.prepare(`INSERT INTO external_games (provider, external_game_id, name, igdb_id, confidence, checked_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, external_game_id) DO UPDATE SET name = excluded.name, igdb_id = excluded.igdb_id,
      confidence = excluded.confidence, checked_at = excluded.checked_at
    WHERE external_games.confidence <> 'manual'`).run(provider, String(id), name ?? null, igdbId, confidence, now());
}

/**
 * Correspondances IGDB pour des jeux Steam [{ appid, name }].
 * `byTitle` : tenter aussi le titre exact (une requête par jeu : seulement pour les jeux qu'on importe).
 * Renvoie une Map appid → { igdbId, confidence }.
 */
export async function matchSteamGames(ctx, games, { byTitle = false } = {}) {
  const { db, config } = ctx;
  const result = new Map();
  const stale = Date.now() - RECHECK_DAYS * 86400000;
  const todo = [];
  for (const g of games) {
    const row = db.prepare("SELECT igdb_id, confidence, checked_at FROM external_games WHERE provider = 'steam' AND external_game_id = ?").get(String(g.appid));
    if (row && (row.igdb_id || Date.parse(row.checked_at) > stale)) result.set(g.appid, { igdbId: row.igdb_id, confidence: row.confidence });
    else todo.push(g);
  }
  if (!todo.length) return result;

  const exact = await igdbIdsFromSteam(config.env, todo.map((g) => g.appid));
  for (const g of todo) {
    let igdbId = exact.get(g.appid) ?? null;
    let confidence = igdbId ? 'exact' : 'none';
    if (!igdbId && byTitle && g.name) {
      igdbId = await igdbIdFromExactTitle(config.env, g.name, findPlatform('PC')).catch(() => null);
      if (igdbId) confidence = 'title';
    }
    save(db, 'steam', g.appid, g.name, igdbId, confidence);
    result.set(g.appid, { igdbId, confidence });
  }
  return result;
}
