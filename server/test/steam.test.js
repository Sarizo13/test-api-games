// Import et synchronisation Steam : profil privé, import, correspondances, doublons, préservation des données personnelles.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, fakeDiscord, fakeIgdb, fakeSteam, login, DISCORD_USER, STEAM_ID } from './helpers.js';

const OWNED = [
  { appid: 620, name: 'Portal 2', playtime_forever: 840, rtime_last_played: 1700000000 },
  { appid: 1145350, name: 'Hades II', playtime_forever: 2280 },
  { appid: 999001, name: 'Petit jeu inconnu', playtime_forever: 0 },
  { appid: 400, name: 'Portal', playtime_forever: 60 },
];
const GAMES = {
  72: { name: 'Portal 2', platforms: [{ name: 'PC (Microsoft Windows)' }] },
  228525: { name: 'Hades II', platforms: [{ name: 'PC (Microsoft Windows)' }] },
};

let t;
let steamSeen;
let b;
let steamAccount;
before(async () => {
  t = await startTestServer();
  fakeDiscord(t.net, { user: DISCORD_USER, connections: [{ type: 'steam', id: STEAM_ID, name: 'Sarizo', verified: true }] });
  // Portal 2 et Hades II ont un lien officiel IGDB ; « Portal » n'en a pas (et IGDB ne connaît que « Portal 2 »)
  fakeIgdb(t.net, { games: GAMES, steam: { 620: 72, 1145350: 228525 } });
  steamSeen = fakeSteam(t.net, { owned: OWNED, achievements: { 620: [51, 51], 1145350: [12, 50] } });
  ({ b } = await login(t, DISCORD_USER));
  steamAccount = (await b.get('/api/accounts')).data.accounts.find((a) => a.provider === 'steam');
});
after(() => t.close());

test('profil Steam privé : erreur claire, compte en erreur, pas de faux « connecté »', async () => {
  steamSeen.private = true;
  const res = await b.post(`/api/accounts/${steamAccount.id}/enable`);
  assert.equal(res.status, 403);
  assert.match(res.data.error, /Détails des jeux/);
  const acc = (await b.get('/api/accounts')).data.accounts.find((a) => a.provider === 'steam');
  assert.equal(acc.status, 'error');
  assert.equal((await b.post(`/api/accounts/${steamAccount.id}/sync`)).status, 200); // une erreur se réessaie…
  await t.ctx.pending;
  assert.equal((await b.get('/api/accounts')).data.accounts.find((a) => a.provider === 'steam').status, 'error'); // …et échoue encore
  steamSeen.private = false;
});

test('activation puis bibliothèque : les jeux pas encore dans la collection, les plus joués d\'abord', async () => {
  const en = await b.post(`/api/accounts/${steamAccount.id}/enable`);
  assert.equal(en.status, 200);
  assert.equal(en.data.accounts.find((a) => a.provider === 'steam').status, 'connected');
  const lib = await b.get(`/api/accounts/${steamAccount.id}/library`);
  assert.deepEqual(lib.data.results.map((g) => g.id), ['1145350', '620', '400', '999001']);
});

test('import : correspondance officielle → fiche IGDB ; sans correspondance fiable → gardé à associer à la main', async () => {
  const res = await b.post(`/api/accounts/${steamAccount.id}/import`, { ids: ['620', '1145350', '999001', '400'] });
  assert.equal(res.status, 200);
  await t.ctx.pending;
  const job = (await b.get(`/api/jobs/${res.data.job.id}`)).data.job;
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual({ added: job.stats.added, unmatched: job.stats.unmatched, failed: job.stats.failed }, { added: 2, unmatched: 2, failed: 0 });

  const { games } = (await b.get('/api/collection')).data;
  const portal2 = games.find((g) => g.steamAppId === 620);
  assert.equal(portal2.igdbId, 72);
  assert.equal(portal2.platform, 'PC');
  assert.equal(portal2.playtimeMinutes, 840);
  assert.equal(portal2.playtimeSource, 'steam');
  assert.equal(portal2.status, 'playing');                 // joué → en cours, à la création seulement
  assert.equal(portal2.startedAt, null);                   // date de début inconnue : pas inventée
  assert.deepEqual(portal2.achievements, { unlocked: 51, total: 51, percent: 100, source: 'steam' });
  // « Portal » ne doit pas être fusionné avec « Portal 2 » sur une ressemblance de titre
  const portal = games.find((g) => g.steamAppId === 400);
  assert.equal(portal.igdbId, null);
  assert.equal(portal.matchStatus, 'unmatched');
  assert.equal(games.find((g) => g.steamAppId === 999001).status, 'backlog');
});

test('réimporter les mêmes jeux ne crée aucun doublon', async () => {
  const before = (await b.get('/api/collection')).data.games.length;
  const res = await b.post(`/api/accounts/${steamAccount.id}/import`, { ids: ['620', '1145350'] });
  await t.ctx.pending;
  const job = (await b.get(`/api/jobs/${res.data.job.id}`)).data.job;
  assert.equal(job.stats.skipped, 2);
  assert.equal((await b.get('/api/collection')).data.games.length, before);
});

test('on ne peut importer que des jeux possédés par ce compte Steam', async () => {
  const res = await b.post(`/api/accounts/${steamAccount.id}/import`, { ids: ['730'] }); // pas dans la bibliothèque
  await t.ctx.pending;
  const job = (await b.get(`/api/jobs/${res.data.job.id}`)).data.job;
  assert.equal(job.stats.added + job.stats.unmatched + job.stats.skipped, 0);
});

test('synchro : ne touche jamais au statut ni aux valeurs saisies à la main, ne supprime rien', async () => {
  const games = (await b.get('/api/collection')).data.games;
  const portal2 = games.find((g) => g.steamAppId === 620);
  const hades = games.find((g) => g.steamAppId === 1145350);
  // L'utilisateur termine Portal 2 et corrige le temps de jeu de Hades II
  await b.patch(`/api/games/${portal2.id}`, { status: 'finished' });
  await b.patch(`/api/games/${hades.id}`, { playtimeMinutes: 5000, achievements: { percent: 90 } });

  // Steam renvoie de nouveaux chiffres, et « Petit jeu inconnu » a disparu de la réponse
  OWNED[0].playtime_forever = 900;
  OWNED[1].playtime_forever = 2400;
  OWNED.splice(2, 1);

  const res = await b.post(`/api/accounts/${steamAccount.id}/sync`);
  assert.equal(res.status, 200);
  await t.ctx.pending;
  const job = (await b.get(`/api/jobs/${res.data.job.id}`)).data.job;
  assert.equal(job.status, 'done', job.error);

  const after = (await b.get('/api/collection')).data.games;
  const p2 = after.find((g) => g.steamAppId === 620);
  assert.equal(p2.status, 'finished');                     // pas repassé « en cours »
  assert.equal(p2.playtimeMinutes, 900);                   // donnée de la plateforme : mise à jour
  const h2 = after.find((g) => g.steamAppId === 1145350);
  assert.equal(h2.playtimeMinutes, 5000);                  // saisi à la main : conservé
  assert.equal(h2.playtimeSource, 'manual');
  assert.deepEqual(h2.achievements, { percent: 90, source: 'manual' });
  assert.ok(after.find((g) => g.steamAppId === 999001), 'un jeu absent de la réponse Steam reste dans la collection');

  const acc = (await b.get('/api/accounts')).data.accounts.find((a) => a.provider === 'steam');
  assert.equal(acc.status, 'synced');
  assert.ok(acc.lastSyncAt);
  // Données brutes de Steam gardées à part, avec les succès
  const raw = t.db.prepare("SELECT * FROM platform_games WHERE external_game_id = '1145350'").get();
  assert.equal(raw.playtime_minutes, 2400);
  assert.equal(raw.achievements_total, 50);
});

test('association manuelle d\'un jeu importé sans correspondance', async () => {
  const portal = (await b.get('/api/collection')).data.games.find((g) => g.steamAppId === 400);
  const clash = await b.post(`/api/games/${portal.id}/match`, { igdbId: 72 }); // Portal 2 déjà présent sur PC
  assert.equal(clash.status, 409);
  const target = 71;
  t.net.on(/api\.igdb\.com\/v4\/games/, (url, init) => (String(init.body).includes(`where id = ${target}`) ? [{ id: target, name: 'Portal' }] : []));
  const res = await b.post(`/api/games/${portal.id}/match`, { igdbId: target });
  assert.equal(res.status, 200);
  assert.equal(res.data.game.igdbId, 71);
  assert.equal(res.data.game.matchStatus, 'matched');
  const mapping = t.db.prepare("SELECT * FROM external_games WHERE provider = 'steam' AND external_game_id = '400'").get();
  assert.equal(mapping.confidence, 'manual');
});

test('déconnecter Steam efface les données brutes mais garde les jeux de la collection', async () => {
  const before = (await b.get('/api/collection')).data.games.length;
  const res = await b.del(`/api/accounts/${steamAccount.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.accounts.some((a) => a.provider === 'steam'), false);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM platform_games').get().n, 0);
  assert.equal((await b.get('/api/collection')).data.games.length, before);
});

test('aucun appel réseau imprévu', () => {
  assert.deepEqual(t.net.unexpected.filter((u) => !/store\.steampowered\.com|wikidata|wikipedia/.test(u)), []);
  assert.ok(steamSeen.achievements > 0);
});
