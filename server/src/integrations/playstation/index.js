// PlayStation Network : détection seulement (via Discord), ajout des jeux à la main.
//
// Sony ne propose pas d'API publique aux applications tierces. Les bibliothèques non officielles
// (psn-api, PSNAWP) demandent le jeton de session « NPSSO » du compte, récupéré depuis le navigateur :
// c'est un identifiant de connexion complet, qu'Asobi ne demandera jamais.

import { defineProvider } from '../core/provider.js';

export const playstation = defineProvider({
  id: 'playstation',
  name: 'PlayStation Network',
  official: false,
  discordTypes: ['playstation'],
  capabilities: { identify: true },
  limitations: 'Sony ne propose pas d\'API ouverte aux sites comme Asobi. Les outils non officiels exigent ton jeton de session PlayStation : Asobi ne te le demandera jamais. Ton identifiant PSN est reconnu ; ajoute tes jeux PS4/PS5 à la main.',
  manualImport: ['PlayStation 5', 'PlayStation 4'],
});
