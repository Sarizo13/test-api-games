// Apparence (préférence de cet appareil) : 8 thèmes, motif du thème, fond d'ambiance.

import { local } from './util.js';

export const THEMES = [
  { id: 'graphite', name: 'Graphite', text: 'Écran de console, sobre' },
  { id: 'espace', name: 'Espace', text: 'Nuit étoilée, nébuleuse' },
  { id: 'neon', name: 'Néon', text: 'Synthwave, grille rose' },
  { id: 'borne', name: 'Borne', text: 'Arcade, trame CRT' },
  { id: 'foret', name: 'Forêt', text: 'Sous-bois et lucioles' },
  { id: 'magma', name: 'Magma', text: 'Volcanique' },
  { id: 'abysses', name: 'Abysses', text: 'Grand bleu, ondes' },
  { id: 'lcd', name: 'LCD', text: 'Console portable, pixels' },
];

const DEFAULTS = { theme: 'graphite', fx: true, ambient: false };

export const appearance = () => ({ ...DEFAULTS, ...local.get('appearance', {}) });

export function setAppearance(patch) {
  const next = { ...appearance(), ...patch };
  if (!THEMES.some((t) => t.id === next.theme)) next.theme = DEFAULTS.theme;
  local.set('appearance', next);
  const root = document.documentElement;
  root.dataset.theme = next.theme;
  if (next.fx) delete root.dataset.fx; else root.dataset.fx = 'off';
  if (next.ambient) root.dataset.ambient = 'on'; else delete root.dataset.ambient;
  return next;
}
