// Epic Games — connecteur NON OFFICIEL (même méthode que les lanceurs libres Legendary et Heroic).
//
// Epic ne donne pas la bibliothèque aux sites tiers. Le joueur se connecte lui-même sur epicgames.com, qui lui
// affiche un code d'autorisation à usage unique ; il le colle dans Asobi, qui l'échange contre une session du
// lanceur Epic (jetons chiffrés en base, jamais envoyés au navigateur). Asobi y lit : jeux possédés et temps de jeu.
//   - pas de succès (Epic ne les expose pas par cette voie) ;
//   - la session peut expirer si elle n'est pas utilisée : il suffit alors de recoller un code ;
//   - la déconnexion ferme la session côté Epic.

import { ACCOUNT_STATUS } from '../core/provider.js';
import { ProviderError, withRetry, mapLimit } from '../core/sync.js';
import { libraryProvider, upsertLinkedAccount, setAccount, accountData } from '../core/library.js';
import { saveCredentials, loadCredentials, stillValid, deleteCredentials } from '../core/credentials.js';
import { cached } from '../../cache.js';

const OAUTH = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth';
const LIBRARY = 'https://library-service.live.use1a.on.epicgames.com/library/api/public';
const CATALOG = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace';
// Identifiants publics du lanceur Epic (ceux qu'utilisent Legendary et Heroic), remplaçables dans .env
const client = (config) => ({
  id: config.env.EPIC_CLIENT_ID || '34a02cf8f4414e29b15921876da36f9a',
  secret: config.env.EPIC_CLIENT_SECRET || 'daafbccc737745039dffe53d94fc76cf',
});

export const epicLoginUrl = (config) => `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(`https://www.epicgames.com/id/api/redirect?clientId=${client(config).id}&responseType=code`)}`;

async function token(config, form) {
  const { id, secret } = client(config);
  const res = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: new URLSearchParams({ ...form, token_type: 'eg1' }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ?? new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString(),
    accountId: data.account_id,
    displayName: data.displayName ?? null,
  };
}

const reauth = (ctx, account) => {
  const msg = 'Session Epic expirée : reconnecte ton compte Epic (nouveau code).';
  setAccount(ctx.db, account.id, { status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, status_message: msg });
  deleteCredentials(ctx, account.id);
  return new ProviderError(msg, { status: 401, code: 'reauth' });
};

/** Jeton d'accès valable, renouvelé par le jeton de rafraîchissement si besoin. */
async function accessToken(ctx, account) {
  const cred = loadCredentials(ctx, account.id);
  if (stillValid(cred)) return cred.accessToken;
  if (!cred?.refreshToken) throw reauth(ctx, account);
  const fresh = await token(ctx.config, { grant_type: 'refresh_token', refresh_token: cred.refreshToken });
  if (!fresh) throw reauth(ctx, account);
  saveCredentials(ctx, account.id, fresh);
  return fresh.accessToken;
}

async function epicGet(ctx, account, url) {
  const bearer = await accessToken(ctx, account);
  return withRetry(async () => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    if (res.status === 401) throw reauth(ctx, account);
    if (res.status === 429) throw new ProviderError('Epic limite les requêtes.', { status: 429, retryable: true });
    if (res.status >= 500) throw new ProviderError(`Epic a répondu ${res.status}.`, { retryable: true });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  });
}

/** Titre, visuel et type d'un article du catalogue (gardé 30 jours : ce n'est pas une donnée personnelle). */
const catalogItem = (ctx, account, namespace, id) => cached(ctx.db, `epic-catalog/${namespace}/${id}`, 30 * 86400, async () => {
  const data = await epicGet(ctx, account, `${CATALOG}/${encodeURIComponent(namespace)}/bulk/items?${new URLSearchParams({ id, includeDLCDetails: 'true', includeMainGameDetails: 'true', country: 'FR', locale: 'fr' })}`);
  const item = data?.[id];
  if (!item) return null;
  const image = ['DieselGameBoxTall', 'OfferImageTall', 'DieselGameBox', 'Thumbnail'].map((t) => item.keyImages?.find((k) => k.type === t)?.url).find(Boolean) ?? null;
  const categories = (item.categories ?? []).map((c) => c.path);
  return { title: item.title ?? null, image, isAddon: Boolean(item.mainGameItem) || categories.some((c) => /addons|digitalextras/.test(c)) };
});

async function fetchLibrary(ctx, account) {
  const records = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const data = await epicGet(ctx, account, `${LIBRARY}/items?${new URLSearchParams({ includeMetadata: 'true', ...(cursor ? { cursor } : {}) })}`);
    if (!data) throw new ProviderError('Epic n\'a pas renvoyé ta bibliothèque.', { status: 502 });
    records.push(...(data.records ?? []));
    cursor = data.responseMetadata?.nextCursor;
    if (!cursor) break;
  }
  const epicId = accountData(account).epicAccountId ?? account.external_user_id;
  const playtime = new Map(((await epicGet(ctx, account, `${LIBRARY}/playtime/account/${encodeURIComponent(epicId)}/all`)) ?? [])
    .map((p) => [p.artifactId, Math.round((p.totalTime ?? 0) / 60)]));

  // Jeux seulement : pas les contenus Unreal Engine, ni les extensions
  const games = records.filter((r) => r.appName && r.namespace && r.namespace !== 'ue' && r.catalogItemId);
  const unique = [...new Map(games.map((r) => [r.appName, r])).values()];
  const items = await mapLimit(unique, 4, (r) => catalogItem(ctx, account, r.namespace, r.catalogItemId).catch(() => null));
  return unique.map((r, i) => ({ r, item: items[i] }))
    .filter(({ item }) => item?.title && !item.isAddon)
    .map(({ r, item }) => ({
      id: r.appName,
      name: item.title,
      platform: 'PC',
      image: item.image,
      playtimeMinutes: playtime.get(r.appName) ?? null,
      firstPlayedAt: null,
      lastPlayedAt: null,
      achievements: null,
    }));
}

/* ---------- Liaison : le joueur colle le code affiché par Epic ---------- */

const link = {
  type: 'code',
  start: (ctx) => ({ url: epicLoginUrl(ctx.config) }),
  async finish(ctx, userId, input) {
    // Le joueur colle soit le code seul, soit toute la réponse JSON d'Epic
    const code = String(input ?? '').match(/"authorizationCode"\s*:\s*"([0-9a-f]{32})"/i)?.[1] ?? String(input ?? '').trim().match(/^[0-9a-f]{32}$/i)?.[0];
    if (!code) throw new ProviderError('Code Epic invalide : copie le code « authorizationCode » affiché par Epic.', { status: 400 });
    const tokens = await token(ctx.config, { grant_type: 'authorization_code', code });
    if (!tokens?.accountId) throw new ProviderError('Epic a refusé ce code (il ne sert qu\'une fois et expire vite) : recommence.', { status: 400 });
    const id = upsertLinkedAccount(ctx, userId, 'epicgames', { externalId: tokens.accountId, username: tokens.displayName, externalData: { epicAccountId: tokens.accountId } });
    saveCredentials(ctx, id, tokens);
    return id;
  },
};

/** Ferme la session Epic (déconnexion d'Asobi). */
async function revoke(ctx, account, cred) {
  if (!cred?.accessToken) return;
  await fetch(`${OAUTH}/sessions/kill/${encodeURIComponent(cred.accessToken)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${cred.accessToken}` } }).catch(() => {});
}

export const epic = libraryProvider({
  id: 'epicgames',
  name: 'Epic Games',
  official: false,
  experimental: true,
  discordTypes: ['epicgames'],
  limitations: 'Connecteur non officiel : tu te connectes sur epicgames.com et colles le code affiché. Asobi lit tes jeux et ton temps de jeu (pas les succès). La session peut expirer : il faut alors recoller un code.',
  manualImport: ['PC'],
  enabled: () => true,
  onDetected: () => ({ status: ACCOUNT_STATUS.AUTHORIZATION_REQUIRED, message: 'Connecte ton compte Epic pour importer tes jeux (copier-coller d\'un code).' }),
  fetchLibrary,
  link,
  revoke,
});
