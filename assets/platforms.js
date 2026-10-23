// Consoles d'Asobi, partagées par le site (assets/js) et le mini-serveur (worker/).
// Chaque console est un « dossier » de la collection. L'ordre ici est l'ordre d'affichage.
//   igdbNames : noms exacts des plateformes sur IGDB (reconnaissance des jeux et logos)
//   trailer   : identifiant YouTube d'une bande-annonce de la console (modifiable depuis le site)

export const FAMILIES = [
  { id: 'playstation', name: 'PlayStation' },
  { id: 'nintendo', name: 'Nintendo' },
  { id: 'xbox', name: 'Xbox' },
  { id: 'sega', name: 'Sega' },
  { id: 'retro', name: 'Rétro & arcade' },
  { id: 'pc', name: 'PC & mobile' },
  { id: 'autres', name: 'Autres' },
];

const P = (id, short, family, color, year, igdbNames, aliases = [], trailer = null) => ({
  id, short, family, color, year, igdbNames, aliases, trailer,
  igdb: igdbNames.length
    ? new RegExp(`^(${igdbNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i')
    : null,
});

export const PLATFORMS = [
  P('PlayStation 5', 'PS5', 'playstation', '#3b7bff', 2020, ['PlayStation 5'], ['ps5', 'playstation5'], '_NX8F9FBvg0'),
  P('PlayStation 4', 'PS4', 'playstation', '#5b6cff', 2013, ['PlayStation 4'], ['ps4', 'playstation4'], 'OngO_NnbOhQ'),
  P('PlayStation 3', 'PS3', 'playstation', '#8b93ff', 2006, ['PlayStation 3'], ['ps3'], 'nuqnu5Zn0Dg'),
  P('PlayStation 2', 'PS2', 'playstation', '#6366f1', 2000, ['PlayStation 2'], ['ps2']),
  P('PlayStation', 'PS1', 'playstation', '#a5b4fc', 1994, ['PlayStation'], ['ps1', 'psx', 'playstation 1']),
  P('PlayStation Vita', 'Vita', 'playstation', '#60a5fa', 2011, ['PlayStation Vita'], ['vita', 'psvita']),
  P('PlayStation Portable', 'PSP', 'playstation', '#94a3b8', 2004, ['PlayStation Portable'], ['psp']),

  P('Nintendo Switch 2', 'Switch 2', 'nintendo', '#ff4d5e', 2025, ['Nintendo Switch 2'], ['switch 2', 'switch2', 'ns2'], 'wMhxWFAgE2s'),
  P('Nintendo Switch', 'Switch', 'nintendo', '#e60012', 2017, ['Nintendo Switch'], ['switch', 'ns'], 'iS-1tDfLxRQ'),
  P('Wii U', 'Wii U', 'nintendo', '#22b8cf', 2012, ['Wii U'], ['wiiu'], '4e3qaPg_keg'),
  P('Wii', 'Wii', 'nintendo', '#cbd5e1', 2006, ['Wii'], [], 'QBOFhmjTgvY'),
  P('GameCube', 'GameCube', 'nintendo', '#8b5cf6', 2001, ['Nintendo GameCube'], ['gamecube', 'gc', 'ngc'], '91Ks-SDwj-c'),
  P('Nintendo 64', 'N64', 'nintendo', '#22c55e', 1996, ['Nintendo 64'], ['n64']),
  P('Super Nintendo', 'SNES', 'nintendo', '#a78bfa', 1990, ['Super Nintendo Entertainment System', 'Super Famicom'], ['snes', 'super nes', 'super famicom']),
  P('NES', 'NES', 'nintendo', '#ef4444', 1983, ['Nintendo Entertainment System', 'Family Computer'], ['nes', 'famicom']),
  P('Nintendo 3DS', '3DS', 'nintendo', '#f43f5e', 2011, ['Nintendo 3DS', 'New Nintendo 3DS'], ['3ds', '2ds'], 'T2guIF-rY3A'),
  P('Nintendo DS', 'DS', 'nintendo', '#9ca3af', 2004, ['Nintendo DS', 'Nintendo DSi'], ['ds', 'dsi']),
  P('Game Boy Advance', 'GBA', 'nintendo', '#7c3aed', 2001, ['Game Boy Advance'], ['gba']),
  P('Game Boy', 'Game Boy', 'nintendo', '#84cc16', 1989, ['Game Boy', 'Game Boy Color'], ['gb', 'gbc', 'game boy color']),
  P('Virtual Boy', 'Virtual Boy', 'nintendo', '#dc2626', 1995, ['Virtual Boy'], ['vb']),

  P('Xbox Series X|S', 'Xbox Series', 'xbox', '#2fbf3a', 2020, ['Xbox Series X|S'], ['xbox series', 'xbox series x', 'xbox series s', 'xsx', 'series x'], 'TuQLNd-Cp_g'),
  P('Xbox One', 'Xbox One', 'xbox', '#7cc24a', 2013, ['Xbox One'], ['xbox one', 'xbone', 'xb1'], 'dXt7H-8E7aI'),
  P('Xbox 360', 'Xbox 360', 'xbox', '#a3e635', 2005, ['Xbox 360'], ['360', 'x360']),
  P('Xbox', 'Xbox', 'xbox', '#65a30d', 2001, ['Xbox'], ['xbox original', 'og xbox']),

  P('PC', 'PC', 'pc', '#a3acc2', 1981, ['PC (Microsoft Windows)', 'Mac', 'Linux', 'SteamOS'], ['pc', 'windows', 'steam', 'steam deck', 'mac', 'linux']),
  P('Mobile', 'Mobile', 'pc', '#f59e0b', 2007, ['iOS', 'Android'], ['mobile', 'ios', 'android', 'iphone', 'telephone']),

  P('Dreamcast', 'Dreamcast', 'sega', '#f97316', 1998, ['Dreamcast'], ['dc']),
  P('Sega Saturn', 'Saturn', 'sega', '#64748b', 1994, ['Sega Saturn'], ['saturn']),
  P('Mega Drive', 'Mega Drive', 'sega', '#2563eb', 1988, ['Sega Mega Drive/Genesis', 'Sega CD', 'Sega 32X'], ['mega drive', 'megadrive', 'genesis', 'md', 'mega cd', '32x']),
  P('Master System', 'Master System', 'sega', '#ef4444', 1985, ['Sega Master System/Mark III'], ['master system', 'sms']),
  P('Game Gear', 'Game Gear', 'sega', '#0ea5e9', 1990, ['Sega Game Gear'], ['game gear', 'gg']),

  P('Arcade', 'Arcade', 'retro', '#facc15', 1971, ['Arcade'], ['arcade', 'borne', 'mame']),
  P('Neo Geo', 'Neo Geo', 'retro', '#eab308', 1990, ['Neo Geo AES', 'Neo Geo MVS', 'Neo Geo CD', 'Neo Geo Pocket', 'Neo Geo Pocket Color'], ['neo geo', 'neogeo', 'aes', 'mvs']),
  P('PC Engine', 'PC Engine', 'retro', '#f43f5e', 1987, ['TurboGrafx-16/PC Engine', 'Turbografx-16/PC Engine CD', 'PC Engine SuperGrafx'], ['pc engine', 'turbografx', 'tg16', 'pce']),
  P('Atari', 'Atari', 'retro', '#b91c1c', 1977, ['Atari 2600', 'Atari 5200', 'Atari 7800', 'Atari Jaguar', 'Atari Lynx', 'Atari ST/STE'], ['atari', '2600', 'jaguar', 'lynx', 'atari st']),
  P('Commodore & Amiga', 'Amiga', 'retro', '#38bdf8', 1982, ['Commodore C64/128/MAX', 'Amiga', 'Amiga CD32'], ['c64', 'commodore', 'amiga']),
  P('DOS', 'DOS', 'retro', '#a3a3a3', 1981, ['DOS'], ['dos', 'ms-dos', 'msdos']),

  P('Autre', 'Autre', 'autres', '#94a3b8', 0, [], ['autre', 'other', 'retro', 'rétro']),
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Retrouve une console à partir de son nom, de son nom court ou d'un alias (« ps5 », « switch »…). */
export function findPlatform(value) {
  const v = norm(value);
  if (!v) return null;
  return PLATFORMS.find((p) => norm(p.id) === v || norm(p.short) === v)
    ?? PLATFORMS.find((p) => p.aliases.some((a) => norm(a) === v))
    ?? null;
}

/** Infos d'affichage d'une console, avec un repli pour un nom inconnu. */
export function platformMeta(id) {
  return PLATFORMS.find((p) => p.id === id) ?? findPlatform(id)
    ?? { id, short: id, family: 'autres', color: '#94a3b8', year: 0, igdbNames: [], aliases: [], trailer: null, igdb: null };
}

/** Consoles d'Asobi correspondant à une liste de noms de plateformes IGDB. */
export function platformsFromIgdb(names = []) {
  const ids = PLATFORMS.filter((p) => p.igdb && names.some((n) => p.igdb.test(n))).map((p) => p.id);
  return ids.length || !names.length ? ids : ['Autre'];
}
