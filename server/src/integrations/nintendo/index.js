// Nintendo : pas de détection (Discord ne propose pas de connexion Nintendo), ajout des jeux à la main.
//
// Nintendo n'a pas d'API publique de bibliothèque. Les projets comme nxapi passent par l'application
// Nintendo Switch Online avec les jetons du compte Nintendo : non utilisés ici.

import { defineProvider } from '../core/provider.js';

export const nintendo = defineProvider({
  id: 'nintendo',
  name: 'Nintendo',
  official: false,
  capabilities: {},
  limitations: 'Nintendo n\'a pas d\'API publique pour les bibliothèques, et Discord ne relie pas les comptes Nintendo. Ajoute tes jeux Switch à la main (la recherche les trouve tous).',
  manualImport: ['Nintendo Switch 2', 'Nintendo Switch'],
});
