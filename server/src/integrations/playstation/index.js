// PlayStation Network — connecteur NON OFFICIEL (même méthode que les bibliothèques psn-api et PSNAWP).
//
// Sony n'ouvre pas d'API aux sites tiers. Asobi parle à l'API de l'application PlayStation avec le compte du
// propriétaire du serveur (jeton de session « NPSSO » dans PSN_NPSSO, jamais celui des joueurs) et n'y lit que
// ce qu'un joueur a rendu PUBLIC : jeux joués (temps de jeu, première et dernière partie) et trophées.
//   - le compte PSN doit avoir été vérifié par Discord (preuve qu'il appartient bien au joueur) ;
//   - Sony peut changer ou couper cette API sans prévenir : le connecteur passe alors en erreur, rien n'est perdu ;
//   - un NPSSO dure environ deux mois : il faut ensuite en remettre un dans .env.
// Jeton NPSSO : se connecter sur playstation.com, puis ouvrir https://ca.account.sony.com/api/v1/ssocookie.

import { ACCOUNT_STATUS } from '../core/provider.js';
import { ProviderError, withRetry } from '../core/sync.js';
import { libraryProvider, accountData, saveAccountData, achievementsOf } from '../core/library.js';
import { matchKey } from '../../../../scripts/lib/igdb.mjs';

const AUTH = 'https://ca.account.sony.com/api/authz/v3/oauth';
const GAMES = 'https://m.np.playstation.com/api/gamelist/v2/users';
const TROPHIES = 'https://m.np.playstation.com/api/trophy/v1/users';
const PROFILE = 'https://us-prof.np.community.playstation.net/userProfile/v1/users';
// Identifiants publics de l'application PlayStation (ceux qu'utilisent psn-api et PSNAWP)
const APP = {
  clientId: '09515159-7237-4370-9b40-3806e67c0891',
  basic: 'MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=',
  redirectUri: 'com.scee.psxandroid.scecompcall://redirect',
  scope: 'psn:mobile.v2.core psn:clientapp',
};
const PRIVATE = 'PlayStation ne montre pas tes jeux : dans Paramètres → Utilisateurs et comptes → Confidentialité, mets « Jeux » et « Trophées » visibles par « Tout le monde ».';

/* ---------- Jeton du serveur (en mémoire seulement) ---------- */

let session = null; // { npsso, accessToken, refreshToken, expiresAt, refreshExpiresAt }
let pending = null;

export const resetSession = () => { session = null; pending = null; };

async function tokenRequest(form) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${APP.basic}` },
    body: new URLSearchParams(form),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) throw new ProviderError('PlayStation a refusé le jeton du serveur.', { status: 502 });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    refreshExpiresAt: Date.now() + (data.refresh_token_expires_in ?? 0) * 1000,
  };
}

async function openSession(npsso) {
  // NPSSO → code d'autorisation (redirection vers l'application, qu'on ne suit pas) → jetons
  const res = await fetch(`${AUTH}/authorize?${new URLSearchParams({ access_type: 'offline', client_id: APP.clientId, redirect_uri: APP.redirectUri, response_type: 'code', scope: APP.scope })}`,
    { headers: { Cookie: `npsso=${npsso}` }, redirect: 'manual' });
  const code = String(res.headers.get('location') ?? '').match(/[?&]code=([^&]+)/)?.[1];
  if (!code) throw new ProviderError('Le jeton PlayStation du serveur (PSN_NPSSO) a expiré : il faut en remettre un.', { status: 503, code: 'server_token' });
  return { npsso, ...(await tokenRequest({ code: decodeURIComponent(code), redirect_uri: APP.redirectUri, grant_type: 'authorization_code', token_format: 'jwt' })) };
}

async function ownerToken(config, { fresh = false } = {}) {
  const npsso = config.env.PSN_NPSSO;
  if (!npsso) throw new ProviderError('PlayStation n\'est pas configuré sur ce serveur.', { status: 501 });
  if (fresh || session?.npsso !== npsso) session = null;
  if (session && session.expiresAt - Date.now() > 60_000) return session.accessToken;
  pending ??= (async () => {
    try {
      if (session?.refreshToken && session.refreshExpiresAt > Date.now()) {
        try {
          session = { npsso, ...(await tokenRequest({ refresh_token: session.refreshToken, grant_type: 'refresh_token', token_format: 'jwt', scope: APP.scope })) };
          return session.accessToken;
        } catch { /* on repart du NPSSO */ }
      }
      session = await openSession(npsso);
      return session.accessToken;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** GET authentifié ; renvoie { error } pour un refus (profil privé, introuvable) plutôt que de lever. */
async function psnGet(config, url) {
  let renewed = false;
  return withRetry(async () => {
    const token = await ownerToken(config, { fresh: renewed });
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'fr-FR' } });
    if (res.status === 401 && !renewed) { renewed = true; throw new ProviderError('Jeton PlayStation à renouveler.', { retryable: true }); }
    if (res.status === 429) throw new ProviderError('PlayStation limite les requêtes.', { status: 429, retryable: true });
    if (res.status >= 500) throw new ProviderError(`PlayStation a répondu ${res.status}.`, { retryable: true });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) return { error: data?.error ?? { code: res.status } };
    return data;
  });
}

/* ---------- Joueur ---------- */

/** accountId PSN du joueur : depuis son ID en ligne (le nom donné par Discord), retrouvé une seule fois. */
async function accountId(ctx, account) {
  const known = accountData(account).accountId;
  if (known) return known;
  const onlineId = account.external_username;
  let id = null;
  if (onlineId && /^[\w-]{3,16}$/.test(onlineId)) {
    const data = await psnGet(ctx.config, `${PROFILE}/${encodeURIComponent(onlineId)}/profile2?fields=accountId,onlineId`);
    id = data?.profile?.accountId ?? null;
  }
  if (!id && /^\d{15,20}$/.test(account.external_user_id)) id = account.external_user_id; // Discord donne parfois directement l'accountId
  if (!id) throw new ProviderError('Compte PlayStation introuvable avec cet ID en ligne.', { status: 404 });
  saveAccountData(ctx.db, account, { accountId: String(id) });
  return String(id);
}

/** « PT228H56M33S » → minutes. */
export function durationMinutes(iso) {
  const m = String(iso ?? '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Math.round(Number(m[4] ?? 0) / 60);
}

async function playedGames(config, id) {
  const titles = [];
  for (let offset = 0, page = 0; page < 15; page++) {
    const data = await psnGet(config, `${GAMES}/${id}/titles?${new URLSearchParams({ categories: 'ps4_game,ps5_native_game', limit: '200', offset: String(offset) })}`);
    if (data.error) {
      if (page === 0) throw new ProviderError(PRIVATE, { status: 403, code: 'private_profile' });
      break;
    }
    titles.push(...(data.titles ?? []));
    if (!data.nextOffset || data.nextOffset <= offset) break;
    offset = data.nextOffset;
  }
  return titles;
}

async function trophyTitles(config, id) {
  const list = [];
  for (let offset = 0, page = 0; page < 5; page++) {
    const data = await psnGet(config, `${TROPHIES}/${id}/trophyTitles?limit=800&offset=${offset}`);
    if (data.error) break; // trophées privés : on garde les jeux sans trophées
    list.push(...(data.trophyTitles ?? []));
    offset += data.trophyTitles?.length ?? 0;
    if (!data.trophyTitles?.length || offset >= (data.totalItemCount ?? 0)) break;
  }
  return list;
}

const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);

async function fetchLibrary(ctx, account) {
  const id = await accountId(ctx, account);
  const [titles, trophies] = [await playedGames(ctx.config, id), await trophyTitles(ctx.config, id)];
  // Trophées ↔ jeu : même compte, même console, titre identique une fois normalisé
  const trophyOf = (name, console) => trophies.find((t) => matchKey(t.trophyTitleName) === matchKey(name) && String(t.trophyTitlePlatform ?? '').includes(console));
  return titles.map((t) => {
    const name = t.localizedName ?? t.name;
    const console = t.category === 'ps5_native_game' ? 'PS5' : 'PS4';
    const tr = trophyOf(name, console);
    return {
      id: t.titleId,
      name,
      platform: console === 'PS5' ? 'PlayStation 5' : 'PlayStation 4',
      image: t.localizedImageUrl ?? t.imageUrl ?? null,
      playtimeMinutes: durationMinutes(t.playDuration),
      firstPlayedAt: t.firstPlayedDateTime ?? null,
      lastPlayedAt: t.lastPlayedDateTime ?? null,
      achievements: tr ? achievementsOf(sum(tr.earnedTrophies), sum(tr.definedTrophies), tr.progress) : null,
    };
  });
}

export const playstation = libraryProvider({
  id: 'playstation',
  name: 'PlayStation Network',
  official: false,
  experimental: true,
  discordTypes: ['playstation'],
  capabilities: { achievements: true },
  limitations: 'Connecteur non officiel : Asobi lit les jeux et trophées que ton profil PlayStation rend publics (temps de jeu, dernière partie, progression des trophées). Sony peut le couper à tout moment.',
  unverifiedMessage: 'Discord n\'a pas vérifié ce compte PlayStation : relie-le à nouveau dans Discord (Paramètres → Connexions).',
  manualImport: ['PlayStation 5', 'PlayStation 4'],
  enabled: (config) => Boolean(config.env.PSN_NPSSO),
  onDetected: (c) => (c.verified
    ? { status: ACCOUNT_STATUS.DETECTED, message: 'Compte vérifié par Discord : tu peux activer l\'import (connecteur non officiel).' }
    : { status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, message: 'Discord n\'a pas vérifié ce compte PlayStation.' }),
  fetchLibrary,
});
