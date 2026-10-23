// Liste des plateformes, partagée par le site (assets/app.js) et le script d'ajout (scripts/add-game.mjs).
// L'ordre ici est l'ordre d'affichage des rayons.
// `igdb` sert à reconnaître la plateforme dans les résultats IGDB pour choisir le bon jeu.

export const PLATFORMS = [
  { id: 'PC', short: 'PC', color: '#a3acc2', aliases: ['pc', 'windows', 'steam', 'steam deck', 'mac', 'linux'], igdb: /^(pc \(microsoft windows\)|mac|linux|steamos)$/i },
  { id: 'PlayStation 5', short: 'PS5', color: '#3b7bff', aliases: ['ps5', 'playstation5'], igdb: /^playstation 5$/i },
  { id: 'PlayStation 4', short: 'PS4', color: '#5b6cff', aliases: ['ps4', 'playstation4'], igdb: /^playstation 4$/i },
  { id: 'Nintendo Switch 2', short: 'Switch 2', color: '#ff4d5e', aliases: ['switch 2', 'switch2', 'ns2'], igdb: /^nintendo switch 2$/i },
  { id: 'Nintendo Switch', short: 'Switch', color: '#e60012', aliases: ['switch', 'ns', 'nintendo'], igdb: /^nintendo switch$/i },
  { id: 'Xbox Series X|S', short: 'Xbox Series', color: '#2fbf3a', aliases: ['xbox series', 'xbox series x', 'xbox series s', 'xsx', 'series x', 'xbox'], igdb: /^xbox series x\|s$/i },
  { id: 'Xbox One', short: 'Xbox One', color: '#7cc24a', aliases: ['xbox one', 'xbone', 'xb1'], igdb: /^xbox one$/i },
  { id: 'Mobile', short: 'Mobile', color: '#f59e0b', aliases: ['mobile', 'ios', 'android', 'iphone', 'telephone'], igdb: /^(ios|android)$/i },
  { id: 'Rétro', short: 'Rétro', color: '#c084fc', aliases: ['retro', 'rétro'], igdb: null },
  { id: 'Autre', short: 'Autre', color: '#94a3b8', aliases: ['autre', 'other'], igdb: null },
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Retrouve une plateforme à partir de son nom, de son nom court ou d'un alias (« ps5 », « switch »…). */
export function findPlatform(value) {
  const v = norm(value);
  if (!v) return null;
  return PLATFORMS.find((p) => norm(p.id) === v || norm(p.short) === v)
    ?? PLATFORMS.find((p) => p.aliases.some((a) => norm(a) === v))
    ?? null;
}

/** Infos d'affichage d'une plateforme, avec un repli pour celles ajoutées à la main dans games.json. */
export function platformMeta(id) {
  return PLATFORMS.find((p) => p.id === id) ?? findPlatform(id) ?? { id, short: id, color: '#94a3b8', aliases: [], igdb: null };
}
