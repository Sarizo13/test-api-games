// Niveaux de joueur : de l'XP gagnée avec sa collection, des niveaux et des rangs.
//
// XP : jeu ajouté +10, carte déballée +20, heure de jeu +1 (100 au plus par jeu), 6 aspects notés +25,
// avis +15, terminé +100, 100 % +250 (en plus de « terminé »), badge obtenu +75.
// Passer du niveau n au niveau n+1 demande 100 + 20·n XP. Un rang tous les 10 niveaux.

import { RATINGS } from './card.js';
import { badges } from './badges.js';

export const RANKS = [
  { min: 1, name: 'Novice', color: 'var(--rank-novice)' },
  { min: 10, name: 'Initié', color: 'var(--rank-initie)' },
  { min: 20, name: 'Aguerri', color: 'var(--rank-aguerri)' },
  { min: 30, name: 'Vétéran', color: 'var(--rank-veteran)' },
  { min: 40, name: 'Élite', color: 'var(--rank-elite)' },
  { min: 50, name: 'Grand maître', color: 'var(--tier-mythic)' },
];

export const xpToNext = (level) => 100 + 20 * level;

/** XP gagnée, détaillée par source. */
export function xpBreakdown(games) {
  const done = games.filter((g) => ['finished', 'completed'].includes(g.status)).length;
  const rows = [
    ['Jeux ajoutés', games.length * 10],
    ['Cartes déballées', games.filter((g) => g.status !== 'backlog' || g.playtimeMinutes || Object.keys(g.ratings ?? {}).length).length * 20],
    ['Heures de jeu', games.reduce((a, g) => a + Math.min(100, Math.floor((g.playtimeMinutes ?? 0) / 60)), 0)],
    ['Jeux notés sur les 6 aspects', games.filter((g) => Object.keys(RATINGS).every((k) => Number.isFinite(g.ratings?.[k]))).length * 25],
    ['Avis écrits', games.filter((g) => (g.review ?? '').trim()).length * 15],
    ['Jeux terminés', done * 100],
    ['Jeux à 100 %', games.filter((g) => g.status === 'completed').length * 250],
    ['Badges', badges(games).filter((b) => b.unlocked).length * 75],
  ];
  return rows.map(([label, xp]) => ({ label, xp }));
}

/** Niveau, XP dans le niveau, rang. */
export function playerLevel(games) {
  const total = xpBreakdown(games).reduce((a, r) => a + r.xp, 0);
  let level = 1;
  let rest = total;
  while (rest >= xpToNext(level) && level < 999) {
    rest -= xpToNext(level);
    level++;
  }
  const need = xpToNext(level);
  const rank = [...RANKS].reverse().find((r) => level >= r.min);
  return { total, level, xp: rest, need, pct: Math.round((rest / need) * 100), rank };
}
