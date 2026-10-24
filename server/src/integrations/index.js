// Registre des connecteurs. Pour ajouter une plateforme : un dossier avec un defineProvider(), puis l'ajouter ici.

import { defineProvider } from './core/provider.js';
import { discord } from './discord/index.js';
import { steam } from './steam/index.js';
import { playstation } from './playstation/index.js';
import { xbox } from './xbox/index.js';
import { epic } from './epic/index.js';
import { nintendo } from './nintendo/index.js';

// Plateformes vues dans les connexions Discord, sans aucune bibliothèque de jeux consultable
const detectedOnly = (id, name) => defineProvider({
  id, name, official: false, discordTypes: [id], capabilities: { identify: true },
  limitations: `Compte ${name} reconnu via Discord. ${name} ne permet pas d'importer une bibliothèque de jeux.`,
});

export const PROVIDERS = [
  discord, steam, playstation, xbox, epic, nintendo,
  detectedOnly('battlenet', 'Battle.net'),
  detectedOnly('riotgames', 'Riot Games'),
  detectedOnly('bungie', 'Bungie.net'),
  detectedOnly('roblox', 'Roblox'),
];

export const getProvider = (id) => PROVIDERS.find((p) => p.id === id) ?? null;
