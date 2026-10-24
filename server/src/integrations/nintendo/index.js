// Nintendo — connecteur NON OFFICIEL (même méthode que nxapi et l'extension Raycast « Switch Game Play History »).
//
// Nintendo n'a pas d'API publique. Le joueur se connecte lui-même sur accounts.nintendo.com ; au lieu de cliquer
// sur « Choisir cette personne », il copie l'adresse de ce bouton et la colle dans Asobi. Asobi l'échange (avec
// un vérificateur PKCE gardé côté serveur) contre un jeton de session du compte Nintendo, chiffré en base.
// Asobi y lit l'historique de jeu de l'application « My Nintendo » : jeux Switch joués, minutes, première et
// dernière partie. Pas de succès (la Switch n'en a pas).
//   - Nintendo n'autorise pas officiellement cet usage : ses conditions d'utilisation peuvent l'interdire ;
//   - le jeton dure environ deux ans ; la déconnexion l'efface d'Asobi (il se révoque aussi depuis le compte Nintendo).

import { createHash } from 'node:crypto';
import { ACCOUNT_STATUS } from '../core/provider.js';
import { ProviderError, withRetry } from '../core/sync.js';
import { libraryProvider, upsertLinkedAccount, setAccount } from '../core/library.js';
import { saveCredentials, loadCredentials, stillValid, deleteCredentials } from '../core/credentials.js';
import { randomToken } from '../../security.js';
import { HttpError } from '../../http.js';

const ACCOUNTS = 'https://accounts.nintendo.com/connect/1.0.0';
const HISTORY = 'https://mypage-api.entry.nintendo.co.jp/api/v1/users/me/play_histories';
const ME = 'https://api.accounts.nintendo.com/2.0.0/users/me';
// Application publique « My Nintendo » (identifiant de client OAuth, pas un secret)
const CLIENT_ID = '5c38e31cd085304b';
const REDIRECT = `npf${CLIENT_ID}://auth`;
const UA = { 'User-Agent': 'com.nintendo.znej/1.13.0 (Android/7.1.2)' };

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function authorizeUrl(state, verifier) {
  return `${ACCOUNTS}/authorize?${new URLSearchParams({
    state,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    scope: 'openid user user.mii user.email user.links[].id',
    response_type: 'session_token_code',
    session_token_code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    session_token_code_challenge_method: 'S256',
    theme: 'login_form',
  })}`;
}

/** Jeton de session (longue durée) → jeton d'accès (15 minutes). */
async function accessFromSession(sessionToken) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ client_id: CLIENT_ID, session_token: sessionToken, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token' }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) return null;
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 900) * 1000).toISOString() };
}

const reauth = (ctx, account) => {
  const msg = 'Connexion Nintendo expirée ou révoquée : reconnecte ton compte Nintendo.';
  setAccount(ctx.db, account.id, { status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, status_message: msg });
  deleteCredentials(ctx, account.id);
  return new ProviderError(msg, { status: 401, code: 'reauth' });
};

async function accessToken(ctx, account) {
  const cred = loadCredentials(ctx, account.id);
  if (stillValid(cred, 60_000)) return cred.accessToken;
  if (!cred?.refreshToken) throw reauth(ctx, account);
  const fresh = await accessFromSession(cred.refreshToken);
  if (!fresh) throw reauth(ctx, account);
  saveCredentials(ctx, account.id, { ...fresh, refreshToken: cred.refreshToken });
  return fresh.accessToken;
}

/** Console d'Asobi d'après le type d'appareil donné par Nintendo (HAC = Switch). */
export const nintendoPlatform = (deviceType) => (/BEE|OUNCE|SWITCH_?2|NX2/i.test(String(deviceType ?? '')) ? 'Nintendo Switch 2' : 'Nintendo Switch');

async function fetchLibrary(ctx, account) {
  const bearer = await accessToken(ctx, account);
  const data = await withRetry(async () => {
    const res = await fetch(HISTORY, { headers: { ...UA, Authorization: `Bearer ${bearer}` } });
    if (res.status === 401) throw reauth(ctx, account);
    if (res.status === 429) throw new ProviderError('Nintendo limite les requêtes.', { status: 429, retryable: true });
    if (res.status >= 500) throw new ProviderError(`Nintendo a répondu ${res.status}.`, { retryable: true });
    return res.ok ? res.json().catch(() => null) : null;
  });
  if (!Array.isArray(data?.playHistories)) throw new ProviderError('Nintendo n\'a pas renvoyé ton historique de jeu.', { status: 502 });
  return data.playHistories.map((h) => ({
    id: h.titleId,
    name: h.titleName,
    platform: nintendoPlatform(h.deviceType),
    image: h.imageUrl ?? null,
    playtimeMinutes: Number.isFinite(h.totalPlayedMinutes) ? h.totalPlayedMinutes : null,
    firstPlayedAt: h.firstPlayedAt ?? null,
    lastPlayedAt: h.lastPlayedAt ?? null,
    achievements: null,
  }));
}

/* ---------- Liaison : le joueur colle l'adresse du bouton « Choisir cette personne » ---------- */

const link = {
  type: 'paste-link',
  // `flow` = { begin(secret) → state } fourni par la route (state lié au navigateur, 10 minutes)
  start(ctx, userId, flow) {
    const verifier = randomToken(32);
    const state = flow.begin(verifier);
    return { url: authorizeUrl(state, verifier) };
  },
  async finish(ctx, userId, input, flow) {
    const raw = String(input ?? '').trim();
    if (!raw.startsWith(`${REDIRECT}#`)) throw new HttpError(400, `Colle l'adresse qui commence par ${REDIRECT}#…`);
    const params = new URLSearchParams(raw.slice(raw.indexOf('#') + 1));
    const code = params.get('session_token_code');
    if (!code) throw new HttpError(400, 'Adresse Nintendo incomplète : recommence.');
    const verifier = flow.consume(params.get('state')); // state inconnu, expiré, rejoué ou d'un autre navigateur → 400
    const res = await fetch(`${ACCOUNTS}/api/session_token`, {
      method: 'POST',
      headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Platform': 'Android', 'X-ProductVersion': '2.5.0' },
      body: new URLSearchParams({ client_id: CLIENT_ID, session_token_code: code, session_token_code_verifier: verifier }),
    });
    const sessionToken = (await res.json().catch(() => null))?.session_token;
    if (!res.ok || !sessionToken) throw new ProviderError('Nintendo a refusé cette connexion : recommence.', { status: 400 });
    const access = await accessFromSession(sessionToken);
    if (!access) throw new ProviderError('Nintendo a refusé cette connexion : recommence.', { status: 400 });
    // Seuls l'identifiant et le pseudo du compte sont gardés (ni e-mail, ni date de naissance)
    const meRes = await fetch(ME, { headers: { ...UA, Authorization: `Bearer ${access.accessToken}` } });
    const me = await meRes.json().catch(() => null);
    if (!me?.id) throw new ProviderError('Compte Nintendo illisible : recommence.', { status: 502 });
    const id = upsertLinkedAccount(ctx, userId, 'nintendo', { externalId: String(me.id), username: me.nickname ?? null, externalData: {} });
    saveCredentials(ctx, id, { ...access, refreshToken: sessionToken, scope: 'session_token' });
    return id;
  },
};

export const nintendo = libraryProvider({
  id: 'nintendo',
  name: 'Nintendo',
  official: false,
  experimental: true,
  limitations: 'Connecteur non officiel : tu te connectes sur le site de Nintendo et colles l\'adresse du bouton « Choisir cette personne ». Asobi lit ton historique de jeu Switch (minutes, première et dernière partie). Nintendo peut l\'interdire ou le couper.',
  manualImport: ['Nintendo Switch 2', 'Nintendo Switch'],
  enabled: () => true,
  onDetected: () => ({ status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, message: 'Connecte ton compte Nintendo pour importer tes jeux.' }),
  fetchLibrary,
  link,
});
