#!/usr/bin/env node
// Ajoute la bande-annonce Steam (lue directement par le site, sans YouTube) aux jeux de la collection
// qui ont un identifiant Steam. Pas de clé nécessaire.
//   node scripts/refresh-steam.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { steamTrailer } from './lib/steam.mjs';
import { sleep } from './lib/igdb.mjs';

const DATA_FILE = new URL('../data/games.json', import.meta.url);
const games = JSON.parse(await readFile(DATA_FILE, 'utf8'));
let changed = 0;

for (const game of games) {
  if (!game.steamAppId) {
    console.log(`–  ${game.name} : pas sur Steam (YouTube gardé)`);
    continue;
  }
  const trailer = await steamTrailer(game.steamAppId);
  await sleep(400); // l'API de la boutique Steam limite le nombre de requêtes
  if (!trailer) {
    console.log(`–  ${game.name} : pas de bande-annonce Steam`);
    continue;
  }
  if (game.steamTrailer?.hls !== trailer.hls) changed++;
  game.steamTrailer = trailer;
  console.log(`✅ ${game.name} — ${trailer.name}`);
}

if (changed) await writeFile(DATA_FILE, `${JSON.stringify(games, null, 2)}\n`);
console.log(`${changed} jeu(x) mis à jour.`);
