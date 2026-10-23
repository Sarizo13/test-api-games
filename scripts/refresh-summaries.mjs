#!/usr/bin/env node
// Remplace les résumés anglais (IGDB) de la collection par un résumé en français quand on en trouve un.
//   node scripts/refresh-summaries.mjs           → seulement les résumés pas encore en français
//   node scripts/refresh-summaries.mjs --all     → tous les jeux venant d'IGDB

import { readFile, writeFile } from 'node:fs/promises';
import { frenchSummary } from './lib/summary-fr.mjs';

const DATA_FILE = new URL('../data/games.json', import.meta.url);
const FRENCH_SOURCES = new Set(['steam', 'wikipedia', 'deepl']);
const all = process.argv.includes('--all');

const games = JSON.parse(await readFile(DATA_FILE, 'utf8'));
let changed = 0;

for (const game of games) {
  if (!game.igdbId || (!all && FRENCH_SOURCES.has(game.summarySource))) continue;
  const fr = await frenchSummary({
    name: game.name,
    steamAppId: game.steamAppId,
    igdbSlug: game.igdbUrl?.split('/').filter(Boolean).pop(),
    english: game.summarySource === 'igdb' || !game.summarySource ? game.summary : null,
  });
  if (!FRENCH_SOURCES.has(fr.summarySource)) {
    console.log(`–  ${game.name} : pas de résumé français trouvé`);
    continue;
  }
  Object.assign(game, fr);
  changed++;
  console.log(`✅ ${game.name} (${fr.summarySource}) : ${fr.summary.slice(0, 80)}…`);
}

if (changed) await writeFile(DATA_FILE, `${JSON.stringify(games, null, 2)}\n`);
console.log(`${changed} résumé(s) mis à jour.`);
