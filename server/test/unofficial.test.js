// Connecteurs non officiels : PlayStation (NPSSO du serveur), Xbox (OpenXBL), Epic (code collé). Nintendo : ajout manuel.
// Toutes les plateformes sont simulées : on vérifie les règles d'Asobi (preuve de propriété, confidentialité,
// pas de doublon, pas d'écrasement des données personnelles, jetons chiffrés, liaison à usage unique).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, fakeDiscord, fakeIgdb, login, browser, json, DISCORD_USER, OTHER_USER } from './helpers.js';
import { resetSession, durationMinutes } from '../src/integrations/playstation/index.js';
import { xboxPlatform } from '../src/integrations/xbox/index.js';

const IGDB = {
  1001: { name: 'Astro Bot', platforms: [{ name: 'PlayStation 5' }] },
  1002: { name: 'Bloodborne', platforms: [{ name: 'PlayStation 4' }] },
  2001: { name: 'Hades', platforms: [{ name: 'PC (Microsoft Windows)' }] },
  2002: { name: 'Fortnite', platforms: [{ name: 'PC (Microsoft Windows)' }] },
  4001: { name: 'Halo Infinite', platforms: [{ name: 'Xbox Series X|S' }] },
};

/* ---------- Plateformes simulées ---------- */

function fakePsn(net) {
  const seen = { private: false, npssoValid: true, authorize: 0, bearer: new Set() };
  const titles = [
    { titleId: 'PPSA01', name: 'Astro Bot', localizedName: 'ASTRO BOT', category: 'ps5_native_game', playDuration: 'PT12H30M', firstPlayedDateTime: '2024-09-06T10:00:00Z', lastPlayedDateTime: '2024-10-01T20:00:00Z', imageUrl: 'https://image.api.playstation.com/astro.png' },
    { titleId: 'CUSA02', name: 'Bloodborne™', category: 'ps4_game', playDuration: 'PT80H', firstPlayedDateTime: '2015-03-25T10:00:00Z', lastPlayedDateTime: '2023-01-01T10:00:00Z' },
    { titleId: 'PPSA03', name: 'Jeu obscur', category: 'ps5_native_game', playDuration: 'PT0S' },
  ];
  net.on(/ca\.account\.sony\.com\/api\/authz\/v3\/oauth\/authorize/, (url, init) => {
    seen.authorize++;
    const ok = seen.npssoValid && init.headers?.Cookie === 'npsso=npsso-test';
    return new Response(null, { status: 302, headers: { Location: ok ? 'com.scee.psxandroid.scecompcall://redirect/?code=v3.abc&cid=x' : 'https://ca.account.sony.com/error' } });
  });
  net.on(/ca\.account\.sony\.com\/api\/authz\/v3\/oauth\/token/, () => ({ access_token: 'psn-access', expires_in: 3600, refresh_token: 'psn-refresh', refresh_token_expires_in: 5_000_000 }));
  net.on(/us-prof\.np\.community\.playstation\.net\/userProfile\/v1\/users\/Sarizo_PSN\/profile2/, () => ({ profile: { onlineId: 'Sarizo_PSN', accountId: '8888' } }));
  net.on(/m\.np\.playstation\.com\/api\/gamelist\/v2\/users\/8888\/titles/, (url, init) => {
    seen.bearer.add(init.headers?.Authorization);
    return seen.private ? json({ error: { code: 2240526, message: 'Not permitted' } }, 403) : { titles, totalItemCount: titles.length };
  });
  net.on(/m\.np\.playstation\.com\/api\/trophy\/v1\/users\/8888\/trophyTitles/, () => ({
    trophyTitles: [{ trophyTitleName: 'ASTRO BOT', trophyTitlePlatform: 'PS5', progress: 48, definedTrophies: { bronze: 40, silver: 6, gold: 2, platinum: 1 }, earnedTrophies: { bronze: 20, silver: 3, gold: 1, platinum: 0 } }],
    totalItemCount: 1,
  }));
  return { seen, titles };
}

function fakeXbox(net) {
  const seen = { keys: new Set(), stats: 0 };
  net.on(/xbl\.io\/api\/v2\/search\/SarizoXbox/, (url, init) => { seen.keys.add(init.headers['X-Authorization']); return { content: { people: [{ xuid: '2535411111111111', gamertag: 'SarizoXbox' }] }, code: 200 }; });
  net.on(/xbl\.io\/api\/v2\/player\/titleHistory\/2535411111111111/, () => ({ code: 200, content: {
    xuid: '2535411111111111',
    titles: [
      { titleId: '1001', name: 'Halo Infinite', type: 'Game', devices: ['XboxSeries', 'PC'], displayImage: 'https://store-images.s-microsoft.com/halo.png', achievement: { currentAchievements: 30, totalAchievements: 119, progressPercentage: 25 }, titleHistory: { lastTimePlayed: '2024-05-01T10:00:00Z' } },
      { titleId: '2002', name: 'Application Xbox', type: 'App', devices: ['XboxSeries'] },
      { titleId: '3003', name: 'Rétro 360', type: 'Game', devices: ['Xbox360'], achievement: { currentAchievements: 0, totalAchievements: 0, progressPercentage: 10 } },
    ],
  } }));
  net.on(/xbl\.io\/api\/v2\/player\/stats/, (url, init) => {
    seen.stats++;
    const body = JSON.parse(init.body);
    return { statlistscollection: [{ stats: body.stats.map((s) => ({ titleid: s.titleId, name: 'MinutesPlayed', value: s.titleId === '1001' ? '4321' : '15' })) }] };
  });
  return seen;
}

function fakeEpic(net) {
  const seen = { basic: null, refreshOk: true, killed: 0, tokens: 0 };
  net.on(/account-public-service-prod03\.ol\.epicgames\.com\/account\/api\/oauth\/token/, (url, init) => {
    seen.basic = init.headers.Authorization;
    const form = new URLSearchParams(String(init.body));
    if (form.get('grant_type') === 'authorization_code' && form.get('code') !== 'a'.repeat(32)) return json({ errorCode: 'errors.com.epicgames.account.oauth.authorization_code_not_found' }, 400);
    if (form.get('grant_type') === 'refresh_token' && !seen.refreshOk) return json({ errorCode: 'invalid_grant' }, 400);
    seen.tokens++;
    return { access_token: `epic-access-${seen.tokens}`, refresh_token: 'epic-refresh', expires_at: new Date(Date.now() + 7200_000).toISOString(), account_id: 'epic-acc-1', displayName: 'SarizoEpic' };
  });
  net.on(/oauth\/sessions\/kill\//, () => { seen.killed++; return new Response(null, { status: 204 }); });
  net.on(/library-service\.live\.use1a\.on\.epicgames\.com\/library\/api\/public\/items/, (url) => (new URL(url).searchParams.get('cursor')
    ? { responseMetadata: {}, records: [{ namespace: 'ns3', catalogItemId: 'c3', appName: 'Hades' }] }
    : { responseMetadata: { nextCursor: 'page2' }, records: [
      { namespace: 'ns1', catalogItemId: 'c1', appName: 'Fortnite' },
      { namespace: 'ue', catalogItemId: 'u1', appName: 'UEAsset' },
      { namespace: 'ns2', catalogItemId: 'c2', appName: 'HadesOST' },
    ] }));
  net.on(/library\/api\/public\/playtime\/account\/epic-acc-1\/all/, () => [{ accountId: 'epic-acc-1', artifactId: 'Hades', totalTime: 36000 }]);
  const CATALOG = { c1: { title: 'Fortnite' }, c2: { title: 'Hades — bande originale', mainGameItem: { id: 'c3' } }, c3: { title: 'Hades', keyImages: [{ type: 'DieselGameBoxTall', url: 'https://cdn1.epicgames.com/hades.jpg' }] } };
  net.on(/catalog-public-service-prod06\.ol\.epicgames\.com/, (url) => {
    const id = new URL(url).searchParams.get('id');
    return CATALOG[id] ? { [id]: CATALOG[id] } : {};
  });
  return seen;
}

/* ---------- Mise en place ---------- */

let t;
let b;
let psn;
let xboxSeen;
let epicSeen;
const accountOf = async (provider) => (await b.get('/api/accounts')).data.accounts.find((a) => a.provider === provider);
const runJob = async (res) => {
  assert.equal(res.status, 200, res.data?.error);
  await t.ctx.pending;
  return (await b.get(`/api/jobs/${res.data.job.id}`)).data.job;
};
const collection = async () => (await b.get('/api/collection')).data.games;

before(async () => {
  resetSession();
  t = await startTestServer({ PSN_NPSSO: 'npsso-test', OPENXBL_API_KEY: 'xbl-test' });
  fakeDiscord(t.net, { user: DISCORD_USER, connections: [
    { type: 'playstation', id: 'psn-discord-id', name: 'Sarizo_PSN', verified: true },
    { type: 'xbox', id: '2535411111111111', name: 'SarizoXbox', verified: true },
  ] });
  fakeIgdb(t.net, { games: IGDB });
  psn = fakePsn(t.net);
  xboxSeen = fakeXbox(t.net);
  epicSeen = fakeEpic(t.net);
  ({ b } = await login(t, DISCORD_USER));
});
after(() => t.close());

/* ---------- Petites briques ---------- */

test('briques : durées PSN, consoles Xbox', () => {
  assert.equal(durationMinutes('PT228H56M33S'), 228 * 60 + 57);
  assert.equal(durationMinutes('P1DT2H'), 26 * 60);
  assert.equal(durationMinutes('n\'importe quoi'), null);
  assert.equal(xboxPlatform(['XboxOne', 'XboxSeries', 'PC']), 'Xbox Series X|S');
  assert.equal(xboxPlatform(['PC']), 'PC');
  assert.equal(xboxPlatform(['Mobile']), null);
});

/* ---------- PlayStation ---------- */

test('PlayStation : profil privé → erreur claire, pas de faux « connecté »', async () => {
  psn.seen.private = true;
  const acc = await accountOf('playstation');
  assert.equal(acc.status, 'detected');
  const res = await b.post(`/api/accounts/${acc.id}/enable`);
  assert.equal(res.status, 403);
  assert.match(res.data.error, /Confidentialité/);
  assert.equal((await accountOf('playstation')).status, 'error');
  psn.seen.private = false;
});

test('PlayStation : serveur sans NPSSO → 501, sans appel à Sony', async () => {
  const acc = await accountOf('playstation');
  const saved = t.config.env.PSN_NPSSO;
  delete t.config.env.PSN_NPSSO;
  const before = psn.seen.authorize;
  assert.equal((await b.post(`/api/accounts/${acc.id}/enable`)).status, 501);
  assert.equal(psn.seen.authorize, before);
  t.config.env.PSN_NPSSO = saved;
});

test('PlayStation : activation, bibliothèque, import avec trophées et correspondances strictes', async () => {
  const acc = await accountOf('playstation');
  const en = await b.post(`/api/accounts/${acc.id}/enable`);
  assert.equal(en.status, 200, en.data.error);
  assert.equal(en.data.accounts.find((a) => a.provider === 'playstation').status, 'connected');
  // accountId retrouvé une fois depuis l'ID en ligne, gardé sur le compte
  assert.equal(JSON.parse(t.db.prepare('SELECT external_data FROM connected_accounts WHERE id = ?').get(acc.id).external_data).accountId, '8888');
  assert.deepEqual([...psn.seen.bearer], ['Bearer psn-access']); // le jeton du serveur, jamais celui d'un joueur

  const lib = (await b.get(`/api/accounts/${acc.id}/library`)).data.results;
  assert.deepEqual(lib.map((g) => g.id), ['CUSA02', 'PPSA01', 'PPSA03']); // les plus joués d'abord

  const job = await runJob(await b.post(`/api/accounts/${acc.id}/import`, { ids: ['PPSA01', 'CUSA02', 'PPSA03', 'PAS-A-MOI'] }));
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual({ added: job.stats.added, unmatched: job.stats.unmatched, failed: job.stats.failed }, { added: 2, unmatched: 1, failed: 0 });

  const games = await collection();
  const astro = games.find((g) => g.igdbId === 1001);
  assert.equal(astro.platform, 'PlayStation 5');
  assert.equal(astro.playtimeMinutes, 750);
  assert.equal(astro.playtimeSource, 'playstation');
  assert.equal(astro.startedAt, '2024-09-06'); // date donnée par Sony
  assert.equal(astro.status, 'playing');
  assert.deepEqual(astro.achievements, { unlocked: 24, total: 49, percent: 48, source: 'playstation' });
  assert.equal(games.find((g) => g.igdbId === 1002).platform, 'PlayStation 4');
  const obscure = games.find((g) => g.name === 'Jeu obscur');
  assert.equal(obscure.matchStatus, 'unmatched');
  assert.equal(obscure.status, 'backlog');
  assert.equal(games.length, 3); // « PAS-A-MOI » n'est pas dans la bibliothèque de ce compte

  const again = await runJob(await b.post(`/api/accounts/${acc.id}/import`, { ids: ['PPSA01', 'CUSA02'] }));
  assert.equal(again.stats.skipped, 2);
  assert.equal((await collection()).length, 3);
});

test('PlayStation : la synchro ne touche ni au statut ni aux valeurs saisies, et ne supprime rien', async () => {
  const acc = await accountOf('playstation');
  const games = await collection();
  const astro = games.find((g) => g.igdbId === 1001);
  const blood = games.find((g) => g.igdbId === 1002);
  await b.patch(`/api/games/${astro.id}`, { status: 'finished' });
  await b.patch(`/api/games/${blood.id}`, { playtimeMinutes: 6000 });
  psn.titles[0].playDuration = 'PT20H';
  psn.titles[1].playDuration = 'PT99H';
  psn.titles.splice(2, 1); // « Jeu obscur » disparaît de la réponse

  const job = await runJob(await b.post(`/api/accounts/${acc.id}/sync`));
  assert.equal(job.status, 'done', job.error);
  const after = await collection();
  assert.equal(after.find((g) => g.id === astro.id).status, 'finished');
  assert.equal(after.find((g) => g.id === astro.id).playtimeMinutes, 1200);
  assert.equal(after.find((g) => g.id === blood.id).playtimeMinutes, 6000);
  assert.equal(after.find((g) => g.id === blood.id).playtimeSource, 'manual');
  assert.ok(after.find((g) => g.name === 'Jeu obscur'), 'toujours dans la collection');
  assert.equal((await accountOf('playstation')).status, 'synced');
});

test('PlayStation : NPSSO du serveur expiré → erreur explicite, aucune donnée perdue', async () => {
  resetSession();
  psn.seen.npssoValid = false;
  const acc = await accountOf('playstation');
  const before = (await collection()).length;
  const job = await runJob(await b.post(`/api/accounts/${acc.id}/sync`));
  assert.equal(job.status, 'error');
  assert.match(job.error, /expiré/);
  assert.equal((await collection()).length, before);
  psn.seen.npssoValid = true;
});

/* ---------- Xbox ---------- */

test('Xbox : XUID par le Gamertag, applications ignorées, minutes et succès importés', async () => {
  const acc = await accountOf('xbox');
  assert.equal((await b.post(`/api/accounts/${acc.id}/enable`)).status, 200);
  assert.deepEqual([...xboxSeen.keys], ['xbl-test']);
  const lib = (await b.get(`/api/accounts/${acc.id}/library`)).data.results;
  assert.deepEqual(lib.map((g) => [g.name, g.platform]), [['Halo Infinite', 'Xbox Series X|S'], ['Rétro 360', 'Xbox 360']]);

  const job = await runJob(await b.post(`/api/accounts/${acc.id}/import`, { ids: ['1001', '3003'] }));
  assert.equal(job.status, 'done', job.error);
  const halo = (await collection()).find((g) => g.igdbId === 4001);
  assert.equal(halo.platform, 'Xbox Series X|S');
  assert.equal(halo.playtimeMinutes, 4321);
  assert.equal(halo.lastPlayedAt, '2024-05-01');
  assert.deepEqual(halo.achievements, { unlocked: 30, total: 119, percent: 25, source: 'xbox' });
  assert.deepEqual((await collection()).find((g) => g.name === 'Rétro 360').achievements, { percent: 10, source: 'xbox' });
});

/* ---------- Epic ---------- */

test('Epic : liaison par code collé (à usage unique), jetons chiffrés', async () => {
  const start = await b.post('/api/accounts/link/epicgames/start');
  assert.equal(start.status, 200);
  assert.match(start.data.url, /^https:\/\/www\.epicgames\.com\/id\/login\?redirectUrl=/);

  assert.equal((await b.post('/api/accounts/link/epicgames/finish', { code: 'pas-un-code' })).status, 400);
  assert.equal((await b.post('/api/accounts/link/epicgames/finish', { code: 'b'.repeat(32) })).status, 400); // refusé par Epic
  const res = await b.post('/api/accounts/link/epicgames/finish', { code: `{"redirectUrl":"https://localhost","authorizationCode":"${'a'.repeat(32)}","sid":null}` });
  assert.equal(res.status, 200, res.data.error);
  assert.match(epicSeen.basic, /^Basic /);
  const acc = res.data.accounts.find((a) => a.provider === 'epicgames');
  assert.equal(acc.status, 'connected');
  assert.equal(acc.verified, true);
  assert.equal(acc.username, 'SarizoEpic');
  const cred = t.db.prepare('SELECT * FROM provider_credentials WHERE connected_account_id = ?').get(acc.id);
  assert.ok(cred.encrypted_token.startsWith('v1.') && !cred.encrypted_token.includes('epic-access'));
  assert.ok(!cred.encrypted_refresh_token.includes('epic-refresh'));
});

test('Epic : bibliothèque sans contenus Unreal ni extensions, jeu déjà présent relié sans doublon', async () => {
  const acc = await accountOf('epicgames');
  const lib = (await b.get(`/api/accounts/${acc.id}/library`)).data.results;
  assert.deepEqual(lib.map((g) => g.name), ['Hades', 'Fortnite']); // Hades joué 10 h, en tête
  assert.equal(lib[0].playtimeMinutes, 600);

  const manual = (await b.post('/api/games', { igdbId: 2001, platform: 'PC' })).data.game; // Hades ajouté à la main
  const job = await runJob(await b.post(`/api/accounts/${acc.id}/import`, { ids: ['Hades', 'Fortnite'] }));
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual({ added: job.stats.added, linked: job.stats.linked }, { added: 1, linked: 1 });
  const games = await collection();
  assert.equal(games.filter((g) => g.igdbId === 2001).length, 1);
  const hades = games.find((g) => g.id === manual.id);
  assert.equal(hades.playtimeMinutes, 600);
  assert.equal(hades.playtimeSource, 'epicgames');
  assert.equal(games.find((g) => g.igdbId === 2002).steamAppId, null); // pas relié à Steam par erreur
});

test('Epic : session expirée → « reconnexion nécessaire », puis déconnexion qui ferme la session Epic', async () => {
  const acc = await accountOf('epicgames');
  t.db.prepare('UPDATE provider_credentials SET expires_at = ? WHERE connected_account_id = ?').run(new Date(Date.now() - 1000).toISOString(), acc.id);
  epicSeen.refreshOk = false;
  const job = await runJob(await b.post(`/api/accounts/${acc.id}/sync`));
  assert.equal(job.status, 'error');
  const after = await accountOf('epicgames');
  assert.equal(after.status, 'authorization_required');
  assert.match(after.message, /reconnecte/);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM provider_credentials WHERE connected_account_id = ?').get(acc.id).n, 0);
  epicSeen.refreshOk = true;

  // Nouveau code : le même compte repart, puis on le déconnecte
  await b.post('/api/accounts/link/epicgames/finish', { code: 'a'.repeat(32) });
  const before = (await collection()).length;
  const kills = epicSeen.killed;
  assert.equal((await b.del(`/api/accounts/${acc.id}`)).status, 200);
  assert.equal(epicSeen.killed, kills + 1);
  assert.equal(await accountOf('epicgames'), undefined);
  assert.equal((await collection()).length, before); // les jeux restent
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM collection_links WHERE connected_account_id = ?').get(acc.id).n, 0);
});

/* ---------- Nintendo ---------- */

test('Nintendo : service fermé, ajout manuel seulement (aucune liaison, aucun appel)', async () => {
  const providers = (await b.get('/api/accounts')).data.providers;
  const nintendo = providers.find((p) => p.id === 'nintendo');
  assert.equal(nintendo.capabilities.library, false);
  assert.equal(nintendo.link, null);
  assert.deepEqual(nintendo.manualImport, ['Nintendo Switch 2', 'Nintendo Switch']);
  assert.equal((await b.post('/api/accounts/link/nintendo/start')).status, 404);
});

test('import : deux jeux de la plateforme qui mènent au même jeu IGDB sont reliés, pas en échec', async () => {
  const acc = await accountOf('xbox');
  // « Halo Infinite » sous un autre identifiant (édition multijoueur) : même fiche IGDB, même console
  t.db.prepare(`INSERT INTO platform_games (connected_account_id, external_game_id, name, platform, playtime_minutes, first_seen_at, last_seen_at)
    VALUES (?, '9999', 'Halo Infinite', 'Xbox Series X|S', 12, ?, ?)`).run(acc.id, new Date().toISOString(), new Date().toISOString());
  const job = await runJob(await b.post(`/api/accounts/${acc.id}/import`, { ids: ['9999'] }));
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual({ linked: job.stats.linked, failed: job.stats.failed }, { linked: 1, failed: 0 });
  assert.equal((await collection()).filter((g) => g.igdbId === 4001).length, 1);
});

/* ---------- Cloisonnement ---------- */

test('un autre utilisateur ne peut ni lire, ni synchroniser, ni utiliser la liaison d\'un autre', async () => {
  const discord = fakeDiscord(t.net, { user: OTHER_USER, connections: [{ type: 'xbox', id: '2535411111111111', name: 'SarizoXbox', verified: true }] });
  const { b: bob } = await login(t, OTHER_USER);
  const mine = await accountOf('xbox');
  assert.equal((await bob.get(`/api/accounts/${mine.id}/library`)).status, 404);
  assert.equal((await bob.post(`/api/accounts/${mine.id}/sync`)).status, 404);
  // Le Gamertag d'Alice, déjà vérifié chez elle, ne devient pas celui de Bob
  const bobXbox = (await bob.get('/api/accounts')).data.accounts.find((a) => a.provider === 'xbox');
  assert.equal(bobXbox.verified, false);
  assert.equal((await bob.post(`/api/accounts/${bobXbox.id}/enable`)).status, 403);
  discord.set({ user: DISCORD_USER });
});

test('export RGPD sans aucun jeton, et aucun appel réseau imprévu', async () => {
  const exp = JSON.stringify((await b.get('/api/me/export')).data);
  for (const secret of ['psn-access', 'epic-access', 'epic-refresh', 'xbl-test', 'npsso-test']) assert.ok(!exp.includes(secret), secret);
  assert.deepEqual(t.net.unexpected.filter((u) => !/store\.steampowered\.com|wikidata|wikipedia|steamgriddb/.test(u)), []);
});
