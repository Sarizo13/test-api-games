// Nintendo : ajout des jeux à la main. Pas d'import pour l'instant.
//
// Le connecteur non officiel lisait l'historique de jeu de l'application « My Nintendo »
// (mypage-api.entry.nintendo.co.jp, la méthode de l'extension Raycast « Switch Game Play History ») :
// ce service n'existe plus (le nom de domaine ne résout plus). La seule voie connue qui reste est l'API de
// l'application « Contrôle parental Nintendo Switch » (comme `nxapi pctl`) : elle demande de relier la
// console à cette application et ne compte le temps de jeu qu'à partir de ce moment-là.
// Discord ne propose pas de connexion Nintendo : rien n'est détecté automatiquement.

import { defineProvider } from '../core/provider.js';

export const nintendo = defineProvider({
  id: 'nintendo',
  name: 'Nintendo',
  official: false,
  capabilities: {},
  limitations: 'Nintendo a fermé le service d\'historique de jeu qu\'utilisait Asobi : l\'import Nintendo est indisponible. Ajoute tes jeux Switch à la main (la recherche les trouve tous).',
  manualImport: ['Nintendo Switch 2', 'Nintendo Switch'],
});
