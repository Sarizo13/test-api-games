// Steam : API Web officielle (clé STEAM_API_KEY, côté serveur uniquement) et Steam OpenID pour prouver
// la propriété d'un compte relié à la main.
//
// Ce que Steam permet vraiment : jeux possédés + temps de jeu (GetOwnedGames) et succès par jeu
// (GetPlayerAchievements), à condition que les « détails des jeux » du profil soient publics.
// Docs : https://partner.steamgames.com/doc/webapi · https://steamcommunity.com/dev
//
// Règles de synchronisation :
//   - seuls les jeux rangés dans « PC » sont reliés à Steam (un jeu Switch qui existe aussi sur Steam garde ses chiffres) ;
//   - un temps de jeu ou des succès saisis à la main ne sont jamais écrasés, le statut n'est jamais modifié ;
//   - un jeu absent d'une réponse n'est jamais retiré de la collection.

import { ACCOUNT_STATUS, defineProvider } from '../core/provider.js';
import { ProviderError, withRetry, mapLimit } from '../core/sync.js';
import { matchSteamGames } from '../core/normalize.js';
import { addGame, addUnmatchedGame } from '../../collection.js';
import { steamOnlyMeta } from '../../metadata.js';
import { now, transaction, parseJson } from '../../db.js';

const API = 'https://api.steampowered.com';
const OPENID = 'https://steamcommunity.com/openid/login';

/* ---------- API Web ---------- */

async function steamApi(config, path, params) {
  if (!config.steamKey) throw new ProviderError('Import Steam indisponible : le serveur n\'a pas de clé STEAM_API_KEY.', { status: 501 });
  return withRetry(async () => {
    const res = await fetch(`${API}${path}?${new URLSearchParams({ key: config.steamKey, format: 'json', ...params })}`);
    if (res.status === 429) throw new ProviderError('Steam limite les requêtes.', { status: 429, retryable: true });
    if (res.status >= 500) throw new ProviderError(`Steam a répondu ${res.status}.`, { retryable: true });
    if (res.status === 401 || res.status === 403) return { forbidden: true };
    if (!res.ok) return null;
    return res.json().catch(() => null);
  });
}

export async function resolveVanity(config, input) {
  const value = String(input ?? '').trim();
  const direct = value.match(/(?:profiles\/)?(\d{17})/);
  if (direct) return direct[1];
  const vanity = value.match(/id\/([^/?#]+)/)?.[1] ?? value;
  if (!/^[\w-]{2,32}$/.test(vanity)) throw new ProviderError('Profil Steam invalide.', { status: 400 });
  const data = await steamApi(config, '/ISteamUser/ResolveVanityURL/v1/', { vanityurl: vanity });
  if (data?.response?.success !== 1) throw new ProviderError('Profil Steam introuvable.', { status: 404 });
  return data.response.steamid;
}

export async function playerSummary(config, steamId) {
  const data = await steamApi(config, '/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamId });
  const p = data?.response?.players?.[0];
  return p ? { name: p.personaname, avatar: p.avatarmedium, public: p.communityvisibilitystate === 3 } : null;
}

/** Jeux possédés. Lève une erreur claire si le profil ou ses « détails des jeux » sont privés. */
export async function ownedGames(config, steamId) {
  const data = await steamApi(config, '/IPlayerService/GetOwnedGames/v1/', { steamid: steamId, include_appinfo: '1', include_played_free_games: '1' });
  const games = data?.response?.games;
  if (!Array.isArray(games)) {
    throw new ProviderError('Steam ne donne pas accès à tes jeux : dans Steam, Profil → Modifier → Confidentialité, mets « Détails des jeux » sur Public.', { status: 403, code: 'private_profile' });
  }
  return games;
}

async function playerAchievements(config, steamId, appId) {
  const data = await steamApi(config, '/ISteamUserStats/GetPlayerAchievements/v1/', { steamid: steamId, appid: String(appId) });
  const list = data?.playerstats?.achievements;
  if (!Array.isArray(list) || !list.length) return null; // jeu sans succès, ou succès privés
  const unlocked = list.filter((a) => a.achieved).length;
  return { unlocked, total: list.length, percent: Math.round((unlocked / list.length) * 100), source: 'steam' };
}

/* ---------- Steam OpenID (preuve de propriété) ---------- */

export const openIdReturnTo = (config) => `${config.publicUrl}/api/accounts/steam/openid/callback`;

export function openIdUrl(config, state) {
  const returnTo = `${openIdReturnTo(config)}?state=${encodeURIComponent(state)}`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': config.publicUrl,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${OPENID}?${params}`;
}

/** Vérifie la réponse OpenID auprès de Steam (check_authentication) et renvoie le SteamID64 prouvé. */
export async function verifyOpenId(config, query) {
  const fail = (why) => { throw new ProviderError(`Vérification Steam refusée (${why}).`, { status: 400 }); };
  if (query.get('openid.mode') !== 'id_res') fail('réponse annulée');
  if (query.get('openid.op_endpoint') !== OPENID) fail('fournisseur inattendu');
  if (!String(query.get('openid.return_to') ?? '').startsWith(openIdReturnTo(config))) fail('adresse de retour inattendue');
  const claimed = query.get('openid.claimed_id') ?? '';
  const steamId = claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/)?.[1];
  if (!steamId || query.get('openid.identity') !== claimed) fail('identifiant invalide');
  const signed = new Set(String(query.get('openid.signed') ?? '').split(','));
  for (const field of ['claimed_id', 'identity', 'return_to', 'op_endpoint', 'response_nonce']) if (!signed.has(field)) fail('signature incomplète');

  const params = new URLSearchParams();
  for (const [k, v] of query) if (k.startsWith('openid.')) params.set(k, v);
  params.set('openid.mode', 'check_authentication');
  const res = await fetch(OPENID, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const text = await res.text();
  if (!/is_valid\s*:\s*true/.test(text)) fail('signature invalide');
  return steamId;
}

/* ---------- Synchronisation et import ---------- */

const setAccount = (db, id, fields) => {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE connected_accounts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
};

/** Enregistre la réponse de Steam dans platform_games (sans jamais supprimer une ligne). */
function storeOwned(db, account, owned) {
  const t = now();
  const stmt = db.prepare(`INSERT INTO platform_games (connected_account_id, external_game_id, name, playtime_minutes, last_played_at, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connected_account_id, external_game_id) DO UPDATE SET name = excluded.name, playtime_minutes = excluded.playtime_minutes,
      last_played_at = COALESCE(excluded.last_played_at, platform_games.last_played_at), last_seen_at = excluded.last_seen_at`);
  transaction(db, () => {
    for (const g of owned) {
      const lastPlayed = g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString().slice(0, 10) : null;
      stmt.run(account.id, String(g.appid), g.name ?? null, g.playtime_forever ?? 0, lastPlayed, t, t);
    }
  });
}

/** Succès des jeux donnés (4 requêtes à la fois), reportés sur la collection sauf saisie manuelle. */
async function refreshAchievements(ctx, account, entries, job, offset = 0) {
  const { db, config } = ctx;
  let done = 0;
  let updated = 0;
  await mapLimit(entries, 4, async (entry) => {
    const a = await playerAchievements(config, account.external_user_id, entry.steam_app_id).catch(() => null);
    if (a) {
      db.prepare('UPDATE platform_games SET achievements_unlocked = ?, achievements_total = ? WHERE connected_account_id = ? AND external_game_id = ?')
        .run(a.unlocked, a.total, account.id, String(entry.steam_app_id));
      const current = parseJson(entry.achievements);
      if (!current?.source || current.source === 'steam') {
        db.prepare('UPDATE collection SET achievements = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(JSON.stringify(a), now(), entry.user_id, entry.id);
        updated++;
      }
    }
    job?.progress(offset + ++done);
  });
  return updated;
}

/** Temps de jeu (une requête) puis succès (une requête par jeu) des jeux PC de la collection reliés à Steam. */
async function sync(ctx, account, job) {
  const { db, config } = ctx;
  setAccount(db, account.id, { status: ACCOUNT_STATUS.SYNCING, status_message: null });
  try {
    const owned = await ownedGames(config, account.external_user_id);
    storeOwned(db, account, owned);
    const byApp = new Map(owned.map((g) => [g.appid, g]));
    const entries = db.prepare("SELECT * FROM collection WHERE user_id = ? AND platform = 'PC' AND steam_app_id IS NOT NULL")
      .all(account.user_id).filter((e) => byApp.has(e.steam_app_id));
    job?.progress(0, entries.length);

    let playtime = 0;
    transaction(db, () => {
      for (const e of entries) {
        const s = byApp.get(e.steam_app_id);
        if (e.playtime_source && e.playtime_source !== 'steam') continue; // saisi à la main ou venu d'Epic… : on n'y touche pas
        const lastPlayed = s.rtime_last_played ? new Date(s.rtime_last_played * 1000).toISOString().slice(0, 10) : e.last_played_at;
        db.prepare("UPDATE collection SET playtime_minutes = ?, playtime_source = 'steam', last_played_at = ?, updated_at = ? WHERE user_id = ? AND id = ?")
          .run(s.playtime_forever ?? 0, lastPlayed, now(), e.user_id, e.id);
        playtime++;
      }
    });
    const achievements = await refreshAchievements(ctx, account, entries, job);
    setAccount(db, account.id, { status: ACCOUNT_STATUS.SYNCED, status_message: null, last_sync_at: now(), games_count: owned.length });
    return { owned: owned.length, linked: entries.length, playtimeUpdated: playtime, achievementsUpdated: achievements };
  } catch (err) {
    setAccount(db, account.id, { status: ACCOUNT_STATUS.ERROR, status_message: err.message });
    throw err;
  }
}

/** Jeux de la bibliothèque Steam pas encore dans la collection, les plus joués d'abord. */
async function library(ctx, account) {
  const { db, config } = ctx;
  const owned = await ownedGames(config, account.external_user_id);
  storeOwned(db, account, owned);
  const known = new Set(db.prepare('SELECT steam_app_id FROM collection WHERE user_id = ? AND steam_app_id IS NOT NULL').all(account.user_id).map((r) => r.steam_app_id));
  return owned
    .filter((g) => !known.has(g.appid))
    .sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0))
    .map((g) => ({
      id: String(g.appid),
      name: g.name,
      playtimeMinutes: g.playtime_forever ?? 0,
      icon: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : null,
    }));
}

/** Ajoute les jeux choisis (seulement s'ils appartiennent bien à ce compte Steam). */
async function importGames(ctx, account, ids, job) {
  const { db, config } = ctx;
  const wanted = new Set(ids.map(String));
  const owned = db.prepare('SELECT external_game_id, name, playtime_minutes, last_played_at FROM platform_games WHERE connected_account_id = ?')
    .all(account.id).filter((g) => wanted.has(g.external_game_id));
  job.progress(0, owned.length);
  const matches = await matchSteamGames(ctx, owned.map((g) => ({ appid: Number(g.external_game_id), name: g.name })), { byTitle: true });

  const stats = { added: 0, linked: 0, unmatched: 0, skipped: 0, failed: 0 };
  const created = [];
  let done = 0;
  await mapLimit(owned, 2, async (g) => {
    const appId = Number(g.external_game_id);
    try {
      if (db.prepare('SELECT 1 FROM collection WHERE user_id = ? AND steam_app_id = ?').get(account.user_id, appId)) { stats.skipped++; return; }
      const personal = {
        status: g.playtime_minutes > 0 ? 'playing' : 'backlog', // seulement à la création ; ensuite c'est l'utilisateur qui décide
        steamAppId: appId,
        playtimeMinutes: g.playtime_minutes ?? 0,
        playtimeSource: 'steam',
        lastPlayedAt: g.last_played_at,
        startedAt: null,
      };
      const { igdbId } = matches.get(appId) ?? {};
      if (igdbId) {
        const existing = db.prepare("SELECT id, steam_app_id FROM collection WHERE user_id = ? AND igdb_id = ? AND platform = 'PC'").get(account.user_id, igdbId);
        if (existing) {
          // Déjà dans la collection sur PC (ajouté à la main) : on le relie à Steam au lieu de créer un doublon
          if (!existing.steam_app_id) db.prepare('UPDATE collection SET steam_app_id = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(appId, now(), account.user_id, existing.id);
          stats.linked++;
          created.push(existing.id);
          return;
        }
        const game = await addGame(db, config.env, account.user_id, { igdbId, platform: 'PC', status: personal.status }, personal);
        created.push(game.id);
        stats.added++;
      } else {
        const game = addUnmatchedGame(db, account.user_id, { platform: 'PC', meta: steamOnlyMeta(appId, g.name), ...personal });
        created.push(game.id);
        stats.unmatched++;
      }
    } catch (err) {
      const twin = (/UNIQUE/.test(err.message) || err.status === 409) && matches.get(appId)?.igdbId
        && db.prepare("SELECT id FROM collection WHERE user_id = ? AND igdb_id = ? AND platform = 'PC'").get(account.user_id, matches.get(appId).igdbId);
      if (twin) { stats.linked++; created.push(twin.id); return; } // même jeu IGDB qu'une autre appli Steam de l'import
      ctx.log?.(`import Steam ${appId} : ${err.message}`);
      stats.failed++;
    } finally {
      job.progress(++done);
    }
  });

  // Succès des jeux ajoutés, dans la foulée
  const entries = db.prepare(`SELECT * FROM collection WHERE user_id = ? AND id IN (${created.map(() => '?').join(',') || "''"})`).all(account.user_id, ...created);
  job.progress(0, entries.length);
  stats.achievementsUpdated = await refreshAchievements(ctx, account, entries, job);
  setAccount(db, account.id, { games_count: Math.max(account.games_count ?? 0, owned.length) });
  return stats;
}

/** Vérifie que l'import est possible (clé présente, compte prouvé, détails des jeux publics). */
async function enable(ctx, account) {
  const { db, config } = ctx;
  if (!account.verified) {
    setAccount(db, account.id, { status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, status_message: 'Confirme que ce compte Steam est à toi avec « Vérifier avec Steam ».' });
    throw new ProviderError('Ce compte Steam doit d\'abord être vérifié.', { status: 403 });
  }
  try {
    const owned = await ownedGames(config, account.external_user_id);
    storeOwned(db, account, owned);
    const summary = await playerSummary(config, account.external_user_id).catch(() => null);
    setAccount(db, account.id, {
      status: ACCOUNT_STATUS.CONNECTED, status_message: null, games_count: owned.length,
      external_username: summary?.name ?? account.external_username,
    });
  } catch (err) {
    setAccount(db, account.id, { status: ACCOUNT_STATUS.ERROR, status_message: err.message });
    throw err;
  }
}

export const steam = defineProvider({
  id: 'steam',
  name: 'Steam',
  official: true,
  discordTypes: ['steam'],
  capabilities: { identify: true, library: true, playtime: true, achievements: true, sync: true },
  limitations: 'Les « détails des jeux » du profil Steam doivent être publics. Seuls les jeux rangés dans PC sont synchronisés.',
  enabled: (config) => Boolean(config.steamKey),
  onDetected: (connection) => (connection.verified
    ? { status: ACCOUNT_STATUS.DETECTED, message: 'Compte vérifié par Discord : tu peux importer ta bibliothèque.' }
    : { status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, message: 'Discord ne garantit pas que ce compte est à toi : confirme-le avec Steam.' }),
  enable,
  sync,
  library,
  importGames,
});
