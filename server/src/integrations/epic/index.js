// Epic Games : détection seulement (via Discord), ajout des jeux à la main.
//
// Epic Account Services donne le profil (identifiant, pseudo) mais pas la bibliothèque, le temps de jeu ni les
// succès d'un joueur à une application tierce. Les méthodes qui imitent le lanceur Epic ne sont pas utilisées.

import { defineProvider } from '../core/provider.js';

export const epic = defineProvider({
  id: 'epicgames',
  name: 'Epic Games',
  official: false,
  discordTypes: ['epicgames'],
  capabilities: { identify: true },
  limitations: 'Epic ne permet pas aux sites tiers de lire ta bibliothèque ni ton temps de jeu. Ton pseudo Epic est reconnu ; ajoute tes jeux à la main dans PC.',
  manualImport: ['PC'],
});
