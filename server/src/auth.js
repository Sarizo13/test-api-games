// Sessions (cookie HttpOnly, jeton dont seule l'empreinte est en base) et connexion avec Discord.
//
// Le paramètre « state » d'une redirection OAuth/OpenID est aléatoire, à usage unique, valable 10 minutes,
// et lié au navigateur par un cookie : une réponse ne peut pas être rejouée ni injectée dans une autre session.

import { randomToken, sha256, encrypt } from './security.js';
import { cookie, parseCookies, HttpError } from './http.js';
import { now } from './db.js';
import * as discordApi from './integrations/discord/index.js';
import { saveCredentials, upsertDetected } from './accounts.js';

const SESSION_COOKIE = 'asobi_sid';
const OAUTH_COOKIE = 'asobi_oauth';
const STATE_TTL = 10 * 60_000;

/* ---------- Sessions ---------- */

export function currentUser(ctx, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = ctx.db.prepare(`SELECT u.*, s.token_hash, s.last_seen_at AS session_seen FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), now());
  if (!row) return null;
  if (Date.now() - Date.parse(row.session_seen) > 3600_000) {
    ctx.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now(), row.token_hash);
  }
  return row;
}

/** L'utilisateur de la requête (déjà lu par le routeur), ou 401. */
export function requireUserRow(user) {
  if (!user) throw new HttpError(401, 'Connecte-toi pour continuer.', { code: 'login_required' });
  return user;
}

/** Crée une session et renvoie l'en-tête Set-Cookie correspondant. */
export function createSession(ctx, userId) {
  const token = randomToken(32);
  const t = new Date();
  const expires = new Date(t.getTime() + ctx.config.sessionDays * 86400_000);
  ctx.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), userId, t.toISOString(), expires.toISOString(), t.toISOString());
  return cookie(SESSION_COOKIE, token, { maxAge: ctx.config.sessionDays * 86400, secure: ctx.config.secureCookies });
}

export function destroySession(ctx, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  return cookie(SESSION_COOKIE, '', { maxAge: 0, secure: ctx.config.secureCookies });
}

/* ---------- « state » des redirections ---------- */

/** Adresse de retour acceptée : seulement une page du site (#/…), jamais un autre domaine. */
export const safeNext = (next) => (typeof next === 'string' && /^#\/[\w\-/%.]*$/.test(next) ? next : '#/');

export function beginRedirectFlow(ctx, { provider, purpose, userId = null, next = '#/', secret = null }) {
  const state = randomToken(24);
  const browser = randomToken(24);
  const t = Date.now();
  ctx.db.prepare(`INSERT INTO oauth_states (state_hash, provider, purpose, user_id, browser_hash, next, created_at, expires_at, secret)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sha256(state), provider, purpose, userId, sha256(browser), safeNext(next), new Date(t).toISOString(), new Date(t + STATE_TTL).toISOString(),
    secret ? encrypt(ctx.key, secret) : null);
  return { state, cookie: cookie(OAUTH_COOKIE, browser, { maxAge: STATE_TTL / 1000, secure: ctx.config.secureCookies, path: '/api' }) };
}

/** Vérifie et consomme un « state » (une seule utilisation). Lève 400 s'il est absent, inconnu, expiré ou d'un autre navigateur. */
export function consumeRedirectFlow(ctx, req, provider, state) {
  const browser = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
  if (!state || !browser) throw new HttpError(400, 'Connexion expirée ou lancée depuis un autre navigateur : recommence.');
  const row = ctx.db.prepare('SELECT * FROM oauth_states WHERE state_hash = ?').get(sha256(state));
  if (row) ctx.db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(row.state_hash);
  if (!row || row.provider !== provider || row.browser_hash !== sha256(browser) || Date.parse(row.expires_at) < Date.now()) {
    throw new HttpError(400, 'Connexion expirée ou invalide : recommence.');
  }
  return row;
}

export const clearFlowCookie = (ctx) => cookie(OAUTH_COOKIE, '', { maxAge: 0, secure: ctx.config.secureCookies, path: '/api' });

/* ---------- Connexion avec Discord ---------- */

function uniqueUsername(db, wanted, discordId) {
  const base = String(wanted ?? '').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 28) || 'joueur';
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    const taken = db.prepare('SELECT discord_id FROM users WHERE username = ?').get(candidate);
    if (!taken || taken.discord_id === discordId) return candidate;
  }
}

/** Échange le code Discord, crée ou met à jour l'utilisateur, garde le jeton (chiffré) et détecte ses comptes. */
export async function completeDiscordLogin(ctx, code) {
  const { db, config } = ctx;
  const tokens = await discordApi.exchangeCode(config, code);
  const profile = await discordApi.getCurrentUser(tokens.accessToken);
  const t = now();

  let user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(profile.id);
  if (user) {
    db.prepare('UPDATE users SET display_name = ?, avatar_url = ?, last_login_at = ? WHERE id = ?')
      .run(profile.global_name ?? profile.username, discordApi.avatarUrl(profile), t, user.id);
  } else {
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (discord_id, username, display_name, avatar_url, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(profile.id, uniqueUsername(db, profile.username, profile.id), profile.global_name ?? profile.username, discordApi.avatarUrl(profile), t, t);
    user = { id: Number(lastInsertRowid) };
  }

  // Le compte Discord lui-même (pour relire les connexions plus tard)
  db.prepare(`INSERT INTO connected_accounts (user_id, provider, external_user_id, external_username, verified, detected_via, status, connected_at, last_sync_at)
    VALUES (?, 'discord', ?, ?, 1, 'login', 'connected', ?, ?)
    ON CONFLICT(user_id, provider, external_user_id) DO UPDATE SET external_username = excluded.external_username, status = 'connected',
      status_message = NULL, last_sync_at = excluded.last_sync_at`).run(user.id, profile.id, profile.username, t, t);
  const account = db.prepare("SELECT id FROM connected_accounts WHERE user_id = ? AND provider = 'discord'").get(user.id);
  saveCredentials(ctx, account.id, tokens);

  // Découverte des comptes de jeu : un échec ici ne doit pas empêcher la connexion
  try {
    upsertDetected(ctx, user.id, await discordApi.getConnections(tokens.accessToken));
  } catch (err) {
    ctx.log?.(`connexions Discord illisibles : ${err.message}`);
  }
  return user.id;
}
