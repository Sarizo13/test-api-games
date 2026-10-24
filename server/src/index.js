// Démarrage du serveur Asobi : `node server/src/index.js` (ou via Docker, voir docker-compose.yml).

import { createServer } from 'node:http';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { loadKey } from './security.js';
import { createApp } from './app.js';
import { startTasks } from './tasks.js';

const config = loadConfig();
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const db = openDb(join(config.dataDir, 'asobi.sqlite'));
const ctx = { db, config, key: loadKey(config), log };

const missing = [
  !config.discord.clientId && 'DISCORD_CLIENT_ID',
  !config.discord.clientSecret && 'DISCORD_CLIENT_SECRET',
  !config.env.IGDB_CLIENT_ID && 'IGDB_CLIENT_ID',
  !config.env.IGDB_CLIENT_SECRET && 'IGDB_CLIENT_SECRET',
].filter(Boolean);
if (missing.length) log(`à configurer : ${missing.join(', ')} (voir .env.example)`);
if (!config.steamKey) log('STEAM_API_KEY absente : import Steam désactivé');

const server = createServer(createApp(ctx));
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;
const stopTasks = startTasks(ctx);

server.listen(config.port, config.host, () => log(`Asobi écoute sur http://${config.host}:${config.port} (adresse publique : ${config.publicUrl})`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`arrêt (${signal})`);
    stopTasks();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
