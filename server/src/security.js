// Briques de sécurité : jetons aléatoires, empreintes, chiffrement des jetons des fournisseurs.

import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Clé de chiffrement (32 octets) : ENCRYPTION_KEY (base64) si elle est fournie, sinon une clé générée
 * au premier démarrage et gardée dans le dossier de données (droits 600). Elle ne quitte jamais le serveur.
 */
export function loadKey(config) {
  if (config.encryptionKey) {
    const key = Buffer.from(config.encryptionKey, 'base64');
    if (key.length !== 32) throw new Error('ENCRYPTION_KEY doit faire 32 octets encodés en base64.');
    return key;
  }
  mkdirSync(config.dataDir, { recursive: true });
  const file = join(config.dataDir, 'secret.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
}

/** AES-256-GCM : « v1.iv.tag.données », tout en base64url. */
export function encrypt(key, plaintext) {
  if (plaintext == null) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function decrypt(key, payload) {
  if (!payload) return null;
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1') throw new Error('Format de jeton chiffré inconnu.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
