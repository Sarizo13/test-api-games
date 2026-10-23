#!/usr/bin/env node
// Complète les jeux déjà dans la collection avec IGDB : bande-annonce, et pour ceux ajoutés sans IGDB,
// l'identifiant, le lien et la note. Les résumés, visuels et noms existants ne sont pas touchés.
//
//   IGDB_CLIENT_ID=… IGDB_CLIENT_SECRET=… node scripts/refresh-igdb.mjs
//   (ou depuis GitHub : Actions → « Mettre à jour depuis IGDB » → Run workflow)

import { readFile, writeFile } from 'node:fs/promises';
import { findPlatform } from '../assets/platforms.js';
import { igdbClient, findGame, pickTrailer, matchKey, sleep } from './lib/igdb.mjs';

const DATA_FILE = new URL('../data/games.json', import.meta.url);
const FIELDS = 'name,url,total_rating,cover.image_id,platforms.name,videos.name,videos.video_id';

const igdb = await igdbClient();
if (!igdb) {
  console.error('❌ Il faut IGDB_CLIENT_ID et IGDB_CLIENT_SECRET.');
  process.exit(1);
}

const games = JSON.parse(await readFile(DATA_FILE, 'utf8'));
let changed = 0;

for (const game of games) {
  let info;
  try {
    info = await findGame(igdb, { name: game.name, platform: findPlatform(game.platform), igdbId: game.igdbId }, FIELDS);
  } catch (err) {
    console.warn(`⚠️  ${game.name} : ${err.message}`);
    continue;
  }
  await sleep(300); // IGDB limite à 4 requêtes par seconde

  // Sans ID connu, on n'accepte que le même titre, pour ne pas rattacher le mauvais jeu
  if (!info || (!game.igdbId && matchKey(info.name) !== matchKey(game.name))) {
    console.log(`–  ${game.name} : pas trouvé sur IGDB`);
    continue;
  }

  const before = JSON.stringify(game);
  if (!game.igdbId) {
    game.igdbId = info.id;
    game.igdbUrl = info.url ?? null;
  }
  if (game.rating == null && info.total_rating) game.rating = Math.round(info.total_rating);
  game.trailer = pickTrailer(info.videos) ?? game.trailer ?? null;

  if (JSON.stringify(game) !== before) {
    changed++;
    console.log(`✅ ${game.name}${game.trailer ? ` — trailer : ${game.trailer.name ?? game.trailer.youtubeId}` : ' — pas de trailer'}`);
  } else {
    console.log(`=  ${game.name} : déjà à jour`);
  }
}

if (changed) await writeFile(DATA_FILE, `${JSON.stringify(games, null, 2)}\n`);
console.log(`${changed} jeu(x) mis à jour.`);
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
