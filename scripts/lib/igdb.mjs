// Comparaison de titres et choix des bandes-annonces IGDB, utilisés par le mini-serveur (worker/).

export const simplify = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Pour comparer des titres : « Baldur's Gate III » == « baldur s gate 3 »
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
export const matchKey = (s) => simplify(s).replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (r) => ROMAN[r]);
// Ce qui n'est pas le jeu lui-même : outils, mods, bandes-son…
const NOT_A_GAME = /\b(toolkit|mod manager|mod|soundtrack|ost|demo|dlc|editor|sdk|dedicated server|benchmark|artbook)\b/i;

export function scoreTitle(candidate, target, index, total) {
  const n = matchKey(candidate);
  const t = matchKey(target);
  let score = total - index; // les API classent déjà par pertinence
  if (n === t) score += 50;
  else if (n.startsWith(t) || t.startsWith(n)) score += 12;
  if (NOT_A_GAME.test(candidate) && !NOT_A_GAME.test(target)) score -= 40;
  return score;
}

export const best = (list, score) => list
  .map((item, i) => ({ item, score: score(item, i) }))
  .sort((a, b) => b.score - a.score)[0]?.item ?? null;

/** Choisit la bande-annonce la plus représentative parmi les vidéos YouTube d'IGDB. */
export function pickTrailer(videos = []) {
  const video = [...videos].filter((v) => /^[\w-]{11}$/.test(v.video_id ?? ''))
    .sort((a, b) => trailerRank(a.name) - trailerRank(b.name))[0];
  return video ? { youtubeId: video.video_id, name: video.name ?? null } : null;
}

/** Plus le rang est bas, plus la vidéo est représentative du jeu (bande-annonce de lancement d'abord). */
export function trailerRank(name) {
  const n = (name ?? '').toLowerCase();
  // Versions régionales (« DE USK », « (EN-US) »…) : juste derrière la version internationale
  const regional = /\b(de|usk|fr|jp|kr|ru|pegi|esrb|en-us|en-gb)\b|\(de\)/.test(n) ? 0.5 : 0;
  // Ce qui parle d'autre chose que du jeu de base : mises à jour, saisons, extensions…
  if (/update|season|dlc|expansion|patch|content pack|edgerunners|phantom liberty|shadow of the erdtree/.test(n)) return 5 + regional;
  if (/launch|release|lancement/.test(n)) return 0 + regional;
  if (/announce|reveal|annonce/.test(n)) return 2 + regional;
  if (/trailer|bande/.test(n) && !/gameplay|teaser/.test(n)) return 1 + regional;
  if (/trailer|teaser/.test(n)) return 3 + regional;
  return 4 + regional;
}
