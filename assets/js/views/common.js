// Morceaux d'interface partagés par plusieurs pages.

import { platformMeta } from '../../platforms.js';
import { state, addWish } from '../state.js';
import { openAdd, requireEdit } from '../add.js';
import { esc, safeUrl, ICONS, toast } from '../util.js';

/** Titre de page : sur-titre, grand titre (la fin en couleur principale), texte, actions à droite. */
export const pageHead = (eyebrow, title, accent = '', text = '', actions = '') => `
  <header class="page-head">
    <div>
      <span class="eyebrow">${esc(eyebrow)}</span>
      <h1 class="h-hero">${esc(title)}${accent ? ` <span class="accent">${esc(accent)}</span>` : ''}</h1>
      ${text ? `<p>${text}</p>` : ''}
    </div>
    ${actions}
  </header>`;

export const sectionHead = (title, extra = '') => `
  <div class="section-head"><h2 class="h-section">${title}</h2>${extra}</div>`;

export const emptyState = (icon, title, text, action = '') => `
  <div class="empty"><span class="empty__icon" aria-hidden="true">${icon}</span><h2 class="h-section">${esc(title)}</h2><p>${text}</p>${action ? `<div class="actions" style="justify-content:center">${action}</div>` : ''}</div>`;

/** Squelettes de chargement : `n` cartes. */
export const skeletonCards = (n = 6) => `<div class="grid-cards" aria-busy="true">${Array.from({ length: n }, () => '<div class="skeleton" style="aspect-ratio:5/7"></div>').join('')}</div>`;

/** Petite jaquette d'un jeu de la collection. */
export const thumb = (g, cls = 'thumb') => {
  const src = safeUrl(g.images?.gridThumb) || safeUrl(g.images?.cover) || safeUrl(g.images?.grid);
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<span class="${cls}"></span>`;
};

/* ---------- Jeux IGDB (actualité, suggestions) : jaquette + « ajouter à mes envies » ---------- */

const stubs = new Map();

const owned = (igdbId) => state.games.some((g) => g.igdbId === igdbId);
const wished = (igdbId) => state.wishlist.some((w) => w.igdbId === igdbId);

export function miniCover(s, { flag = '', accent = false, i = 0, sub = '' } = {}) {
  stubs.set(s.igdbId, s);
  const done = owned(s.igdbId) || wished(s.igdbId);
  const label = owned(s.igdbId) ? 'Dans ta collection' : wished(s.igdbId) ? 'Dans tes envies' : 'Ajouter à mes envies';
  const details = sub || [s.year, s.platforms?.slice(0, 2).map((p) => platformMeta(p).short).join(', ')].filter(Boolean).join(' · ');
  return `
    <div class="cover" data-stub="${s.igdbId}" style="--i:${i}" title="${esc(s.name)}">
      <div class="cover__img">
        ${safeUrl(s.cover) ? `<img src="${esc(s.cover)}" alt="" loading="lazy">` : ''}
        ${flag ? `<span class="cover__flag${accent ? ' is-acc' : ''}">${esc(flag)}</span>` : ''}
        <button class="cover__add${done ? ' is-done' : ''}" type="button" data-wish="${s.igdbId}" aria-label="${label}" title="${label}">${done ? ICONS.check : ICONS.plus}</button>
      </div>
      <strong>${esc(s.name)}</strong>
      <small>${esc(details)}</small>
    </div>`;
}

/** Garde la proposition pour qu'un clic la retrouve (listes dessinées autrement que par miniCover). */
export const rememberStub = (s) => stubs.set(s.igdbId, s);

/** Clic sur une jaquette : fenêtre d'ajout ; clic sur « + » : ajout aux envies. */
export function bindStubs(root) {
  root.addEventListener('click', (e) => {
    const wish = e.target.closest('[data-wish]');
    if (wish) {
      e.stopPropagation();
      const s = stubs.get(Number(wish.dataset.wish));
      if (!s || owned(s.igdbId) || wished(s.igdbId)) return;
      requireEdit(async () => {
        wish.classList.add('is-done');
        wish.innerHTML = ICONS.check;
        await addWish(s);
        toast('✦', `${s.name} ajouté à tes envies`);
      });
      return;
    }
    const card = e.target.closest('[data-stub]');
    if (card) {
      const s = stubs.get(Number(card.dataset.stub));
      if (s) openAdd({ pick: s });
    }
  });
}
