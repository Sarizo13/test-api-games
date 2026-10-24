// Briques isolées : chiffrement, Steam OpenID, connexions Discord, nouvelles tentatives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../src/security.js';
import { verifyOpenId, openIdUrl } from '../src/integrations/steam/index.js';
import { gamingConnections } from '../src/integrations/discord/index.js';
import { withRetry, ProviderError } from '../src/integrations/core/sync.js';
import { mockInternet } from './helpers.js';

const config = { publicUrl: 'https://asobi.sarizo.fr' };

test('chiffrement des jetons : aller-retour, et toute altération est détectée', () => {
  const key = randomBytes(32);
  const sealed = encrypt(key, 'jeton-secret');
  assert.notEqual(sealed, 'jeton-secret');
  assert.equal(decrypt(key, sealed), 'jeton-secret');
  const parts = sealed.split('.');
  parts[3] = Buffer.from('autre-chose').toString('base64url');
  assert.throws(() => decrypt(key, parts.join('.')));
  assert.throws(() => decrypt(randomBytes(32), sealed));
});

function openIdResponse(overrides = {}) {
  const claimed = 'https://steamcommunity.com/openid/id/76561198988944789';
  return new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': claimed,
    'openid.identity': claimed,
    'openid.return_to': 'https://asobi.sarizo.fr/api/accounts/steam/openid/callback?state=abc',
    'openid.response_nonce': '2026-10-24T00:00:00Zxyz',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'sig',
    ...overrides,
  });
}

test('Steam OpenID : adresse de connexion correcte', () => {
  const url = new URL(openIdUrl(config, 'abc'));
  assert.equal(url.origin + url.pathname, 'https://steamcommunity.com/openid/login');
  assert.equal(url.searchParams.get('openid.realm'), 'https://asobi.sarizo.fr');
  assert.equal(url.searchParams.get('openid.return_to'), 'https://asobi.sarizo.fr/api/accounts/steam/openid/callback?state=abc');
});

test('Steam OpenID : réponse valide acceptée seulement si Steam la confirme', async () => {
  const net = mockInternet('http://jamais');
  let posted;
  net.on(/steamcommunity\.com\/openid\/login/, (url, init) => { posted = new URLSearchParams(String(init.body)); return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'); });
  assert.equal(await verifyOpenId(config, openIdResponse()), '76561198988944789');
  assert.equal(posted.get('openid.mode'), 'check_authentication');

  net.on(/steamcommunity\.com\/openid\/login/, () => new Response('is_valid:false\n'));
  await assert.rejects(verifyOpenId(config, openIdResponse()), /signature invalide/);
  net.restore();
});

test('Steam OpenID : réponses trafiquées refusées avant même d\'interroger Steam', async () => {
  const net = mockInternet('http://jamais');
  await assert.rejects(verifyOpenId(config, openIdResponse({ 'openid.return_to': 'https://evil.example/cb' })), /adresse de retour/);
  await assert.rejects(verifyOpenId(config, openIdResponse({ 'openid.op_endpoint': 'https://evil.example/openid' })), /fournisseur/);
  await assert.rejects(verifyOpenId(config, openIdResponse({ 'openid.claimed_id': 'https://evil.example/id/76561198988944789' })), /identifiant/);
  await assert.rejects(verifyOpenId(config, openIdResponse({ 'openid.signed': 'op_endpoint,return_to' })), /signature incomplète/);
  await assert.rejects(verifyOpenId(config, openIdResponse({ 'openid.mode': 'cancel' })), /annulée/);
  assert.equal(net.calls.length, 0);
  net.restore();
});

test('connexions Discord : seulement les plateformes de jeu, non révoquées', () => {
  const out = gamingConnections([
    { type: 'steam', id: '1', name: 'a', verified: true },
    { type: 'youtube', id: '2', name: 'b', verified: true },
    { type: 'xbox', id: '3', name: 'c', verified: false, revoked: true },
    { type: 'playstation', id: '4', name: 'd' },
  ]);
  assert.deepEqual(out, [
    { provider: 'steam', id: '1', name: 'a', verified: true },
    { provider: 'playstation', id: '4', name: 'd', verified: false },
  ]);
  assert.deepEqual(gamingConnections(null), []);
});

test('nouvelles tentatives : seulement sur erreur passagère, avec abandon au bout du compte', async () => {
  let n = 0;
  const value = await withRetry(async () => {
    if (++n < 3) throw new ProviderError('limite', { retryable: true });
    return 'ok';
  }, { base: 1 });
  assert.equal(value, 'ok');
  assert.equal(n, 3);

  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw new ProviderError('profil privé', { status: 403 }); }, { base: 1 }), /profil privé/);
  assert.equal(m, 1); // erreur définitive : pas de nouvel essai

  let k = 0;
  await assert.rejects(withRetry(async () => { k++; throw new ProviderError('panne', { retryable: true }); }, { base: 1, retries: 2 }), /panne/);
  assert.equal(k, 3);
});
