// Connexion Discord (OAuth2), paramètre « state », sessions, protection CSRF.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, browser, fakeDiscord, login, DISCORD_USER } from './helpers.js';
import { safeNext } from '../src/auth.js';

let t;
let discord;
before(async () => {
  t = await startTestServer();
  discord = fakeDiscord(t.net, { user: DISCORD_USER, connections: [] });
});
after(() => t.close());

test('la connexion redirige vers Discord avec les bons scopes et un state', async () => {
  const b = browser(t.base);
  const res = await b.get('/api/auth/discord/login');
  assert.equal(res.status, 302);
  const url = new URL(res.location);
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('scope'), 'identify connections');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://asobi.test/api/auth/discord/callback');
  assert.ok(url.searchParams.get('state').length >= 24);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('asobi_oauth='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test('connexion complète : utilisateur créé, session en cookie HttpOnly, jeton Discord chiffré en base', async () => {
  const { b, done } = await login(t, DISCORD_USER);
  assert.equal(done.status, 302);
  assert.equal(done.location, '/#/consoles');
  const session = done.headers.getSetCookie().find((c) => c.startsWith('asobi_sid='));
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);

  const me = await b.get('/api/me');
  assert.equal(me.data.user.username, 'sarizo');
  assert.equal(me.data.user.profilePublic, false); // privé par défaut

  const cred = t.db.prepare('SELECT * FROM provider_credentials').get();
  assert.ok(cred.encrypted_token.startsWith('v1.'));
  assert.ok(!cred.encrypted_token.includes('access-'), 'le jeton ne doit jamais être stocké en clair');
  const sessionRow = t.db.prepare('SELECT token_hash FROM sessions').get();
  assert.equal(sessionRow.token_hash.length, 64); // empreinte SHA-256, pas le jeton
});

test('un state absent, inconnu, rejoué ou venu d\'un autre navigateur est refusé', async () => {
  const b = browser(t.base);
  const start = await b.get('/api/auth/discord/login');
  const state = new URL(start.location).searchParams.get('state');

  const stranger = browser(t.base); // autre navigateur : pas le cookie asobi_oauth
  const foreign = await stranger.get(`/api/auth/discord/callback?code=code-${DISCORD_USER.id}&state=${state}`);
  assert.equal(foreign.status, 302);
  assert.match(decodeURIComponent(foreign.location), /erreur=Connexion expirée/);
  assert.equal(foreign.headers.getSetCookie().some((c) => c.startsWith('asobi_sid=')), false);

  const forged = await b.get(`/api/auth/discord/callback?code=code-${DISCORD_USER.id}&state=forged`);
  assert.match(decodeURIComponent(forged.location), /erreur=/);

  // Le bon navigateur peut l'utiliser une fois… mais pas deux
  const legit = await b.get(`/api/auth/discord/callback?code=code-${DISCORD_USER.id}&state=${state}`);
  assert.equal(legit.location, '/#/');
  const replay = await b.get(`/api/auth/discord/callback?code=code-${DISCORD_USER.id}&state=${state}`);
  assert.match(decodeURIComponent(replay.location), /erreur=/);
});

test('un state expiré est refusé', async () => {
  const b = browser(t.base);
  const start = await b.get('/api/auth/discord/login');
  const state = new URL(start.location).searchParams.get('state');
  t.db.prepare('UPDATE oauth_states SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
  const res = await b.get(`/api/auth/discord/callback?code=code-${DISCORD_USER.id}&state=${state}`);
  assert.match(decodeURIComponent(res.location), /erreur=Connexion expirée/);
});

test('refus sur la page Discord : retour au site sans session', async () => {
  const b = browser(t.base);
  await b.get('/api/auth/discord/login');
  const res = await b.get('/api/auth/discord/callback?error=access_denied');
  assert.equal(res.location, '/#/?connexion=annulee');
  assert.equal((await b.get('/api/me')).data.user, null);
});

test('les écritures exigent l\'en-tête du site et la même origine (CSRF)', async () => {
  const { b } = await login(t, DISCORD_USER);
  const noHeader = await b.patch('/api/settings', { name: 'x' }, { headers: { 'X-Asobi': undefined } });
  assert.equal(noHeader.status, 403);
  const foreign = await b.patch('/api/settings', { name: 'x' }, { headers: { 'X-Asobi': '1', Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  const crossSite = await b.patch('/api/settings', { name: 'x' }, { headers: { 'X-Asobi': '1', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const ok = await b.patch('/api/settings', { name: 'Théo' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.settings.name, 'Théo');
});

test('déconnexion : la session est détruite', async () => {
  const { b } = await login(t, DISCORD_USER);
  assert.ok((await b.get('/api/me')).data.user);
  const out = await b.post('/api/auth/logout');
  assert.equal(out.status, 200);
  assert.equal((await b.get('/api/me')).data.user, null);
});

test('adresse de retour : seulement une page du site', () => {
  assert.equal(safeNext('#/jeu/elden-ring-ps5'), '#/jeu/elden-ring-ps5');
  assert.equal(safeNext('https://evil.example'), '#/');
  assert.equal(safeNext('//evil.example'), '#/');
  assert.equal(safeNext('#/"><script>'), '#/');
  assert.equal(safeNext(undefined), '#/');
});

test('suppression du compte : tout est effacé et l\'accès Discord révoqué', async () => {
  const user = { ...DISCORD_USER, id: '999999999999999999', username: 'aeffacer' };
  discord.set({ user });
  const { b } = await login(t, user);
  const refused = await b.del('/api/me', { confirm: 'mauvais' });
  assert.equal(refused.status, 400);
  const revokesBefore = discord.seen.revoke;
  const res = await b.del('/api/me', { confirm: 'aeffacer' });
  assert.equal(res.status, 200);
  assert.equal(discord.seen.revoke, revokesBefore + 1);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM users WHERE username = ?').get('aeffacer').n, 0);
  assert.equal((await b.get('/api/me')).data.user, null);
  discord.set({ user: DISCORD_USER });
});
