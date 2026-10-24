// Routes HTTP d'Asobi : le site (fichiers statiques) et l'API sous /api.
//
// Public        GET  /api/health · /api/me · /api/users/:username · /api/search · /api/today · /api/discover · /api/recommend
// Connexion     GET  /api/auth/discord/login → Discord → /api/auth/discord/callback · POST /api/auth/logout
// Mon compte    DELETE /api/me · GET /api/me/export
// Collection    GET /api/collection · POST /api/games · PATCH|DELETE /api/games/:id · POST /api/games/:id/match
//               POST /api/wishlist · DELETE /api/wishlist/:igdbId · PUT /api/playlist · PATCH /api/settings
// Comptes       GET /api/accounts · POST /api/accounts/discover · GET /api/accounts/steam/openid/start|callback
//               POST /api/accounts/:id/enable|sync|import · GET /api/accounts/:id/library · PATCH|DELETE /api/accounts/:id
//               GET /api/jobs/:id
//
// Toute requête qui modifie quelque chose doit venir du site lui-même (en-tête X-Asobi + même origine) :
// avec le cookie SameSite=Lax, c'est la protection contre les requêtes forgées (CSRF).

import { HttpError, sendJson, redirect, readJson, clientIp, rateLimiter, router } from './http.js';
import { createStatic } from './static.js';
import { cached } from './cache.js';
import { simplify } from '../../scripts/lib/igdb.mjs';
import { searchGames, todayFeed, discover as discoverGames, recommend, platformLogos } from './feed.js';
import * as collection from './collection.js';
import * as accounts from './accounts.js';
import * as auth from './auth.js';
import { getProvider } from './integrations/index.js';
import { ACCOUNT_STATUS } from './integrations/core/provider.js';
import { startJob, getJob } from './integrations/core/sync.js';
import * as discordApi from './integrations/discord/index.js';
import * as steamApi from './integrations/steam/index.js';
import { ROOT } from './config.js';

const ids = (value, max) => String(value ?? '').split(',').map(Number).filter(Boolean).slice(0, max);

const publicUser = (u) => u && ({
  username: u.username,
  displayName: u.display_name,
  avatarUrl: u.avatar_url,
  profilePublic: Boolean(u.profile_public),
  createdAt: u.created_at,
});

export function createApp(ctx) {
  const { db, config } = ctx;
  const limit = rateLimiter();
  const serveStatic = createStatic(ctx.root ?? ROOT);
  const r = router();
  const env = config.env;

  /* ---------- Public ---------- */

  r.add('GET', '/api/health', () => ({ ok: true, service: 'asobi' }));

  r.add('GET', '/api/me', ({ user }) => ({
    user: publicUser(user),
    discordConfigured: Boolean(config.discord.clientId && config.discord.clientSecret),
  }));

  r.add('GET', '/api/users/:username', ({ params, user }) => {
    const owner = db.prepare('SELECT * FROM users WHERE username = ?').get(params.username);
    // Profil privé ou inexistant : même réponse, pour ne pas révéler qui a un compte
    if (!owner || (!owner.profile_public && owner.id !== user?.id)) throw new HttpError(404, 'Profil introuvable ou privé.');
    return { user: publicUser(owner), ...collection.readCollection(db, owner.id) };
  });

  r.add('GET', '/api/search', async ({ url }) => {
    const term = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (term.length < 2) return { results: [] };
    return { results: await cached(db, `search/${simplify(term)}`, 86400, () => searchGames(env, term)) };
  });
  r.add('GET', '/api/today', () => cached(db, `today/${new Date().toISOString().slice(0, 10)}`, 6 * 3600, () => todayFeed(env)));
  r.add('GET', '/api/discover', async ({ url }) => {
    const source = ids(url.searchParams.get('ids'), 10);
    const exclude = ids(url.searchParams.get('exclude'), 400);
    return { results: await cached(db, `discover/${source.join('-')}/${exclude.join('-')}`, 86400, () => discoverGames(env, source, exclude)) };
  });
  r.add('GET', '/api/recommend', async ({ url }) => {
    const genres = (url.searchParams.get('genres') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const mode = url.searchParams.get('mode') === 'explore' ? 'explore' : 'match';
    const exclude = ids(url.searchParams.get('exclude'), 300);
    const key = `recommend/${mode}/${genres.join('|')}/${exclude.join('-')}/${new Date().toISOString().slice(0, 10)}`;
    return { results: await cached(db, key, 6 * 3600, () => recommend(env, { genres, mode, exclude })) };
  });
  r.add('GET', '/api/platform-logos', () => cached(db, 'platform-logos', 7 * 86400, () => platformLogos(env)));

  /* ---------- Connexion avec Discord ---------- */

  r.add('GET', '/api/auth/discord/login', ({ url, res }) => {
    if (!discordApi.discord.enabled(config)) throw new HttpError(503, 'La connexion Discord n\'est pas encore configurée sur ce serveur.');
    const flow = auth.beginRedirectFlow(ctx, { provider: 'discord', purpose: 'login', next: url.searchParams.get('next') });
    redirect(res, discordApi.authorizeUrl(config, flow.state), { 'Set-Cookie': flow.cookie });
  });

  r.add('GET', '/api/auth/discord/callback', async ({ url, req, res }) => {
    const back = (hash, cookies = []) => redirect(res, `/${hash}`, { 'Set-Cookie': [auth.clearFlowCookie(ctx), ...cookies] });
    if (url.searchParams.get('error')) return back('#/?connexion=annulee');
    const flow = auth.consumeRedirectFlow(ctx, req, 'discord', url.searchParams.get('state'));
    const code = url.searchParams.get('code');
    if (!code) throw new HttpError(400, 'Code Discord manquant.');
    const userId = await auth.completeDiscordLogin(ctx, code);
    return back(flow.next, [auth.createSession(ctx, userId)]);
  });

  r.add('POST', '/api/auth/logout', ({ req, res }) => {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.destroySession(ctx, req) });
  });

  /* ---------- Mon compte (RGPD : export et suppression) ---------- */

  r.add('GET', '/api/me/export', ({ user, res }) => {
    const me = auth.requireUserRow(user);
    const data = {
      exportedAt: new Date().toISOString(),
      user: publicUser(me),
      ...collection.readCollection(db, me.id),
      accounts: accounts.listAccounts(ctx, me.id).accounts,
      platformGames: db.prepare(`SELECT a.provider, p.external_game_id, p.name, p.playtime_minutes, p.last_played_at, p.achievements_unlocked, p.achievements_total
        FROM platform_games p JOIN connected_accounts a ON a.id = p.connected_account_id WHERE a.user_id = ?`).all(me.id),
    };
    sendJson(res, 200, data, { 'Content-Disposition': `attachment; filename="asobi-${me.username}-${data.exportedAt.slice(0, 10)}.json"` });
  });

  r.add('DELETE', '/api/me', async ({ user, body, req, res }) => {
    const me = auth.requireUserRow(user);
    if ((await body()).confirm !== me.username) throw new HttpError(400, 'Tape ton identifiant pour confirmer la suppression.');
    const discordAccount = db.prepare("SELECT id FROM connected_accounts WHERE user_id = ? AND provider = 'discord'").get(me.id);
    if (discordAccount) await accounts.disconnect(ctx, me.id, discordAccount.id); // révoque l'accès chez Discord
    db.prepare('DELETE FROM users WHERE id = ?').run(me.id); // tout le reste part en cascade
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.destroySession(ctx, req) });
  });

  /* ---------- Collection ---------- */

  r.add('GET', '/api/collection', ({ user }) => {
    const me = auth.requireUserRow(user);
    return { user: publicUser(me), ...collection.readCollection(db, me.id) };
  });
  r.add('POST', '/api/games', async ({ user, body }) => ({ game: await collection.addGame(db, env, auth.requireUserRow(user).id, await body()) }));
  r.add('PATCH', '/api/games/:id', async ({ user, params, body }) => ({ game: collection.patchGame(db, auth.requireUserRow(user).id, params.id, await body()) }));
  r.add('DELETE', '/api/games/:id', ({ user, params }) => { collection.removeGame(db, auth.requireUserRow(user).id, params.id); return { ok: true }; });
  r.add('POST', '/api/games/:id/match', async ({ user, params, body }) => ({ game: await collection.matchGame(db, env, auth.requireUserRow(user).id, params.id, (await body()).igdbId) }));
  r.add('POST', '/api/wishlist', async ({ user, body }) => ({ item: await collection.addWishlist(db, env, auth.requireUserRow(user).id, await body()) }));
  r.add('DELETE', '/api/wishlist/:igdbId', ({ user, params }) => { collection.removeWishlist(db, auth.requireUserRow(user).id, params.igdbId); return { ok: true }; });
  r.add('PUT', '/api/playlist', async ({ user, body }) => ({ playlist: collection.setPlaylist(db, auth.requireUserRow(user).id, (await body()).ids) }));
  r.add('PATCH', '/api/settings', async ({ user, body }) => {
    const me = auth.requireUserRow(user);
    const settings = collection.patchSettings(db, me.id, await body());
    return { settings, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(me.id)) };
  });

  /* ---------- Comptes connectés ---------- */

  r.add('GET', '/api/accounts', ({ user }) => accounts.listAccounts(ctx, auth.requireUserRow(user).id));

  r.add('POST', '/api/accounts/discover', async ({ user }) => {
    const me = auth.requireUserRow(user);
    limit(`discover:${me.id}`, 10);
    return accounts.discover(ctx, me.id);
  });

  // Steam OpenID : prouver qu'un compte Steam est à soi (quand Discord ne l'a pas vérifié, ou sans Discord)
  r.add('GET', '/api/accounts/steam/openid/start', ({ user, res }) => {
    const me = auth.requireUserRow(user);
    const flow = auth.beginRedirectFlow(ctx, { provider: 'steam', purpose: 'link', userId: me.id, next: '#/comptes' });
    redirect(res, steamApi.openIdUrl(config, flow.state), { 'Set-Cookie': flow.cookie });
  });
  r.add('GET', '/api/accounts/steam/openid/callback', async ({ user, url, req, res }) => {
    const me = auth.requireUserRow(user);
    const flow = auth.consumeRedirectFlow(ctx, req, 'steam', url.searchParams.get('state'));
    if (flow.user_id !== me.id) throw new HttpError(400, 'Vérification lancée depuis un autre compte.');
    let result = 'steam=verifie';
    try {
      accounts.linkVerifiedSteam(ctx, me.id, await steamApi.verifyOpenId(config, url.searchParams));
    } catch (err) {
      result = err.status === 409 ? 'steam=deja-pris' : 'steam=refuse';
    }
    redirect(res, `/#/comptes?${result}`, { 'Set-Cookie': auth.clearFlowCookie(ctx) });
  });

  const accountAndProvider = (user, id) => {
    const me = auth.requireUserRow(user);
    const account = accounts.getAccount(ctx, me.id, id);
    const provider = getProvider(account.provider);
    return { me, account, provider };
  };
  const needs = (provider, capability, method) => {
    if (!provider?.capabilities[capability] || !provider[method]) throw new HttpError(400, `${provider?.name ?? 'Cette plateforme'} ne permet pas cette action.`);
    if (!provider.enabled(config)) throw new HttpError(501, `${provider.name} n'est pas configuré sur ce serveur.`);
  };

  r.add('POST', '/api/accounts/:id/enable', async ({ user, params }) => {
    const { me, account, provider } = accountAndProvider(user, params.id);
    needs(provider, 'library', 'enable');
    await provider.enable(ctx, account);
    return accounts.listAccounts(ctx, me.id);
  });

  r.add('POST', '/api/accounts/:id/sync', ({ user, params }) => {
    const { me, account, provider } = accountAndProvider(user, params.id);
    needs(provider, 'sync', 'sync');
    if (![ACCOUNT_STATUS.CONNECTED, ACCOUNT_STATUS.SYNCED, ACCOUNT_STATUS.ERROR].includes(account.status) || !account.verified) {
      throw new HttpError(409, 'Active d\'abord l\'import pour ce compte.');
    }
    limit(`job:${me.id}`, 10);
    return { job: startJob(ctx, { userId: me.id, account, provider: provider.id, kind: 'sync' }, (job) => provider.sync(ctx, account, job)) };
  });

  r.add('GET', '/api/accounts/:id/library', async ({ user, params }) => {
    const { account, provider } = accountAndProvider(user, params.id);
    needs(provider, 'library', 'library');
    if (!account.verified) throw new HttpError(403, 'Vérifie d\'abord ce compte.');
    return { results: await provider.library(ctx, account) };
  });

  r.add('POST', '/api/accounts/:id/import', async ({ user, params, body }) => {
    const { me, account, provider } = accountAndProvider(user, params.id);
    needs(provider, 'library', 'importGames');
    if (!account.verified) throw new HttpError(403, 'Vérifie d\'abord ce compte.');
    const wanted = (await body()).ids;
    if (!Array.isArray(wanted) || !wanted.length) throw new HttpError(400, 'Choisis au moins un jeu.');
    limit(`job:${me.id}`, 10);
    return { job: startJob(ctx, { userId: me.id, account, provider: provider.id, kind: 'import' }, (job) => provider.importGames(ctx, account, wanted.slice(0, 2000), job)) };
  });

  r.add('PATCH', '/api/accounts/:id', async ({ user, params, body }) => {
    const { me, account } = accountAndProvider(user, params.id);
    const patch = await body();
    if ('autoSync' in patch) db.prepare('UPDATE connected_accounts SET auto_sync = ? WHERE id = ?').run(patch.autoSync ? 1 : 0, account.id);
    return accounts.listAccounts(ctx, me.id);
  });

  r.add('DELETE', '/api/accounts/:id', async ({ user, params }) => {
    const me = auth.requireUserRow(user);
    await accounts.disconnect(ctx, me.id, params.id);
    return accounts.listAccounts(ctx, me.id);
  });

  r.add('GET', '/api/jobs/:id', ({ user, params }) => ({ job: getJob(db, auth.requireUserRow(user).id, params.id) }));

  /* ---------- Traitement d'une requête ---------- */

  return async function handle(req, res) {
    const url = new URL(req.url, config.publicUrl);
    const path = url.pathname;
    const ip = clientIp(req, config.trustProxy);
    try {
      if (!path.startsWith('/api/')) {
        if (['GET', 'HEAD'].includes(req.method) && (await serveStatic(req, res, path))) return;
        throw new HttpError(404, 'Page introuvable.');
      }

      const match = r.match(req.method, path);
      if (!match) throw new HttpError(404, 'Introuvable.');
      if (match.notAllowed) throw new HttpError(405, 'Méthode non autorisée.');

      if (!['GET', 'HEAD'].includes(req.method)) {
        // Anti-CSRF : en-tête propre au site, même origine, jamais depuis un autre site
        const origin = req.headers.origin;
        if (req.headers['x-asobi'] !== '1' || (origin && origin !== config.origin) || req.headers['sec-fetch-site'] === 'cross-site') {
          throw new HttpError(403, 'Requête refusée.');
        }
      }
      limit(`${ip}:${path.startsWith('/api/auth/') ? 'auth' : req.method === 'GET' ? 'read' : 'write'}`,
        path.startsWith('/api/auth/') ? 30 : req.method === 'GET' ? 300 : 240);

      const user = auth.currentUser(ctx, req);
      let bodyCache;
      const body = () => (bodyCache ??= readJson(req));
      const result = await match.handler({ req, res, url, params: match.params, user, body, ip });
      if (!res.headersSent && result !== undefined) sendJson(res, 200, result);
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      const status = err.status ?? 500;
      if (status >= 500) ctx.log?.(`${req.method} ${path} : ${err.stack ?? err.message}`);
      // Erreur pendant une redirection (connexion) : retour au site avec un message plutôt qu'une page JSON
      if (req.method === 'GET' && (path.startsWith('/api/auth/') || path.includes('/openid/'))) {
        redirect(res, `/#/?erreur=${encodeURIComponent(err.status ? err.message : 'Le serveur a rencontré un problème.')}`);
        return;
      }
      // Seules nos erreurs prévues (avec un statut) ont un message montrable ; le reste reste dans le journal
      sendJson(res, status, { error: err.status ? err.message : 'Le serveur a rencontré un problème.', code: err.code },
        err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {});
    }
  };
}
