// Cartes de jeux façon TCG : une « puissance » (0–100) tirée de tes notes, de ton temps de jeu et des
// trophées, et une rareté qui décide des effets (holo, étincelles, cadre arc-en-ciel, carte parfaite à 100).

import { platformMeta } from '../platforms.js';
import { esc, safeUrl, cssUrl, clamp, avg, year, canHover, reduceMotion } from './util.js';

export const STATUS = {
  backlog: { label: 'Jamais joué', short: 'Jamais', color: 'var(--st-backlog)', icon: '✦' },
  playing: { label: 'En cours', short: 'En cours', color: 'var(--st-playing)', icon: '▶' },
  finished: { label: 'Terminé', short: 'Terminé', color: 'var(--st-finished)', icon: '✓' },
  completed: { label: '100 %', short: '100 %', color: 'var(--st-completed)', icon: '★' },
  dropped: { label: 'Abandonné', short: 'Abandon', color: 'var(--st-dropped)', icon: '✕' },
};

export const RATINGS = {
  gameplay: 'Gameplay',
  story: 'Histoire',
  visuals: 'Graphismes',
  audio: 'Son & musique',
  lifespan: 'Durée de vie',
  fun: 'Plaisir',
};

export const TIERS = {
  sealed: { label: 'Sous blister', color: 'var(--tier-sealed)', min: -1 },
  common: { label: 'Commune', color: 'var(--tier-common)', min: 0 },
  uncommon: { label: 'Peu commune', color: 'var(--tier-uncommon)', min: 22 },
  rare: { label: 'Rare', color: 'var(--tier-rare)', min: 42 },
  epic: { label: 'Épique', color: 'var(--tier-epic)', min: 60 },
  legendary: { label: 'Légendaire', color: 'var(--tier-legendary)', min: 76 },
  mythic: { label: 'Mythique', color: 'var(--tier-mythic)', min: 90 },
  perfect: { label: 'Mythique · 100', color: 'var(--tier-perfect)', min: 100 },
};
const TIER_ORDER = Object.keys(TIERS);
export const tierRank = (tier) => TIER_ORDER.indexOf(tier);

/** Moyenne de tes notes (sur 10), ou null. */
export function ratingAverage(g) {
  const values = Object.values(g.ratings ?? {}).filter(Number.isFinite);
  return values.length ? avg(values) : null;
}

/**
 * Puissance de la carte :
 *  - note : moyenne de tes notes ramenée sur 100
 *  - temps : ton temps de jeu comparé à la durée moyenne pour finir le jeu (finir = 75, deux fois la durée = 100),
 *    ou sur une échelle logarithmique si la durée est inconnue (100 h ≈ 100)
 *  - trophées : pourcentage de succès
 * Ce qui manque compte pour 0 : une carte forte demande une note, du temps de jeu ET des trophées.
 * Bonus : terminé +4, 100 % +8, coup de cœur +4. Un jeu jamais joué reste « sous blister » ; 100 pile : carte parfaite.
 */
export function cardStats(g) {
  const r = ratingAverage(g);
  const rating = r == null ? null : r * 10;
  const hours = g.playtimeMinutes ? g.playtimeMinutes / 60 : null;
  let time = null;
  if (hours != null) {
    const ttb = g.timeToBeat?.normally;
    const ratio = ttb ? hours / ttb : null;
    time = ratio == null ? clamp((Math.log10(hours + 1) / 2) * 100) : ratio <= 1 ? ratio * 75 : clamp(75 + (ratio - 1) * 25);
  }
  const trophies = g.achievements?.percent ?? (g.status === 'completed' ? 100 : null);
  let power = ((rating ?? 0) + (time ?? 0) + (trophies ?? 0)) / 3;
  if (g.status === 'completed') power += 8;
  else if (g.status === 'finished') power += 4;
  if (g.favorite) power += 4;
  power = Math.round(clamp(power));

  const sealed = g.status === 'backlog' && !hours && r == null;
  let tier = 'sealed';
  if (!sealed) {
    tier = power >= 100 ? 'perfect'
      : ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'].find((k) => power >= TIERS[k].min) ?? 'common';
  }
  return { power, tier, rating, time, trophies, hours };
}

// Étincelles (x, y, taille, délai) : 3 en épique, 5 en légendaire, 7 en mythique, 9 pour la carte parfaite
const STARS = [[14, 18, 1.1, 0], [72, 12, 0.8, 0.6], [84, 38, 1.2, 1.3], [26, 44, 0.7, 1.9], [58, 30, 1, 0.9], [40, 12, 0.6, 2.4], [80, 58, 0.7, 1.6], [10, 60, 0.9, 0.3], [50, 52, 0.6, 2.1]];
const N_STARS = { epic: 3, legendary: 5, mythic: 7, perfect: 9 };
const MOTES = ['#ff8fc0', '#ffd66b', '#5ef0d6', '#8fb8ff'];

const stars = (tier) => STARS.slice(0, N_STARS[tier] ?? 0).map(([x, y, z, d]) => `<i style="--x:${x}%;--y:${y}%;--z:${z}em;--d:${d}s"></i>`).join('');
const motes = (tier) => (tier === 'perfect'
  ? Array.from({ length: 7 }, (_, i) => `<i style="--x:${8 + i * 13}%;--d:${(i * 0.55).toFixed(2)}s;--c:${MOTES[i % 4]}"></i>`).join('')
  : '');
const meter = (k, label, value) => `<span class="tcg__meter" data-k="${k}" style="--v:${value == null ? 0 : Math.round(value)}%">${label}</span>`;

/**
 * Images d'une carte : vignette légère (≈ 267×400, 80 Ko) et image HD (600×900, souvent 1 Mo),
 * plus les autres visuels du jeu à essayer si l'une ne se charge pas.
 */
export function cardImages(g) {
  const thumb = safeUrl(g.images?.gridThumb);
  const full = safeUrl(g.images?.grid) || safeUrl(g.images?.cover);
  const alt = [safeUrl(g.images?.cover), safeUrl(g.images?.grid), thumb].filter((u, i, all) => u && u !== full && all.indexOf(u) === i);
  return { thumb: thumb || full, full: full || thumb, alt };
}

/** Image légère d'une carte (rouleau de la roulette…). */
export const cardArt = (g) => cardImages(g).thumb;

/**
 * HTML d'une carte. `href` : lien vers la fiche ; `large` : grande carte de la fiche (pas un lien) ;
 * `mini` : miniature sans jauges ; `foreign` : carte d'un ami (pas d'identifiant : elle ne se déballe pas ici).
 */
export function cardHtml(g, { large = false, mini = false, foreign = false, i = 0, href = `#/jeu/${encodeURIComponent(g.id)}` } = {}) {
  const p = platformMeta(g.platform);
  const s = cardStats(g);
  const tier = TIERS[s.tier];
  const { thumb, full, alt } = cardImages(g);
  // Grille : la vignette suffit sur un écran classique, l'image HD seulement sur un écran haute densité.
  // Grande carte : l'image HD, avec la vignette affichée dessous pendant qu'elle arrive.
  const img = large ? full : thumb;
  const srcset = !large && !mini && thumb !== full ? ` srcset="${esc(thumb)} 267w, ${esc(full)} 600w" sizes="(max-width: 600px) 46vw, 230px"` : '';
  const under = large && thumb !== full ? ` style="background:${esc(cssUrl(thumb))} center/cover"` : '';
  const tag = large ? 'div' : 'a';
  const sealed = s.tier === 'sealed';
  return `
    <${tag} class="tcg${mini ? ' tcg--mini' : ''}${large ? ' tcg--large' : ''}" ${large ? '' : `href="${href}"`}${foreign ? '' : ` data-id="${esc(g.id)}"`} data-tier="${s.tier}"
      style="--power:${sealed ? 0 : s.power}%;--pc:${p.color};--i:${i}" aria-label="${esc(g.name)} — ${esc(tier.label)}${sealed ? '' : `, puissance ${s.power}`}">
      <div class="tcg__card">
        <div class="tcg__aura"></div>
        <div class="tcg__frame"><div class="tcg__spin"></div><div class="tcg__glitter"></div><div class="tcg__sweep"></div></div>
        <div class="tcg__inner">
          ${img ? `<img class="tcg__art" src="${esc(img)}"${srcset}${under} alt="" loading="${large ? 'eager' : 'lazy'}" decoding="async" data-title="${esc(g.name)}" data-alt="${esc(alt.join(' '))}">` : `<div class="tcg__fallback">${esc(g.name)}</div>`}
          <div class="tcg__foil"></div><div class="tcg__holo"></div><div class="tcg__rays"></div>
          <div class="tcg__stars">${stars(s.tier)}</div>
          <div class="tcg__motes">${motes(s.tier)}</div>
          <div class="tcg__glare"></div><div class="tcg__shade"></div>
          <div class="tcg__watermark" aria-hidden="true">${esc(g.name)}</div>
          <div class="tcg__top">
            <div><span class="tcg__plat">${esc(p.short)}</span>${g.favorite ? '<span class="tcg__fav" title="Coup de cœur">♥</span>' : ''}</div>
            <span class="tcg__power" title="Puissance"><span>${sealed ? '?' : s.power}</span></span>
          </div>
          <div class="tcg__info">
            <h3 class="tcg__name">${esc(g.name)}</h3>
            <div class="tcg__meters">${meter('note', 'Note', s.rating)}${meter('time', 'Temps', s.time)}${meter('troph', 'Troph.', s.trophies)}</div>
            <div class="tcg__rarity"><span class="tcg__label">${esc(tier.label)}</span><i class="tcg__gem"></i></div>
          </div>
        </div>
        <div class="tcg__wrap" aria-hidden="true"><div class="tcg__wrap-a"><span class="tcg__ribbon">NEUF</span></div><div class="tcg__wrap-b"></div></div>
      </div>
    </${tag}>`;
}

/** Déballage : le film part en deux morceaux (0,95 s), puis `after()` redessine la carte. */
export function tearCard(card, after) {
  if (!card) { after?.(); return; }
  card.classList.add('is-tearing');
  setTimeout(() => { card.classList.remove('is-tearing'); after?.(); }, reduceMotion ? 0 : 950);
}

/** Montée de rareté : éclair blanc sur la carte. */
export function flashCard(card) {
  if (!card || reduceMotion) return;
  card.classList.remove('is-flash');
  void card.offsetWidth;
  card.classList.add('is-flash');
  setTimeout(() => card.classList.remove('is-flash'), 900);
}

const holoRoots = new WeakSet();

/** Inclinaison 3D et reflet qui suivent la souris (délégué : un seul écouteur par conteneur). */
export function attachHolo(root) {
  // Pas d'attribut sur l'élément : la vue est clonée à chaque page et le copierait sans ses écouteurs
  if (!canHover || reduceMotion || holoRoots.has(root)) return;
  holoRoots.add(root);
  let current = null;
  let frame = 0;
  const reset = (card) => {
    card.classList.remove('is-tilting');
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
    card.style.setProperty('--o', '0');
  };
  root.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.tcg:not(.tcg--mini)');
    if (card !== current) { if (current) reset(current); current = card; }
    if (!card) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const r = card.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1);
      const y = clamp((e.clientY - r.top) / r.height, 0, 1);
      card.classList.add('is-tilting');
      card.style.setProperty('--mx', `${x * 100}%`);
      card.style.setProperty('--my', `${y * 100}%`);
      card.style.setProperty('--ry', `${(x - 0.5) * 22}deg`);
      card.style.setProperty('--rx', `${(0.5 - y) * 20}deg`);
      card.style.setProperty('--o', '1');
    });
  });
  root.addEventListener('pointerleave', () => { if (current) reset(current); current = null; });
}

/** Petite ligne de description d'un jeu : console · année · genre. */
export const gameLine = (g) => [platformMeta(g.platform).short, year(g.releaseDate), g.genres?.[0]].filter(Boolean).join(' · ');
