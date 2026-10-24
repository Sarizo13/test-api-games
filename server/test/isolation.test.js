// Cloisonnement entre utilisateurs : personne ne peut lire ou modifier la collection, les comptes
// ou les tâches d'un autre ; un profil privé ne se voit pas.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, fakeDiscord, fakeIgdb, login, browser, DISCORD_USER, OTHER_USER } from './helpers.js';

let t;
let alice;
let bob;
let discord;
let aliceGame;
before(async () => {
  t = await startTestServer();
  discord = fakeDiscord(t.net, { user: DISCORD_USER, connections: [{ type: 'xbox', id: 'x1', name: 'AliceXbox', verified: true }] });
  fakeIgdb(t.net, { games: { 119133: { name: 'Elden Ring', platforms: [{ name: 'PlayStation 5' }] } } });
  ({ b: alice } = await login(t, DISCORD_USER));
  discord.set({ user: OTHER_USER, connections: [] });
  ({ b: bob } = await login(t, OTHER_USER));
  aliceGame = (await alice.post('/api/games', { igdbId: 119133, platform: 'PlayStation 5' })).data.game;
});
after(() => t.close());

test('ajout d\'un jeu par son propriétaire', () => {
  assert.equal(aliceGame.id, 'elden-ring-ps5');
  assert.equal(aliceGame.status, 'backlog');
});

test('un autre utilisateur ne peut ni modifier ni supprimer ce jeu', async () => {
  assert.equal((await bob.patch(`/api/games/${aliceGame.id}`, { status: 'dropped' })).status, 404);
  assert.equal((await bob.del(`/api/games/${aliceGame.id}`)).status, 404);
  assert.equal((await alice.get('/api/collection')).data.games[0].status, 'backlog');
  assert.equal((await bob.get('/api/collection')).data.games.length, 0);
});

test('un autre utilisateur ne voit ni les comptes ni les tâches d\'Alice', async () => {
  const xbox = (await alice.get('/api/accounts')).data.accounts.find((a) => a.provider === 'xbox');
  assert.equal((await bob.del(`/api/accounts/${xbox.id}`)).status, 404);
  assert.equal((await bob.post(`/api/accounts/${xbox.id}/sync`)).status, 404);
  const { lastInsertRowid } = t.db.prepare("INSERT INTO sync_jobs (user_id, provider, kind, status, started_at) VALUES ((SELECT id FROM users WHERE username = 'sarizo'), 'steam', 'sync', 'done', ?)").run(new Date().toISOString());
  assert.equal((await bob.get(`/api/jobs/${lastInsertRowid}`)).status, 404);
  assert.equal((await alice.get(`/api/jobs/${lastInsertRowid}`)).status, 200);
});

test('profil privé par défaut, visible une fois rendu public', async () => {
  const visitor = browser(t.base);
  assert.equal((await visitor.get('/api/users/sarizo')).status, 404);
  assert.equal((await bob.get('/api/users/sarizo')).status, 404);
  assert.equal((await alice.get('/api/users/sarizo')).status, 200); // soi-même
  await alice.patch('/api/settings', { profilePublic: true });
  const pub = await visitor.get('/api/users/sarizo');
  assert.equal(pub.status, 200);
  assert.equal(pub.data.games.length, 1);
  assert.equal(pub.data.user.username, 'sarizo');
  assert.equal(JSON.stringify(pub.data).includes('discord_id'), false); // rien d'interne
  // Un visiteur ne peut rien écrire
  assert.equal((await visitor.patch(`/api/games/${aliceGame.id}`, { status: 'dropped' })).status, 401);
});

test('amis : pseudos validés, sans soi-même, et liste jamais visible sur le profil public', async () => {
  const res = await alice.patch('/api/settings', { friends: ['Rival', 'rival', 'sarizo', '../admin', 'x'.repeat(40), 'mila.42'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.settings.friends, ['rival', 'mila.42']);
  assert.deepEqual((await alice.get('/api/collection')).data.settings.friends, ['rival', 'mila.42']);
  const pub = await browser(t.base).get('/api/users/sarizo');
  assert.equal(pub.status, 200);
  assert.equal(JSON.stringify(pub.data).includes('mila.42'), false);
  assert.deepEqual(Object.keys(pub.data.settings), ['name']);
});

test('les données personnelles sont validées', async () => {
  const bad = await alice.patch(`/api/games/${aliceGame.id}`, { status: 'pirate' });
  assert.equal(bad.status, 400);
  const res = await alice.patch(`/api/games/${aliceGame.id}`, { ratings: { gameplay: 8.3, story: 42, hack: 5 }, review: 'x'.repeat(6000) });
  assert.deepEqual(res.data.game.ratings, { gameplay: 8.5 });
  assert.equal(res.data.game.review.length, 5000);
});

test('doublon refusé, export RGPD complet', async () => {
  const dup = await alice.post('/api/games', { igdbId: 119133, platform: 'PS5' });
  assert.equal(dup.status, 409);
  const exp = await alice.get('/api/me/export');
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  assert.equal(exp.data.games.length, 1);
  assert.ok(Array.isArray(exp.data.accounts));
});
