// Xbox — connecteur NON OFFICIEL, via le service tiers OpenXBL (https://xbl.io).
//
// Microsoft réserve les services Xbox (succès, temps de jeu) à ses partenaires. OpenXBL relaie l'API Xbox Live
// avec la clé du propriétaire du serveur (OPENXBL_API_KEY, jamais un identifiant des joueurs) ; Asobi n'y lit
// que ce qu'un joueur a rendu PUBLIC : historique des jeux, succès (progression) et minutes jouées.
//   - le compte Xbox doit avoir été vérifié par Discord (preuve qu'il appartient bien au joueur) ;
//   - l'offre gratuite d'OpenXBL limite le nombre de requêtes par heure : une synchro en fait 1 + 1 par lot de 25 jeux.
// Docs : https://xbl.io/console (OpenAPI)

import { ACCOUNT_STATUS } from '../core/provider.js';
import { ProviderError, withRetry } from '../core/sync.js';
import { libraryProvider, accountData, saveAccountData, achievementsOf } from '../core/library.js';

const API = 'https://xbl.io/api/v2';
const PRIVATE = 'Xbox ne montre pas tes jeux : sur xbox.com, Confidentialité → « Les autres peuvent voir ton historique de jeu et tes succès » → Tout le monde.';

async function xbl(config, path, { method = 'GET', body } = {}) {
  const key = config.env.OPENXBL_API_KEY;
  if (!key) throw new ProviderError('Xbox n\'est pas configuré sur ce serveur.', { status: 501 });
  return withRetry(async () => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'X-Authorization': key, Accept: 'application/json', 'Accept-Language': 'fr-FR', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) throw new ProviderError('OpenXBL limite les requêtes : réessaie dans une heure.', { status: 429, retryable: true });
    if (res.status >= 500) throw new ProviderError(`OpenXBL a répondu ${res.status}.`, { retryable: true });
    if (res.status === 401) throw new ProviderError('La clé OpenXBL du serveur est refusée.', { status: 503, code: 'server_token' });
    const data = await res.json().catch(() => null);
    // OpenXBL renvoie en général { content: { … }, code } ; certaines routes renvoient la réponse Xbox telle quelle
    return res.ok ? data?.content ?? data : { error: res.status };
  }, { retries: 2 });
}

/** XUID du joueur : retrouvé par son Gamertag (le nom donné par Discord), une seule fois. */
async function xuidOf(ctx, account) {
  const known = accountData(account).xuid;
  if (known) return known;
  let xuid = null;
  const gamertag = account.external_username;
  if (gamertag) {
    const data = await xbl(ctx.config, `/search/${encodeURIComponent(gamertag)}`);
    const people = data?.people ?? [];
    xuid = people.find((p) => String(p.gamertag ?? '').toLowerCase() === gamertag.toLowerCase())?.xuid ?? null;
  }
  if (!xuid && /^\d{15,17}$/.test(account.external_user_id)) xuid = account.external_user_id; // Discord donne en général le XUID
  if (!xuid) throw new ProviderError('Compte Xbox introuvable avec ce Gamertag.', { status: 404 });
  saveAccountData(ctx.db, account, { xuid: String(xuid) });
  return String(xuid);
}

/** Console d'Asobi d'après les appareils où le jeu existe (la plus récente). */
export function xboxPlatform(devices = []) {
  if (devices.includes('XboxSeries')) return 'Xbox Series X|S';
  if (devices.includes('XboxOne')) return 'Xbox One';
  if (devices.includes('Xbox360')) return 'Xbox 360';
  if (devices.includes('PC') || devices.includes('Win32')) return 'PC';
  return null;
}

/** Minutes jouées par titre (statistique « MinutesPlayed »), par lots de 25. */
async function minutesPlayed(config, xuid, titleIds) {
  const out = new Map();
  for (let i = 0; i < titleIds.length; i += 25) {
    const chunk = titleIds.slice(i, i + 25);
    const data = await xbl(config, '/player/stats', { method: 'POST', body: { xuids: [xuid], stats: chunk.map((titleId) => ({ name: 'MinutesPlayed', titleId })) } }).catch(() => null);
    const stats = data?.statlistscollection?.[0]?.stats ?? [];
    stats.forEach((s, j) => {
      const titleId = String(s.titleid ?? s.titleId ?? chunk[j]);
      const value = Number(s.value);
      if (s.name === 'MinutesPlayed' && Number.isFinite(value)) out.set(titleId, value);
    });
  }
  return out;
}

async function fetchLibrary(ctx, account) {
  const xuid = await xuidOf(ctx, account);
  const data = await xbl(ctx.config, `/player/titleHistory/${xuid}`);
  if (data?.error || !Array.isArray(data?.titles)) throw new ProviderError(PRIVATE, { status: 403, code: 'private_profile' });
  const titles = data.titles.filter((t) => (t.type ?? 'Game') === 'Game' && xboxPlatform(t.devices));
  const minutes = await minutesPlayed(ctx.config, xuid, titles.map((t) => String(t.titleId)));
  return titles.map((t) => {
    const a = t.achievement ?? {};
    return {
      id: String(t.titleId),
      name: t.name,
      platform: xboxPlatform(t.devices),
      image: t.displayImage ?? null,
      playtimeMinutes: minutes.get(String(t.titleId)) ?? null,
      firstPlayedAt: null,
      lastPlayedAt: t.titleHistory?.lastTimePlayed ?? null,
      achievements: achievementsOf(a.currentAchievements ?? 0, a.totalAchievements ?? 0, a.totalAchievements ? undefined : a.progressPercentage),
    };
  });
}

export const xbox = libraryProvider({
  id: 'xbox',
  name: 'Xbox',
  official: false,
  experimental: true,
  discordTypes: ['xbox'],
  capabilities: { achievements: true },
  limitations: 'Connecteur non officiel (service OpenXBL) : Asobi lit l\'historique de jeu public de ton Gamertag (minutes jouées, succès, dernière partie). Il peut s\'arrêter si Microsoft ou OpenXBL changent leurs règles.',
  unverifiedMessage: 'Discord n\'a pas vérifié ce compte Xbox : relie-le à nouveau dans Discord (Paramètres → Connexions).',
  manualImport: ['Xbox Series X|S', 'Xbox One'],
  enabled: (config) => Boolean(config.env.OPENXBL_API_KEY),
  onDetected: (c) => (c.verified
    ? { status: ACCOUNT_STATUS.DETECTED, message: 'Compte vérifié par Discord : tu peux activer l\'import (connecteur non officiel).' }
    : { status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, message: 'Discord n\'a pas vérifié ce compte Xbox.' }),
  fetchLibrary,
});
