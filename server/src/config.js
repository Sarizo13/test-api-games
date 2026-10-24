// Configuration : variables d'environnement (fichier .env facultatif, jamais versionné). Voir .env.example.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..'); // racine du dépôt : le site statique (index.html, assets/)

/** Lit un fichier .env simple (CLE=valeur, # commentaires) sans écraser les variables déjà définies. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

export function loadConfig(overrides = {}) {
  loadEnvFile(process.env.ENV_FILE ?? resolve(ROOT, '.env'));
  const env = { ...process.env, ...overrides };
  const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:8095').replace(/\/+$/, '');
  return {
    env, // les modules repris du Worker lisent leurs clés ici (IGDB_CLIENT_ID, SGDB_API_KEY…)
    port: Number(env.PORT ?? 8095),
    host: env.HOST ?? '127.0.0.1',
    publicUrl,
    origin: new URL(publicUrl).origin,
    secureCookies: publicUrl.startsWith('https://'),
    dataDir: resolve(env.DATA_DIR ?? resolve(ROOT, 'server/data')),
    trustProxy: env.TRUST_PROXY !== '0', // derrière nginx : l'adresse du visiteur vient de X-Forwarded-For
    discord: {
      clientId: env.DISCORD_CLIENT_ID ?? '',
      clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
      redirectUri: `${publicUrl}/api/auth/discord/callback`,
    },
    steamKey: env.STEAM_API_KEY ?? '',
    encryptionKey: env.ENCRYPTION_KEY ?? '',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    autoSyncHours: Number(env.AUTO_SYNC_HOURS ?? 12),
    backupDays: Number(env.BACKUP_KEEP_DAYS ?? 14),
  };
}
