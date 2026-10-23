// Morceaux d'interface partagés par plusieurs pages.

import { platformMeta } from '../../platforms.js';
import { state, addWish } from '../state.js';
import { openAdd, requireEdit } from '../add.js';
import { esc, safeUrl, ICONS, toast } from '../util.js';

export const sectionHead = (title, extra = '') => `
  <div class="section-head"><h2>${title}</h2><span class="line"></span>${extra}</div>`;

export const emptyState = (icon, title, text, action = '') => `
  <div class="empty"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3><p>${text}</p>${action}</div>`;

/** Petite image d'un jeu de la collection. */
export const thumb = (g, cls = '') => {
  const src = safeUrl(g.images?.gridThumb) || safeUrl(g.images?.cover) || safeUrl(g.images?.grid);
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<span class="ph ${cls}"></span>`;
};

/* ---------- Jeux IGDB (actualité, suggestions) : jaquette + « ajouter à mes envies » ---------- */

const stubs = new Map();

const owned = (igdbId) => state.games.some((g) => g.igdbId === igdbId);
const wished = (igdbId) => state.wishlist.some((w) => w.igdbId === igdbId);

export function miniCover(s, { flag = '', i = 0, sub = '' } = {}) {
  stubs.set(s.igdbId, s);
  const status = owned(s.igdbId) ? 'is-done' : wished(s.igdbId) ? 'is-done' : '';
  const label = owned(s.igdbId) ? 'Dans ta collection' : wished(s.igdbId) ? 'Dans tes envies' : 'Ajouter à mes envies';
  const details = sub || [s.year, s.platforms?.slice(0, 2).map((p) => platformMeta(p).short).join(', ')].filter(Boolean).join(' · ');
  return `
    <div class="mini-cover" data-stub="${s.igdbId}" style="animation:slide-in .5s var(--ease) both;animation-delay:${i * 40}ms" title="${esc(s.name)}">
      <div class="img">
        ${safeUrl(s.cover) ? `<img src="${esc(s.cover)}" alt="" loading="lazy">` : ''}
        ${flag ? `<span class="flag">${esc(flag)}</span>` : ''}
        <button class="add ${status}" type="button" data-wish="${s.igdbId}" aria-label="${label}" title="${label}">${status ? ICONS.check : ICONS.plus}</button>
      </div>
      <strong>${esc(s.name)}</strong>
      <small>${esc(details)}</small>
    </div>`;
}

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
        toast('✨', `${s.name} ajouté à tes envies`);
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
