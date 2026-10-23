// Cartes de jeux façon TCG : une « puissance » (0–100) tirée de tes notes, de ton temps de jeu et des
// trophées, et une rareté qui décide de l'effet holographique autour de la carte.

import { platformMeta } from '../platforms.js';
import { esc, safeUrl, clamp, avg, year, canHover, reduceMotion } from './util.js';

export const STATUS = {
  backlog: { label: 'Jamais joué', color: '#94a3b8', icon: '✦' },
  playing: { label: 'En cours', color: '#22d3ee', icon: '▶' },
  finished: { label: 'Terminé', color: '#34d399', icon: '✓' },
  completed: { label: '100 %', color: '#fbbf24', icon: '★' },
  dropped: { label: 'Abandonné', color: '#fb7185', icon: '✕' },
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
  sealed: { label: 'Sous blister', color: '#e2e8f0', min: -1 },
  common: { label: 'Commune', color: '#cbd5e1', min: 0 },
  uncommon: { label: 'Peu commune', color: '#6ee7b7', min: 22 },
  rare: { label: 'Rare', color: '#93c5fd', min: 42 },
  epic: { label: 'Épique', color: '#d8b4fe', min: 60 },
  legendary: { label: 'Légendaire', color: '#fcd34d', min: 76 },
  mythic: { label: 'Mythique', color: '#f472b6', min: 90 },
};

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
 * Bonus : terminé +4, 100 % +8, coup de cœur +4. Un jeu jamais joué reste « sous blister ».
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
  const parts = [rating, time, trophies].filter((v) => v != null);

  let power = parts.length ? avg(parts) : g.status === 'backlog' ? 0 : 15;
  if (g.status === 'completed') power += 8;
  else if (g.status === 'finished') power += 4;
  if (g.favorite) power += 4;
  power = Math.round(clamp(power));

  const sealed = g.status === 'backlog' && !hours && r == null;
  const tier = sealed ? 'sealed'
    : Object.entries(TIERS).filter(([k]) => k !== 'sealed').reverse().find(([, t]) => power >= t.min)?.[0] ?? 'common';
  return { power, tier, rating, time, trophies, hours };
}

const meter = (label, value, color) => `
  <span class="tcg-meter" style="--v:${value == null ? 0 : Math.round(value)}%;--mc:${color}">${label}<i></i></span>`;

/** HTML d'une carte. `href` : lien vers la fiche ; `large` : grande carte de la fiche. */
export function cardHtml(g, { large = false, i = 0, href = `#/jeu/${encodeURIComponent(g.id)}` } = {}) {
  const p = platformMeta(g.platform);
  const s = cardStats(g);
  const tier = TIERS[s.tier];
  const img = safeUrl(g.images?.grid) || safeUrl(g.images?.cover) || safeUrl(g.images?.gridThumb);
  const thumb = safeUrl(g.images?.gridThumb);
  const tag = large ? 'div' : 'a';
  return `
    <${tag} class="tcg${large ? ' is-large' : ''}" ${large ? '' : `href="${href}"`} data-id="${esc(g.id)}" data-tier="${s.tier}"
      style="--pc:${p.color};--i:${i}" aria-label="${esc(g.name)} — ${esc(tier.label)}, puissance ${s.power}">
      <div class="tcg-inner">
        <div class="tcg-card">
          <div class="tcg-art"${thumb ? ` style="background:url('${esc(thumb)}') center/cover"` : ''}>
            ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" data-title="${esc(g.name)}">` : `<div class="fallback">${esc(g.name)}</div>`}
          </div>
          <div class="tcg-holo"></div>
          <div class="tcg-sparkle"></div>
          <div class="tcg-glare"></div>
          <div class="tcg-top">
            <span class="tcg-plat">${esc(p.short)}</span>
            <span class="tcg-power" title="Puissance">${s.tier === 'sealed' ? '?' : s.power}</span>
          </div>
          ${g.favorite ? '<span class="tcg-fav" title="Coup de cœur">♥</span>' : ''}
          <div class="tcg-info">
            <h3>${esc(g.name)}</h3>
            <div class="tcg-meters">
              ${meter('Note', s.rating, '#c084fc')}
              ${meter('Temps', s.time, '#22d3ee')}
              ${meter('Troph.', s.trophies, '#fbbf24')}
            </div>
            <div class="tcg-rarity" style="--rc:${tier.color}"><span>${esc(tier.label)}</span><span class="gem"></span></div>
          </div>
          ${s.tier === 'sealed' ? '<div class="tcg-wrap"></div>' : ''}
        </div>
      </div>
    </${tag}>`;
}

/** Effet holo et inclinaison 3D qui suivent la souris (délégué : un seul écouteur par conteneur). */
export function attachHolo(root) {
  if (!canHover || reduceMotion || root.dataset.holo) return;
  root.dataset.holo = '1';
  let current = null;
  let frame = 0;
  const reset = (card) => {
    card.classList.remove('is-tilting');
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
    card.style.setProperty('--o', '0');
  };
  root.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.tcg');
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
