// Genres IGDB traduits en français.
export const GENRES_FR = {
  'Adventure': 'Aventure',
  'Arcade': 'Arcade',
  'Card & Board Game': 'Cartes & plateau',
  'Fighting': 'Combat',
  "Hack and slash/Beat 'em up": "Beat'em all",
  'Indie': 'Indé',
  'MOBA': 'MOBA',
  'Music': 'Musique',
  'Pinball': 'Flipper',
  'Platform': 'Plateforme',
  'Point-and-click': 'Point & click',
  'Puzzle': 'Réflexion',
  'Quiz/Trivia': 'Quiz',
  'Racing': 'Course',
  'Real Time Strategy (RTS)': 'Stratégie temps réel',
  'Role-playing (RPG)': 'RPG',
  'Shooter': 'Tir',
  'Simulator': 'Simulation',
  'Sport': 'Sport',
  'Strategy': 'Stratégie',
  'Tactical': 'Tactique',
  'Turn-based strategy (TBS)': 'Stratégie tour par tour',
  'Visual Novel': 'Visual novel',
};

export const genreFr = (name) => GENRES_FR[name] ?? name;

// Identifiants des genres sur IGDB (pour les recommandations)
const IGDB_GENRE_IDS = {
  'Point-and-click': 2, 'Fighting': 4, 'Shooter': 5, 'Music': 7, 'Platform': 8, 'Puzzle': 9, 'Racing': 10,
  'Real Time Strategy (RTS)': 11, 'Role-playing (RPG)': 12, 'Simulator': 13, 'Sport': 14, 'Strategy': 15,
  'Turn-based strategy (TBS)': 16, 'Tactical': 24, "Hack and slash/Beat 'em up": 25, 'Quiz/Trivia': 26,
  'Pinball': 30, 'Adventure': 31, 'Indie': 32, 'Arcade': 33, 'Visual Novel': 34, 'Card & Board Game': 35, 'MOBA': 36,
};

/** Identifiant IGDB d'un genre donné en français (ou en anglais). */
export function genreId(name) {
  if (IGDB_GENRE_IDS[name]) return IGDB_GENRE_IDS[name];
  const english = Object.keys(GENRES_FR).find((en) => GENRES_FR[en] === name);
  return english ? IGDB_GENRE_IDS[english] ?? null : null;
}
