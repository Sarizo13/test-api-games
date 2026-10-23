// Profil de joueur : tes goûts déduits de ta collection (à partir de 10 jeux).
// Chaque jeu pèse selon tes notes, tes coups de cœur, ce que tu as fini ou abandonné et ton temps de jeu.

import { platformMeta } from '../platforms.js';
import { ratingAverage } from './card.js';
import { clamp } from './util.js';

export const PROFILE_MIN = 10;

const ARCHETYPES = [
  { genres: ['RPG'], emoji: '🗡️', name: 'Aventurier rôliste', text: 'Les grandes quêtes, les personnages qu\'on fait grandir et les mondes où l\'on se perd des dizaines d\'heures.' },
  { genres: ['Aventure'], emoji: '🧭', name: 'Explorateur', text: 'Tu avances pour voir ce qu\'il y a derrière la prochaine colline. L\'histoire et la découverte avant tout.' },
  { genres: ['Plateforme', 'Metroidvania'], emoji: '🍄', name: 'Acrobate', text: 'Sauts au pixel près, réflexes et précision : la manette est un prolongement de tes mains.' },
  { genres: ['Tir'], emoji: '🎯', name: 'Tireur d\'élite', text: 'Réflexes, visée et adrénaline. Tu aimes quand ça va vite et que chaque seconde compte.' },
  { genres: ['Stratégie', 'Stratégie temps réel', 'Stratégie tour par tour', 'Tactique'], emoji: '♟️', name: 'Stratège', text: 'Tu réfléchis trois coups à l\'avance. Planifier, optimiser, et voir ton plan se dérouler.' },
  { genres: ['Course'], emoji: '🏎️', name: 'Pilote', text: 'La trajectoire parfaite, le chrono qui tombe : la vitesse est ton terrain de jeu.' },
  { genres: ['Combat', 'Beat\'em all'], emoji: '🥊', name: 'Bagarreur', text: 'Combos, timing et duels : tu aimes quand ça cogne et que la maîtrise paie.' },
  { genres: ['Réflexion', 'Point & click', 'Quiz'], emoji: '🧩', name: 'Cerveau', text: 'Les énigmes qui résistent et le déclic quand tout s\'éclaire : tu joues avec la tête.' },
  { genres: ['Simulation'], emoji: '🏗️', name: 'Bâtisseur', text: 'Construire, gérer, faire grandir : tu aimes voir ton œuvre prendre forme.' },
  { genres: ['Sport'], emoji: '⚽', name: 'Sportif', text: 'Les matchs, les saisons, la compétition : le sport, manette en main.' },
  { genres: ['Indé'], emoji: '💎', name: 'Dénicheur de pépites', text: 'Les petits studios et les idées originales : tu trouves les perles avant tout le monde.' },
  { genres: ['Arcade', 'Flipper'], emoji: '🕹️', name: 'Chasseur de scores', text: 'Une partie de plus, juste une : le high-score t\'appelle.' },
  { genres: ['Musique'], emoji: '🎵', name: 'Mélomane', text: 'Le rythme d\'abord : tu joues avec les oreilles autant qu\'avec les doigts.' },
  { genres: ['Visual novel'], emoji: '📖', name: 'Conteur', text: 'Les histoires et les personnages avant l\'action : tu lis tes jeux comme des romans.' },
  { genres: ['Cartes & plateau'], emoji: '🃏', name: 'Joueur de cartes', text: 'Decks, combos et parties serrées : chaque main est une nouvelle énigme.' },
  { genres: ['MOBA'], emoji: '🛡️', name: 'Compétiteur', text: 'Le travail d\'équipe et le classement : tu joues pour gagner.' },
];

const ECLECTIC = { emoji: '🎮', name: 'Joueur éclectique', text: 'Un peu de tout, beaucoup de curiosité : aucun genre ne te fait peur.' };

/** Poids d'un jeu dans le profil. */
function weight(g) {
  const r = ratingAverage(g);
  const hours = g.playtimeMinutes ? g.playtimeMinutes / 60 : 0;
  let w = 1;
  if (r != null) w += (r - 5) / 2.5;
  if (g.favorite) w += 1.5;
  if (['finished', 'completed'].includes(g.status)) w += 0.6;
  if (g.status === 'playing') w += 0.3;
  if (g.status === 'dropped') w -= 0.8;
  if (hours) w += Math.log10(hours + 1) * 0.6;
  return Math.max(0.1, w);
}

const share = (map) => {
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  return [...map.entries()].map(([key, value]) => ({ key, value, pct: Math.round((value / total) * 100) })).sort((a, b) => b.value - a.value);
};

export function playerProfile(games) {
  if (games.length < PROFILE_MIN) return { locked: true, missing: PROFILE_MIN - games.length, count: games.length };

  const genres = new Map();
  const platforms = new Map();
  const decades = new Map();
  for (const g of games) {
    const w = weight(g);
    for (const genre of g.genres ?? []) genres.set(genre, (genres.get(genre) ?? 0) + w);
    platforms.set(g.platform, (platforms.get(g.platform) ?? 0) + w);
    const y = Number(g.releaseDate?.slice(0, 4));
    if (y) {
      const d = `${Math.floor(y / 10) * 10}`;
      decades.set(d, (decades.get(d) ?? 0) + w);
    }
  }

  const topGenres = share(genres);
  const topPlatforms = share(platforms);
  const topDecades = share(decades);

  const played = games.filter((g) => g.status !== 'backlog');
  const done = games.filter((g) => ['finished', 'completed'].includes(g.status));
  const rated = games.filter((g) => ratingAverage(g) != null);
  const hours = games.reduce((a, g) => a + (g.playtimeMinutes ?? 0), 0) / 60;
  const retro = games.filter((g) => {
    const y = Number(g.releaseDate?.slice(0, 4));
    return (y && y < 2002) || ['retro', 'sega'].includes(platformMeta(g.platform).family);
  });
  const indie = games.filter((g) => g.genres?.includes('Indé'));
  const favorites = games.filter((g) => g.favorite);

  const stats = {
    games: games.length,
    completionRate: played.length ? done.length / played.length : 0,
    backlogRate: (games.length - played.length) / games.length,
    ratedRate: played.length ? rated.length / played.length : 0,
    hoursPerGame: played.length ? hours / played.length : 0,
    retroRate: retro.length / games.length,
    indieRate: indie.length / games.length,
    favoriteRate: played.length ? favorites.length / played.length : 0,
  };

  // Archétype : le genre le plus marqué (« éclectique » si rien ne domine)
  const leader = topGenres.find((x) => x.key !== 'Indé') ?? topGenres[0];
  let archetype = ECLECTIC;
  if (leader && leader.pct >= 14) archetype = ARCHETYPES.find((a) => a.genres.includes(leader.key)) ?? ECLECTIC;
  if (topGenres[0]?.key === 'Indé' && topGenres[0].pct >= 22) archetype = ARCHETYPES.find((a) => a.genres.includes('Indé'));

  const traits = [
    stats.completionRate >= 0.6 && { emoji: '🏁', label: 'Finisseur', text: `${Math.round(stats.completionRate * 100)} % des jeux commencés sont terminés` },
    stats.backlogRate >= 0.4 && { emoji: '📚', label: 'Collectionneur', text: `${Math.round(stats.backlogRate * 100)} % de ta collection attend encore` },
    stats.ratedRate >= 0.6 && rated.length >= 5 && { emoji: '🖋️', label: 'Critique', text: 'Tu notes presque tout ce que tu joues' },
    stats.retroRate >= 0.3 && { emoji: '📼', label: 'Nostalgique', text: `${Math.round(stats.retroRate * 100)} % de jeux rétro` },
    stats.indieRate >= 0.35 && { emoji: '🌱', label: 'Chasseur d\'indés', text: `${Math.round(stats.indieRate * 100)} % de jeux indépendants` },
    stats.hoursPerGame >= 40 && { emoji: '⏳', label: 'Marathonien', text: `${Math.round(stats.hoursPerGame)} h en moyenne par jeu joué` },
    (topGenres[0]?.pct ?? 100) < 22 && { emoji: '🎲', label: 'Touche-à-tout', text: 'Aucun genre ne domine ta collection' },
    (topPlatforms[0]?.pct ?? 0) >= 70 && { emoji: '🏠', label: 'Fidèle', text: `Presque tout sur ${platformMeta(topPlatforms[0].key).short}` },
    stats.favoriteRate >= 0.25 && favorites.length >= 3 && { emoji: '💘', label: 'Cœur d\'artichaut', text: 'Tu as beaucoup de coups de cœur' },
  ].filter(Boolean);

  // Ce qui sert aux recommandations : les 3 genres les plus forts, et les jeux qui comptent le plus pour toi
  const seeds = [...games].filter((g) => g.igdbId).sort((a, b) => weight(b) - weight(a)).slice(0, 8).map((g) => g.igdbId);

  return {
    locked: false,
    archetype,
    traits,
    topGenres: topGenres.slice(0, 6),
    topPlatforms: topPlatforms.slice(0, 5),
    topDecades: topDecades.slice(0, 5),
    favoriteGenres: topGenres.slice(0, 3).map((x) => x.key),
    seeds,
    stats,
    score: Math.round(clamp(games.length * 2 + hours / 10 + done.length * 3, 0, 9999)),
  };
}
