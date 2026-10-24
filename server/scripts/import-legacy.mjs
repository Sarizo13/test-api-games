// Reprise de l'ancienne collection (Cloudflare KV, format { games, wishlist, playlist, settings })
// dans le compte d'un utilisateur Asobi existant (il doit s'être connecté une fois avec Discord).
//
//   node scripts/import-legacy.mjs <identifiant> <fichier.json> [--dry-run]
//
// Les fiches de jeux sont gardées telles quelles (pas de nouvel appel à IGDB) ; les jeux déjà présents
// (même identifiant) sont ignorés : on peut relancer le script sans créer de doublons.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb, now, transaction, parseJson } from '../src/db.js';
import { findPlatform } from '../../assets/platforms.js';

const [username, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');
if (!username || !file) {
  console.error('Usage : node scripts/import-legacy.mjs <identifiant> <fichier.json> [--dry-run]');
  process.exit(1);
}

const config = loadConfig();
const db = openDb(join(config.dataDir, 'asobi.sqlite'));
const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
if (!user) {
  console.error(`Aucun utilisateur « ${username} » : connecte-toi d'abord une fois avec Discord.`);
  process.exit(1);
}

const legacy = JSON.parse(readFileSync(file, 'utf8'));
const PERSONAL = ['id', 'platform', 'addedAt', 'status', 'favorite', 'ratings', 'review', 'playtimeMinutes', 'playtimeSource',
  'achievements', 'startedAt', 'finishedAt', 'lastPlayedAt', 'rating'];
const stats = { games: 0, skipped: 0, unmatched: 0, wishlist: 0 };

try {
transaction(db, () => {
  for (const g of legacy.games ?? []) {
    const platform = findPlatform(g.platform);
    if (!platform || !g.id) { stats.skipped++; continue; }
    if (db.prepare('SELECT 1 FROM collection WHERE user_id = ? AND id = ?').get(user.id, g.id)) { stats.skipped++; continue; }
    const meta = Object.fromEntries(Object.entries(g).filter(([k]) => !PERSONAL.includes(k)));
    if (g.rating != null && meta.igdbRating == null) meta.igdbRating = g.rating; // ancien nom du champ
    const igdbId = Number(g.igdbId) || null;
    if (igdbId) {
      db.prepare('INSERT INTO games (igdb_id, meta, updated_at) VALUES (?, ?, ?) ON CONFLICT(igdb_id) DO NOTHING').run(igdbId, JSON.stringify(meta), now());
      const clash = db.prepare('SELECT id FROM collection WHERE user_id = ? AND igdb_id = ? AND platform = ?').get(user.id, igdbId, platform.id);
      if (clash) { stats.skipped++; continue; }
    } else stats.unmatched++;
    const steamAppId = platform.id === 'PC' && g.steamAppId ? Number(g.steamAppId) : null;
    const steamClash = steamAppId && db.prepare('SELECT 1 FROM collection WHERE user_id = ? AND steam_app_id = ?').get(user.id, steamAppId);
    db.prepare(`INSERT INTO collection (user_id, id, igdb_id, platform, steam_app_id, meta, match_status, status, favorite, ratings, review,
        playtime_minutes, playtime_source, achievements, started_at, finished_at, last_played_at, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      user.id, g.id, igdbId, platform.id, steamClash ? null : steamAppId, igdbId ? null : JSON.stringify(meta), igdbId ? 'matched' : 'unmatched',
      ['backlog', 'playing', 'finished', 'completed', 'dropped'].includes(g.status) ? g.status : 'backlog',
      g.favorite ? 1 : 0, JSON.stringify(g.ratings ?? {}), String(g.review ?? ''), g.playtimeMinutes ?? null, g.playtimeSource ?? null,
      g.achievements ? JSON.stringify(g.achievements) : null, g.startedAt ?? null, g.finishedAt ?? null, g.lastPlayedAt ?? null,
      g.addedAt ?? now(), now(),
    );
    stats.games++;
  }

  for (const w of legacy.wishlist ?? []) {
    if (!w.igdbId) continue;
    const { addedAt, ...item } = w;
    const { changes } = db.prepare('INSERT INTO wishlist (user_id, igdb_id, item, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(user.id, Number(w.igdbId), JSON.stringify(item), addedAt ?? now());
    stats.wishlist += changes;
  }

  const owned = new Set(db.prepare('SELECT id FROM collection WHERE user_id = ?').all(user.id).map((r) => r.id));
  const playlist = [...new Set([...parseJson(user.playlist, []), ...(legacy.playlist ?? [])])].filter((id) => owned.has(id));
  const settings = { ...parseJson(user.settings, {}) };
  if (legacy.settings?.name && !settings.name) settings.name = legacy.settings.name;
  if (legacy.settings?.consoleTrailers) settings.consoleTrailers = { ...legacy.settings.consoleTrailers, ...(settings.consoleTrailers ?? {}) };
  db.prepare('UPDATE users SET playlist = ?, settings = ? WHERE id = ?').run(JSON.stringify(playlist), JSON.stringify(settings), user.id);

  if (dryRun) throw Object.assign(new Error('dry-run'), { dryRun: true }); // annule tout
});
} catch (err) {
  if (!err.dryRun) throw err;
}

console.log(`${dryRun ? '[essai, rien enregistré] ' : ''}${stats.games} jeux repris, ${stats.skipped} ignorés (déjà là), ${stats.unmatched} sans IGDB, ${stats.wishlist} envies.`);
