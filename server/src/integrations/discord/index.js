// Discord : connexion à Asobi (OAuth2, scopes identify + connections) et découverte des comptes de jeu
// liés au compte Discord (/users/@me/connections).
//
// Discord ne transmet AUCUNE autorisation des plateformes liées : un compte Steam, Xbox ou PlayStation vu
// ici est seulement « détecté ». Le champ `verified` indique que son propriétaire l'a relié via la plateforme
// elle-même ; c'est une preuve de propriété, pas un accès à ses données.
//
// Docs : https://docs.discord.com/developers/topics/oauth2 · https://docs.discord.com/developers/resources/user

import { defineProvider } from '../core/provider.js';
import { ProviderError, withRetry } from '../core/sync.js';

const API = 'https://discord.com/api/v10';
export const SCOPES = 'identify connections';

/** Types de connexion Discord qui correspondent à des plateformes de jeu. */
export const GAMING_TYPES = {
  steam: 'steam',
  playstation: 'playstation',
  xbox: 'xbox',
  epicgames: 'epicgames',
  battlenet: 'battlenet',
  riotgames: 'riotgames',
  bungie: 'bungie',
  roblox: 'roblox',
};

export const discord = defineProvider({
  id: 'discord',
  name: 'Discord',
  kind: 'identity',
  capabilities: { identify: true },
  enabled: (config) => Boolean(config.discord.clientId && config.discord.clientSecret),
});

/** Adresse de la page d'autorisation Discord. `state` lie la réponse à ce navigateur (anti-CSRF). */
export function authorizeUrl(config, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.discord.clientId,
    scope: SCOPES,
    state,
    redirect_uri: config.discord.redirectUri,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function tokenRequest(config, form) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.discord.clientId}:${config.discord.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams(form),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new ProviderError(`Discord refuse la connexion (${data.error ?? res.status}).`, {
      status: res.status === 400 || res.status === 401 ? 401 : 502, retryable: res.status >= 500, code: data.error,
    });
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    scope: data.scope ?? SCOPES,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 604800) * 1000).toISOString(),
  };
}

export const exchangeCode = (config, code) => tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.discord.redirectUri });
export const refreshToken = (config, refresh) => tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refresh });

/** Révoque l'autorisation (tous les jetons liés) côté Discord. */
export async function revokeToken(config, token) {
  await fetch(`${API}/oauth2/token/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.discord.clientId}:${config.discord.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
  }).catch(() => {});
}

async function get(path, accessToken) {
  return withRetry(async () => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) throw new ProviderError('Autorisation Discord expirée.', { status: 401, code: 'unauthorized' });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new ProviderError('Discord limite les requêtes.', { status: 429, retryable: true }), { retryAfterMs: (body.retry_after ?? 1) * 1000 });
    }
    if (!res.ok) throw new ProviderError(`Discord a répondu ${res.status}.`, { retryable: res.status >= 500 });
    return res.json();
  });
}

export const getCurrentUser = (accessToken) => get('/users/@me', accessToken);
export const getConnections = (accessToken) => get('/users/@me/connections', accessToken);

export function avatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Garde seulement les connexions de jeu, non révoquées. */
export function gamingConnections(connections) {
  return (Array.isArray(connections) ? connections : [])
    .filter((c) => GAMING_TYPES[c.type] && !c.revoked && c.id)
    .map((c) => ({ provider: GAMING_TYPES[c.type], id: String(c.id), name: c.name ?? null, verified: Boolean(c.verified) }));
}
