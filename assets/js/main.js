// Asobi : navigation (adresses en #/…), barre latérale, recherche du haut et chargement des données.

import { platformMeta } from '../platforms.js';
import { state, load, onChange, gameById, TEST } from './state.js';
import { openAdd } from './add.js';
import { gameLine } from './card.js';
import { renderHome } from './views/home.js';
import { renderConsoles, renderConsole, platformFromSlug, consoleHref } from './views/consoles.js';
import { renderGame } from './views/game.js';
import { renderLists } from './views/lists.js';
import { renderDiscover } from './views/discover.js';
import { renderProfile } from './views/profile.js';
import { emptyState, thumb } from './views/common.js';
import { $, esc, norm, highlight, listbox, ICONS } from './util.js';

/* ---------- Pages ---------- */

const ROUTES = [
  { re: /^\/?$/, nav: 'home', title: 'Accueil', render: (v) => renderHome(v) },
  { re: /^\/consoles$/, nav: 'consoles', title: 'Consoles', render: (v) => renderConsoles(v) },
  { re: /^\/console\/([^/]+)$/, nav: 'consoles', render: (v, slug) => renderConsole(v, slug) },
  { re: /^\/jeu\/([^/]+)$/, nav: 'consoles', live: true, render: (v, id) => renderGame(v, id) },
  { re: /^\/a-jouer$/, nav: 'queue', title: 'À jouer', live: true, render: (v) => renderLists(v, 'a-jouer') },
  { re: /^\/envies$/, nav: 'wish', title: 'Envies', live: true, render: (v) => renderLists(v, 'envies') },
  { re: /^\/decouvrir$/, nav: 'discover', title: 'Découvrir', render: (v) => renderDiscover(v) },
  { re: /^\/profil$/, nav: 'profile', title: 'Profil', render: (v) => renderProfile(v) },
];

const NAV = [
  { id: 'home', href: '#/', label: 'Accueil', icon: ICONS.home },
  { id: 'consoles', href: '#/consoles', label: 'Consoles', icon: ICONS.folder, count: () => new Set(state.games.map((g) => g.platform)).size },
  { id: 'queue', href: '#/a-jouer', label: 'À jouer', icon: ICONS.list, count: () => state.playlist.length },
  { id: 'wish', href: '#/envies', label: 'Envies', icon: ICONS.star, count: () => state.wishlist.length },
  { id: 'discover', href: '#/decouvrir', label: 'Découvrir', icon: ICONS.compass },
];
const TABBAR = ['home', 'consoles', 'queue', 'discover', 'profile'];

const path = () => decodeURI(location.hash.replace(/^#/, '')) || '/';
const match = () => {
  const p = path();
  for (const r of ROUTES) {
    const m = p.match(r.re);
    if (m) return { route: r, params: m.slice(1) };
  }
  return null;
};

let cleanup = null;
let current = null;

/** Dessine la page de l'adresse actuelle. `keepScroll` : même page redessinée (données modifiées). */
function render({ keepScroll = false } = {}) {
  cleanup?.();
  cleanup = null;
  // Un nouvel élément à chaque page : les écouteurs de l'ancienne disparaissent avec lui, et l'animation d'entrée rejoue
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);

  const m = match();
  current = m;
  if (!state.loaded) {
    view.innerHTML = '<div class="shimmer" style="height:180px;border-radius:22px;margin:18px 0 26px"></div><div class="shimmer" style="height:420px;border-radius:22px"></div>';
  } else if (!m) {
    view.innerHTML = emptyState('🧭', 'Page introuvable', 'Cette adresse ne mène nulle part.', '<a class="btn btn-ghost" href="#/">Retour à l\'accueil</a>');
  } else {
    try {
      cleanup = m.route.render(view, ...m.params) ?? null;
    } catch (err) {
      console.error(err);
      view.innerHTML = emptyState('💥', 'Cette page a planté', esc(err.message), '<a class="btn btn-ghost" href="#/">Retour à l\'accueil</a>');
    }
  }
  if (!keepScroll) scrollTo({ top: 0, behavior: 'instant' });
  renderChrome();
}

/* ---------- Barre latérale, onglets du bas, fil d'Ariane ---------- */

function renderChrome() {
  const active = current?.route.nav;
  const count = (n) => {
    const c = n.count?.();
    return c ? `<span class="nav-count">${c}</span>` : '';
  };
  $('#nav').innerHTML = NAV.map((n) => `
    <a class="nav-link${n.id === active ? ' is-active' : ''}" href="${n.href}"${n.id === active ? ' aria-current="page"' : ''}>${n.icon}<span>${n.label}</span>${count(n)}</a>`).join('');

  const account = $('#account-link');
  account.className = `nav-link${active === 'profile' ? ' is-active' : ''}`;
  account.innerHTML = `${ICONS.user}<span>${esc(state.settings.name || 'Profil')}</span>${state.canEdit ? '' : `<span class="nav-count" title="Lecture seule">${ICONS.lock.replace('<svg', '<svg style="width:12px;vertical-align:-2px"')}</span>`}`;

  const all = [...NAV, { id: 'profile', href: '#/profil', label: 'Profil', icon: ICONS.user }];
  $('#tabbar').innerHTML = TABBAR.map((id) => all.find((n) => n.id === id)).map((n) => `
    <a href="${n.href}" class="${n.id === active ? 'is-active' : ''}">${n.icon}<span>${n.label}</span></a>`).join('');

  // Fil d'Ariane et titre de l'onglet
  const crumbs = [];
  if (current) {
    const [param] = current.params;
    const { route } = current;
    if (route.re.source.includes('console\\/')) {
      const p = platformFromSlug(param) ?? platformMeta(decodeURIComponent(param));
      crumbs.push(['Consoles', '#/consoles'], [p.id]);
    } else if (route.re.source.includes('jeu')) {
      const g = gameById(decodeURIComponent(param));
      crumbs.push(['Consoles', '#/consoles']);
      if (g) crumbs.push([platformMeta(g.platform).id, consoleHref(g.platform)], [g.name]);
    } else if (route.title) crumbs.push([route.title]);
  }
  $('#crumbs').innerHTML = crumbs.map(([label, href], i) => (i === crumbs.length - 1 || !href
    ? `<strong>${esc(label)}</strong>`
    : `<a href="${href}">${esc(label)}</a><span class="sep">›</span>`)).join('');
  document.title = crumbs.length && current?.route.nav !== 'home' ? `${crumbs.at(-1)[0]} · Asobi` : 'Asobi';
}

/* ---------- Recherche du haut : ta collection, ou ajouter un nouveau jeu ---------- */

function setupSearch() {
  const input = $('#search');
  const list = $('#search-suggest');
  let results = [];

  const go = (r) => {
    if (!r) return;
    box.close();
    input.value = '';
    input.blur();
    if (r.game) location.hash = `#/jeu/${encodeURIComponent(r.game.id)}`;
    else openAdd({ query: r.query });
  };
  const box = listbox(input, list, (li) => go(results[Number(li.dataset.index)]));

  const suggest = () => {
    const q = input.value.trim();
    if (!q) { box.close(); return; }
    const n = norm(q);
    const games = state.games
      .map((g) => ({ g, i: norm(g.name).indexOf(n) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i || a.g.name.localeCompare(b.g.name, 'fr'))
      .slice(0, 6)
      .map((x) => ({ game: x.g }));
    results = [...games, { query: q }];
    box.open(results.map((r, i) => (r.game ? `
      <li role="option" id="ss-${i}" class="suggest-item" data-index="${i}" style="--i:${i}">
        ${thumb(r.game, 'suggest-cover')}
        <span class="suggest-text"><strong>${highlight(r.game.name, q)}</strong><small>${esc(gameLine(r.game))}</small></span>
      </li>` : `
      <li role="option" id="ss-${i}" class="suggest-item suggest-add" data-index="${i}" style="--i:${i}">
        <span class="suggest-cover">${ICONS.plus}</span>
        <span class="suggest-text"><strong>Ajouter « ${esc(q)} »</strong><small>Chercher ce jeu sur IGDB pour l'ajouter</small></span>
      </li>`)).join(''));
  };

  input.addEventListener('input', suggest);
  input.addEventListener('focus', suggest);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && box.active < 0 && input.value.trim()) {
      e.preventDefault();
      go(results.length === 2 && results[0].game ? results[0] : results.at(-1));
    }
    if (e.key === 'Escape' && !box.isOpen) input.blur();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]') || $('#modals').children.length) return;
    e.preventDefault();
    input.focus();
  });
}

/* ---------- Démarrage ---------- */

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="add"]')) openAdd();
});

// Image cassée : le titre du jeu sur une carte, sinon l'image disparaît simplement
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.title) {
    const fallback = Object.assign(document.createElement('div'), { className: 'fallback', textContent: img.dataset.title });
    img.replaceWith(fallback);
  } else img.style.visibility = 'hidden';
}, true);

addEventListener('scroll', () => $('.topbar').classList.toggle('is-scrolled', scrollY > 8), { passive: true });
addEventListener('hashchange', () => render());

onChange((e) => {
  const type = e.detail.type;
  // Les pages « vivantes » (fiche, listes) se mettent à jour elles-mêmes ; les autres sont redessinées
  if (['load', 'auth', 'settings'].includes(type) || (type === 'games' && !current?.route.live)) render({ keepScroll: true });
  else renderChrome();
});

if (TEST) {
  document.body.insertAdjacentHTML('beforeend', '<div class="test-banner" title="Les modifications ne sont pas enregistrées">Mode test · rien n\'est enregistré</div>');
}

setupSearch();
render();
load().catch((err) => {
  console.error(err);
  $('#view').innerHTML = emptyState('📡', 'Impossible de charger ta collection', `Le serveur ne répond pas (${esc(err.message)}).`,
    '<button class="btn btn-primary" type="button" onclick="location.reload()">Réessayer</button>');
});
