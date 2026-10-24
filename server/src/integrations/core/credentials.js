// Jetons des plateformes, chiffrés au repos (AES-256-GCM) et jamais envoyés au navigateur.

import { encrypt, decrypt } from '../../security.js';

export function saveCredentials(ctx, accountId, tokens) {
  ctx.db.prepare(`INSERT INTO provider_credentials (connected_account_id, encrypted_token, encrypted_refresh_token, scope, expires_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(connected_account_id) DO UPDATE SET encrypted_token = excluded.encrypted_token, encrypted_refresh_token = excluded.encrypted_refresh_token,
      scope = excluded.scope, expires_at = excluded.expires_at`)
    .run(accountId, encrypt(ctx.key, tokens.accessToken ?? ''), encrypt(ctx.key, tokens.refreshToken), tokens.scope ?? null, tokens.expiresAt ?? null);
}

/** Jetons déchiffrés d'un compte, ou null. */
export function loadCredentials(ctx, accountId) {
  const row = ctx.db.prepare('SELECT * FROM provider_credentials WHERE connected_account_id = ?').get(accountId);
  if (!row) return null;
  return {
    accessToken: decrypt(ctx.key, row.encrypted_token) || null,
    refreshToken: decrypt(ctx.key, row.encrypted_refresh_token) || null,
    scope: row.scope,
    expiresAt: row.expires_at,
  };
}

export function deleteCredentials(ctx, accountId) {
  ctx.db.prepare('DELETE FROM provider_credentials WHERE connected_account_id = ?').run(accountId);
}

/** Le jeton d'accès est-il encore valable pour au moins `marginMs` ? */
export const stillValid = (cred, marginMs = 5 * 60_000) => Boolean(cred?.accessToken && cred.expiresAt && Date.parse(cred.expiresAt) - Date.now() > marginMs);
