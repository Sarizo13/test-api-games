// Découverte des comptes de jeu via les connexions Discord, renouvellement et expiration des jetons.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, fakeDiscord, login, DISCORD_USER, OTHER_USER, STEAM_ID } from './helpers.js';

const CONNECTIONS = [
  { type: 'steam', id: STEAM_ID, name: 'Sarizo', verified: true },
  { type: 'xbox', id: '2535', name: 'SarizoXbox', verified: true },
  { type: 'playstation', id: 'psn-1', name: 'Sarizo_PSN', verified: false },
  { type: 'epicgames', id: 'epic-1', name: 'SarizoEpic', verified: true },
  { type: 'spotify', id: 'sp-1', name: 'music', verified: true },            // pas une plateforme de jeu : ignorée
  { type: 'battlenet', id: 'bn-1', name: 'Sar#123', verified: true, revoked: true }, // révoquée : ignorée
];

let t;
let discord;
before(async () => {
  t = await startTestServer();
  discord = fakeDiscord(t.net, { user: DISCORD_USER, connections: CONNECTIONS });
});
after(() => t.close());

const byProvider = (data) => Object.fromEntries(data.accounts.map((a) => [a.provider, a]));

test('à la connexion, les comptes de jeu liés à Discord sont détectés (et seulement eux)', async () => {
  const { b } = await login(t, DISCORD_USER);
  const res = await b.get('/api/accounts');
  const acc = byProvider(res.data);
  assert.deepEqual(Object.keys(acc).sort(), ['discord', 'epicgames', 'playstation', 'steam', 'xbox']);
  // Steam vérifié par Discord : détecté, prêt à importer — mais pas « connecté » tant que l'accès n'est pas vérifié
  assert.equal(acc.steam.status, 'detected');
  assert.equal(acc.steam.verified, true);
  // Connecteurs non officiels : détecté si Discord a vérifié le compte, sinon preuve demandée ; jamais « connecté » d'office
  assert.equal(acc.xbox.status, 'detected');
  assert.equal(acc.playstation.status, 'authorization_required');
  assert.equal(acc.playstation.verified, false);
  assert.equal(acc.epicgames.status, 'authorization_required'); // il faut coller un code Epic
  // Les capacités annoncées sont honnêtes, et le caractère non officiel affiché
  const steam = res.data.providers.find((p) => p.id === 'steam');
  assert.equal(steam.capabilities.library, true);
  assert.equal(steam.experimental, false);
  const xbox = res.data.providers.find((p) => p.id === 'xbox');
  assert.equal(xbox.capabilities.library, true);
  assert.equal(xbox.experimental, true);
  assert.equal(xbox.enabled, false); // pas de clé OpenXBL sur ce serveur de test
  assert.match(xbox.limitations, /non officiel/);
  assert.equal(res.data.providers.find((p) => p.id === 'epicgames').link, 'code');
  assert.equal(res.data.providers.find((p) => p.id === 'nintendo').link, 'paste-link');
});

test('un compte Steam non vérifié par Discord demande une preuve de propriété', async () => {
  discord.set({ connections: [{ type: 'steam', id: STEAM_ID, name: 'Sarizo', verified: false }] });
  const user = { ...DISCORD_USER, id: '333333333333333333', username: 'nonverif' };
  discord.set({ user });
  const { b } = await login(t, user);
  const acc = byProvider((await b.get('/api/accounts')).data);
  assert.equal(acc.steam.status, 'authorization_required');
  assert.equal(acc.steam.verified, false);
  // Impossible d'importer sans preuve
  const lib = await b.get(`/api/accounts/${acc.steam.id}/library`);
  assert.equal(lib.status, 403);
  discord.set({ user: DISCORD_USER, connections: CONNECTIONS });
});

test('un compte Steam vérifié ne peut appartenir qu\'à un seul utilisateur', async () => {
  discord.set({ user: OTHER_USER, connections: [{ type: 'steam', id: STEAM_ID, name: 'Imposteur', verified: true }] });
  const { b } = await login(t, OTHER_USER);
  const acc = byProvider((await b.get('/api/accounts')).data);
  assert.equal(acc.steam.verified, false);
  assert.equal(acc.steam.status, 'authorization_required');
  assert.match(acc.steam.message, /autre utilisateur/);
  discord.set({ user: DISCORD_USER, connections: CONNECTIONS });
});

test('redécouverte : jeton expiré → renouvelé automatiquement ; refresh refusé → reconnexion demandée', async () => {
  const { b } = await login(t, DISCORD_USER);
  const discordAccount = t.db.prepare("SELECT a.id FROM connected_accounts a JOIN users u ON u.id = a.user_id WHERE u.username = 'sarizo' AND provider = 'discord'").get();
  t.db.prepare('UPDATE provider_credentials SET expires_at = ? WHERE connected_account_id = ?').run(new Date(Date.now() - 1000).toISOString(), discordAccount.id);

  const refreshes = discord.seen.refresh;
  const ok = await b.post('/api/accounts/discover');
  assert.equal(ok.status, 200);
  assert.equal(discord.seen.refresh, refreshes + 1);

  // Le refresh token ne marche plus (accès révoqué depuis Discord)
  const { encrypt } = await import('../src/security.js');
  t.db.prepare('UPDATE provider_credentials SET expires_at = ?, encrypted_refresh_token = ? WHERE connected_account_id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), encrypt(t.ctx.key, 'revoked'), discordAccount.id);
  const expired = await b.post('/api/accounts/discover');
  assert.equal(expired.status, 401);
  assert.equal(expired.data.code, 'discord_reauth');
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM provider_credentials WHERE connected_account_id = ?').get(discordAccount.id).n, 0);

  // Se reconnecter rétablit l'accès
  const again = await login(t, DISCORD_USER);
  assert.equal((await again.b.post('/api/accounts/discover')).status, 200);
});

test('un compte qui disparaît de Discord n\'est pas supprimé ; un compte déjà importable ne régresse pas', async () => {
  const { b } = await login(t, DISCORD_USER);
  const steam = t.db.prepare("SELECT a.id FROM connected_accounts a JOIN users u ON u.id = a.user_id WHERE u.username = 'sarizo' AND provider = 'steam'").get();
  t.db.prepare("UPDATE connected_accounts SET status = 'synced' WHERE id = ?").run(steam.id);
  discord.set({ connections: [] });
  const acc = byProvider((await b.post('/api/accounts/discover')).data);
  assert.ok(acc.steam, 'toujours là');
  assert.equal(acc.steam.status, 'synced');
  discord.set({ connections: CONNECTIONS });
});
