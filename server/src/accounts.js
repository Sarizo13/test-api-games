// Comptes de jeu connectés : liste, détection via Discord, liaison Steam vérifiée, jetons chiffrés, déconnexion.
// Les liaisons directes (Epic, Nintendo) passent par provider.link (voir app.js).

import { PROVIDERS, getProvider } from './integrations/index.js';
import { ACCOUNT_STATUS, describe } from './integrations/core/provider.js';
import * as discordApi from './integrations/discord/index.js';
import { jobView } from './integrations/core/sync.js';
import { decrypt } from './security.js';
import { saveCredentials, loadCredentials } from './integrations/core/credentials.js';
import { HttpError } from './http.js';
import { now } from './db.js';

export function accountView(db, row) {
  const job = db.prepare('SELECT * FROM sync_jobs WHERE connected_account_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_user_id,
    username: row.external_username,
    verified: Boolean(row.verified),
    detectedVia: row.detected_via,
    status: row.status,
    message: row.status_message,
    autoSync: Boolean(row.auto_sync),
    gamesCount: row.games_count,
    connectedAt: row.connected_at,
    lastSyncAt: row.last_sync_at,
    lastJob: jobView(job) ?? null,
  };
}

export function listAccounts(ctx, userId) {
  const { db, config } = ctx;
  const rows = db.prepare('SELECT * FROM connected_accounts WHERE user_id = ? ORDER BY id').all(userId);
  const unmatched = db.prepare("SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND match_status = 'unmatched'").get(userId).n;
  return { providers: PROVIDERS.map((p) => describe(p, config)), accounts: rows.map((r) => accountView(db, r)), unmatched };
}

export function getAccount(ctx, userId, id) {
  const row = ctx.db.prepare('SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?').get(Number(id), userId);
  if (!row) throw new HttpError(404, 'Compte introuvable.');
  return row;
}

/* ---------- Jetons (chiffrés au repos) ---------- */

export { saveCredentials };

/** Jeton Discord valide pour ce compte, renouvelé s'il expire dans moins de 5 minutes. */
export async function discordAccessToken(ctx, account) {
  const { db, config } = ctx;
  const cred = db.prepare('SELECT * FROM provider_credentials WHERE connected_account_id = ?').get(account.id);
  const reauth = (msg) => {
    db.prepare('UPDATE connected_accounts SET status = ?, status_message = ? WHERE id = ?').run(ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, msg, account.id);
    return new HttpError(401, msg, { code: 'discord_reauth' });
  };
  if (!cred) throw reauth('Reconnecte-toi avec Discord pour retrouver tes comptes.');
  if (cred.expires_at && Date.parse(cred.expires_at) - Date.now() > 5 * 60_000) return decrypt(ctx.key, cred.encrypted_token);
  const refresh = decrypt(ctx.key, cred.encrypted_refresh_token);
  if (!refresh) throw reauth('Autorisation Discord expirée : reconnecte-toi avec Discord.');
  try {
    const tokens = await discordApi.refreshToken(config, refresh);
    saveCredentials(ctx, account.id, tokens);
    return tokens.accessToken;
  } catch {
    db.prepare('DELETE FROM provider_credentials WHERE connected_account_id = ?').run(account.id);
    throw reauth('Autorisation Discord révoquée ou expirée : reconnecte-toi avec Discord.');
  }
}

/* ---------- Détection ---------- */

/**
 * Enregistre les comptes de jeu vus dans les connexions Discord. Un compte déjà importable (connected, synced…)
 * ne revient jamais en arrière ; un compte qui n'apparaît plus n'est pas supprimé.
 */
export function upsertDetected(ctx, userId, connections) {
  const { db } = ctx;
  const t = now();
  const found = [];
  for (const c of discordApi.gamingConnections(connections)) {
    const provider = getProvider(c.provider);
    if (!provider) continue;
    let row = db.prepare('SELECT * FROM connected_accounts WHERE user_id = ? AND provider = ? AND external_user_id = ?').get(userId, c.provider, c.id);
    // Un compte vérifié appartient déjà à quelqu'un d'autre sur Asobi ?
    const owner = c.verified && db.prepare('SELECT user_id FROM connected_accounts WHERE provider = ? AND external_user_id = ? AND verified = 1').get(c.provider, c.id);
    const takenByOther = owner && owner.user_id !== userId;
    const verified = c.verified && !takenByOther ? 1 : row?.verified ?? 0;
    const initial = takenByOther
      ? { status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, message: 'Ce compte est déjà relié à un autre utilisateur d\'Asobi.' }
      : provider.onDetected({ ...c, verified: Boolean(verified) });

    if (!row) {
      const { lastInsertRowid } = db.prepare(`INSERT INTO connected_accounts (user_id, provider, external_user_id, external_username, verified, detected_via, status, status_message, connected_at)
        VALUES (?, ?, ?, ?, ?, 'discord', ?, ?, ?)`).run(userId, c.provider, c.id, c.name, verified, initial.status, initial.message ?? null, t);
      row = { id: Number(lastInsertRowid) };
    } else {
      const early = [ACCOUNT_STATUS.DETECTED, ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, ACCOUNT_STATUS.UNSUPPORTED].includes(row.status);
      db.prepare('UPDATE connected_accounts SET external_username = ?, verified = ?, status = ?, status_message = ? WHERE id = ?')
        .run(c.name ?? row.external_username, verified, early ? initial.status : row.status, early ? initial.message ?? null : row.status_message, row.id);
    }
    found.push(row.id);
  }
  return found;
}

/** Relit les connexions Discord de l'utilisateur et met à jour ses comptes détectés. */
export async function discover(ctx, userId) {
  const account = ctx.db.prepare("SELECT * FROM connected_accounts WHERE user_id = ? AND provider = 'discord'").get(userId);
  if (!account) throw new HttpError(401, 'Connecte-toi avec Discord.', { code: 'discord_reauth' });
  const token = await discordAccessToken(ctx, account);
  const connections = await discordApi.getConnections(token);
  upsertDetected(ctx, userId, connections);
  ctx.db.prepare("UPDATE connected_accounts SET status = 'connected', status_message = NULL, last_sync_at = ? WHERE id = ?").run(now(), account.id);
  return listAccounts(ctx, userId);
}

/** Compte Steam dont la propriété vient d'être prouvée par Steam OpenID. */
export function linkVerifiedSteam(ctx, userId, steamId) {
  const { db } = ctx;
  const owner = db.prepare("SELECT user_id FROM connected_accounts WHERE provider = 'steam' AND external_user_id = ? AND verified = 1").get(steamId);
  if (owner && owner.user_id !== userId) throw new HttpError(409, 'Ce compte Steam est déjà relié à un autre utilisateur d\'Asobi.');
  const row = db.prepare("SELECT * FROM connected_accounts WHERE user_id = ? AND provider = 'steam' AND external_user_id = ?").get(userId, steamId);
  const ready = { status: ACCOUNT_STATUS.DETECTED, message: 'Compte vérifié avec Steam : tu peux importer ta bibliothèque.' };
  if (row) {
    const early = [ACCOUNT_STATUS.DETECTED, ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, ACCOUNT_STATUS.ERROR].includes(row.status);
    db.prepare('UPDATE connected_accounts SET verified = 1, status = ?, status_message = ? WHERE id = ?')
      .run(early ? ready.status : row.status, early ? ready.message : row.status_message, row.id);
    return row.id;
  }
  const { lastInsertRowid } = db.prepare(`INSERT INTO connected_accounts (user_id, provider, external_user_id, verified, detected_via, status, status_message, connected_at)
    VALUES (?, 'steam', ?, 1, 'openid', ?, ?, ?)`).run(userId, steamId, ready.status, ready.message, now());
  return Number(lastInsertRowid);
}

/**
 * Déconnexion : les jetons sont révoqués et effacés, les données brutes de la plateforme supprimées.
 * Les jeux déjà dans la collection restent (avec leurs notes et statuts).
 * Discord étant l'identité de connexion, « déconnecter Discord » révoque seulement l'accès aux connexions.
 */
export async function disconnect(ctx, userId, id) {
  const { db, config } = ctx;
  const account = getAccount(ctx, userId, id);
  const cred = db.prepare('SELECT * FROM provider_credentials WHERE connected_account_id = ?').get(account.id);
  if (account.provider === 'discord') {
    if (cred) await discordApi.revokeToken(config, decrypt(ctx.key, cred.encrypted_token));
    db.prepare('DELETE FROM provider_credentials WHERE connected_account_id = ?').run(account.id);
    db.prepare('UPDATE connected_accounts SET status = ?, status_message = ? WHERE id = ?')
      .run(ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, 'Accès aux connexions révoqué. Reconnecte-toi avec Discord pour le rétablir.', account.id);
    return;
  }
  const provider = getProvider(account.provider);
  if (provider?.revoke && cred) await provider.revoke(ctx, account, loadCredentials(ctx, account.id)).catch(() => {});
  db.prepare('DELETE FROM connected_accounts WHERE id = ? AND user_id = ?').run(account.id, userId); // jetons, données brutes et liens partent en cascade
}
