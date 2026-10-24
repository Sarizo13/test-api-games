// Xbox : détection seulement (via Discord), ajout des jeux à la main.
//
// Les services Xbox (succès, Gamerscore, temps de jeu) sont réservés aux partenaires Microsoft (programmes
// ID@Xbox / Creators) : un jeton OAuth Microsoft classique n'y donne pas accès. Le service tiers OpenXBL
// pourrait être branché plus tard (compte et clé d'application dédiés) ; il n'est pas activé.

import { defineProvider } from '../core/provider.js';

export const xbox = defineProvider({
  id: 'xbox',
  name: 'Xbox',
  official: false,
  discordTypes: ['xbox'],
  capabilities: { identify: true },
  limitations: 'Microsoft réserve l\'accès aux succès et au temps de jeu Xbox à ses partenaires. Ton Gamertag est reconnu ; ajoute tes jeux Xbox à la main.',
  manualImport: ['Xbox Series X|S', 'Xbox One'],
});
