// Compte Steam : temps de jeu et succès des jeux PC de la collection, et bibliothèque à importer.
// Il faut une clé (STEAM_API_KEY, steamcommunity.com/dev/apikey) et un profil Steam dont les
// « détails des jeux » sont publics.

import { HttpError } from './store.js';

const API = 'https://api.steampowered.com';
const ACHIEVEMENTS_PER_CALL = 30; // le Worker gratuit est limité à 50 requêtes sortantes par appel

function requireKey(env) {
  if (!env.STEAM_API_KEY) throw new HttpError(501, 'Clé Steam manquante : ajoute le secret STEAM_API_KEY au mini-serveur.');
}

async function steam(env, path, params) {
  const query = new URLSearchParams({ key: env.STEAM_API_KEY, format: 'json', ...params });
  const res = await fetch(`${API}${path}?${query}`);
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Steam refuse l\'accès : vérifie la clé et que ton profil est public.');
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** Accepte un SteamID64, une URL de profil (…/profiles/123… ou …/id/pseudo) ou un pseudo personnalisé. */
export async function resolveSteamId(env, input) {
  requireKey(env);
  const value = String(input ?? '').trim();
  const direct = value.match(/(?:profiles\/)?(\d{17})/);
  if (direct) return direct[1];
  const vanity = value.match(/id\/([^/?#]+)/)?.[1] ?? value;
  if (!/^[\w-]{2,32}$/.test(vanity)) throw new HttpError(400, 'Profil Steam invalide.');
  const data = await steam(env, '/ISteamUser/ResolveVanityURL/v1/', { vanityurl: vanity });
  if (data?.response?.success !== 1) throw new HttpError(404, 'Profil Steam introuvable.');
  return data.response.steamid;
}

async function ownedGames(env, steamId) {
  const data = await steam(env, '/IPlayerService/GetOwnedGames/v1/', {
    steamid: steamId, include_appinfo: '1', include_played_free_games: '1',
  });
  const games = data?.response?.games;
  if (!games) throw new HttpError(502, 'Steam ne renvoie pas tes jeux : rends publics les « détails des jeux » de ton profil.');
  return games;
}

async function achievements(env, steamId, appId) {
  const data = await steam(env, '/ISteamUserStats/GetPlayerAchievements/v1/', { steamid: steamId, appid: String(appId) });
  const list = data?.playerstats?.achievements;
  if (!Array.isArray(list) || !list.length) return null; // jeu sans succès
  const unlocked = list.filter((a) => a.achieved).length;
  return { unlocked, total: list.length, percent: Math.round((unlocked / list.length) * 100), source: 'steam' };
}

/**
 * Met à jour temps de jeu et succès des jeux de la collection présents sur Steam.
 * Par paquets (`offset`) : le site rappelle tant que `next` n'est pas null.
 */
export async function syncSteam(env, state, offset = 0) {
  requireKey(env);
  const steamId = state.settings?.steamId;
  if (!steamId) throw new HttpError(400, 'Connecte d\'abord ton profil Steam.');

  const owned = new Map((await ownedGames(env, steamId)).map((g) => [g.appid, g]));
  // Seulement les jeux rangés dans PC : un jeu Switch qui existe aussi sur Steam garde ses propres chiffres
  const steamGames = state.games.filter((g) => g.platform === 'PC' && g.steamAppId && owned.has(g.steamAppId));

  let updated = 0;
  // Le temps de jeu arrive en une seule requête : on le met à jour pour tous
  for (const game of steamGames) {
    const s = owned.get(game.steamAppId);
    if (game.playtimeSource === 'manual' && !s.playtime_forever) continue;
    game.playtimeMinutes = s.playtime_forever ?? 0;
    game.playtimeSource = 'steam';
    if (s.rtime_last_played) game.lastPlayedAt = new Date(s.rtime_last_played * 1000).toISOString().slice(0, 10);
    updated++;
  }
  // Les succès demandent une requête par jeu
  const batch = steamGames.slice(offset, offset + ACHIEVEMENTS_PER_CALL);
  for (const game of batch) {
    const a = await achievements(env, steamId, game.steamAppId);
    if (a && game.achievements?.source !== 'manual') game.achievements = a;
  }
  const next = offset + batch.length < steamGames.length ? offset + batch.length : null;
  if (next === null) state.settings.steamSyncedAt = new Date().toISOString();
  return { updated, steamGames: steamGames.length, next };
}

/** Jeux de la bibliothèque Steam pas encore dans la collection, les plus joués d'abord. */
export async function steamLibrary(env, state) {
  requireKey(env);
  const steamId = state.settings?.steamId;
  if (!steamId) throw new HttpError(400, 'Connecte d\'abord ton profil Steam.');
  const known = new Set(state.games.filter((g) => g.platform === 'PC').map((g) => g.steamAppId).filter(Boolean));
  return (await ownedGames(env, steamId))
    .filter((g) => !known.has(g.appid))
    .sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0))
    .map((g) => ({
      appId: g.appid,
      name: g.name,
      playtimeMinutes: g.playtime_forever ?? 0,
      icon: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : null,
      cover: `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg`,
    }));
}
