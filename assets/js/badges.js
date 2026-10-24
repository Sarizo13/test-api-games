// Badges du profil : des « trophées » de collectionneur, calculés à partir de ta collection.

import { platformMeta } from '../platforms.js';
import { cardStats, ratingAverage } from './card.js';

const hours = (g) => (g.playtimeMinutes ?? 0) / 60;
const done = (g) => ['finished', 'completed'].includes(g.status);

export const BADGES = [
  { id: 'first', emoji: '🎮', name: 'Premier pas', text: 'Ajouter un premier jeu', test: (gs) => gs.length >= 1 },
  { id: 'collector', emoji: '📦', name: 'Collectionneur', text: '25 jeux dans la collection', test: (gs) => gs.length >= 25 },
  { id: 'archivist', emoji: '🏛️', name: 'Archiviste', text: '100 jeux dans la collection', test: (gs) => gs.length >= 100 },
  { id: 'multi', emoji: '🧳', name: 'Multi-consoles', text: 'Des jeux sur 3 consoles', test: (gs) => new Set(gs.map((g) => g.platform)).size >= 3 },
  { id: 'museum', emoji: '🗿', name: 'Musée vivant', text: 'Des jeux sur 6 consoles', test: (gs) => new Set(gs.map((g) => g.platform)).size >= 6 },
  { id: 'retro', emoji: '📼', name: 'Rétro-gamer', text: 'Un jeu sorti avant 2000', test: (gs) => gs.some((g) => Number(g.releaseDate?.slice(0, 4)) < 2000 || platformMeta(g.platform).family === 'retro') },
  { id: 'arcade', emoji: '🕹️', name: 'Pièce dans la borne', text: 'Un jeu d\'arcade ou Neo Geo', test: (gs) => gs.some((g) => ['Arcade', 'Neo Geo'].includes(g.platform)) },
  { id: 'finisher', emoji: '🏁', name: 'Finisseur', text: '5 jeux terminés', test: (gs) => gs.filter(done).length >= 5 },
  { id: 'completionist', emoji: '💯', name: 'Complétionniste', text: 'Un jeu à 100 %', test: (gs) => gs.some((g) => g.status === 'completed') },
  { id: 'perfectionist', emoji: '👑', name: 'Perfectionniste', text: '5 jeux à 100 %', test: (gs) => gs.filter((g) => g.status === 'completed').length >= 5 },
  { id: 'critic', emoji: '🖋️', name: 'Critique', text: '10 jeux notés', test: (gs) => gs.filter((g) => ratingAverage(g) != null).length >= 10 },
  { id: 'marathon', emoji: '⏳', name: 'Marathonien', text: '500 h de jeu au total', test: (gs) => gs.reduce((a, g) => a + hours(g), 0) >= 500 },
  { id: 'nolife', emoji: '🌙', name: 'Nuit blanche', text: 'Plus de 200 h sur un seul jeu', test: (gs) => gs.some((g) => hours(g) >= 200) },
  { id: 'speedrun', emoji: '⚡', name: 'Plus vite que la moyenne', text: 'Finir un jeu plus vite que sa durée moyenne', test: (gs) => gs.some((g) => done(g) && g.timeToBeat?.normally && hours(g) > 0 && hours(g) < g.timeToBeat.normally) },
  { id: 'legend', emoji: '🌟', name: 'Légende', text: 'Une carte légendaire', test: (gs) => gs.some((g) => ['legendary', 'mythic', 'perfect'].includes(cardStats(g).tier)) },
  { id: 'myth', emoji: '🌈', name: 'Mythe vivant', text: 'Une carte mythique', test: (gs) => gs.some((g) => ['mythic', 'perfect'].includes(cardStats(g).tier)) },
  { id: 'heart', emoji: '💘', name: 'Coup de foudre', text: 'Un premier coup de cœur', test: (gs) => gs.some((g) => g.favorite) },
  { id: 'shame', emoji: '🙈', name: 'Pile de la honte', text: '20 jeux jamais joués', test: (gs) => gs.filter((g) => g.status === 'backlog').length >= 20 },
];

export function badges(games) {
  return BADGES.map((b) => ({ ...b, unlocked: b.test(games) }));
}
