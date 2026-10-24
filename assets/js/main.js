// Asobi : navigation (adresses en #/…), barre latérale, recherche du haut et chargement des données.

import { platformMeta } from '../platforms.js';
import { state, load, onChange, gameById, TEST, PROFILE } from './state.js';
import { openAdd, openLogin } from './add.js';
import { gameLine } from './card.js';
import { renderHome } from './views/home.js';
import { renderConsoles, renderConsole, platformFromSlug, consoleHref } from './views/consoles.js';
import { renderGame } from './views/game.js';
import { renderLists } from './views/lists.js';
import { renderDiscover } from './views/discover.js';
import { renderProfile } from './views/profile.js';
import { renderAccounts } from './views/accounts.js';
import { renderLanding } from './views/landing.js';
import { emptyState, thumb } from './views/common.js';
import { providerLogo } from './brands.js';
import { $, esc, safeUrl, norm, highlight, listbox, toast, ICONS } from './util.js';

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
  { re: /^\/comptes$/, nav: 'profile', title: 'Comptes connectés', live: true, own: true, render: (v) => renderAccounts(v) },
];

const NAV = [
  { id: 'home', href: '#/', label: 'Accueil', icon: ICONS.home },
  { id: 'consoles', href: '#/consoles', label: 'Consoles', icon: ICONS.folder, count: () => new Set(state.games.map((g) => g.platform)).size },
  { id: 'queue', href: '#/a-jouer', label: 'À jouer', icon: ICONS.list, count: () => state.playlist.length },
  { id: 'wish', href: '#/envies', label: 'Envies', icon: ICONS.star, count: () => state.wishlist.length },
  { id: 'discover', href: '#/decouvrir', label: 'Découvrir', icon: ICONS.compass },
];
const TABBAR = ['home', 'consoles', 'queue', 'discover', 'profile'];

// « #/comptes?steam=verifie » : la partie après « ? » porte un message de retour, pas la page
const path = () => decodeURI(location.hash.replace(/^#/, '').split('?')[0]) || '/';

/** Messages laissés dans l'adresse par le serveur après une redirection (connexion, vérification Steam…). */
const NOTICES = {
  'connexion=annulee': ['🚪', 'Connexion annulée', ' Tu peux réessayer quand tu veux.'],
  'steam=verifie': ['✅', 'Compte Steam vérifié', ' Tu peux maintenant activer l\'import.'],
  'steam=deja-pris': ['⚠️', 'Compte Steam déjà utilisé', ' Il est relié à un autre compte Asobi.'],
  'steam=refuse': ['⚠️', 'Vérification Steam refusée', ' Recommence depuis cette page.'],
};
function showNotices() {
  const [page, query] = location.hash.split('?');
  if (!query) return;
  const params = new URLSearchParams(query);
  for (const [key, value] of params) {
    if (key === 'erreur') toast('⚠️', 'Connexion impossible', ` ${value}`, 9000);
    const notice = NOTICES[`${key}=${value}`];
    if (notice) toast(...notice, 7000);
  }
  history.replaceState(null, '', `${location.pathname}${location.search}${page}`);
}
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
  const guest = state.loaded && !TEST && !PROFILE && !state.user;
  if (!state.loaded) {
    view.innerHTML = '<div class="shimmer" style="height:180px;border-radius:22px;margin:18px 0 26px"></div><div class="shimmer" style="height:420px;border-radius:22px"></div>';
  } else if (guest) {
    cleanup = renderLanding(view); // pas connecté : la présentation d'Asobi, quelle que soit la page demandée
  } else if (m?.route.own && PROFILE) {
    view.innerHTML = emptyState('🔒', 'Page privée', 'Cette page n\'existe que pour le propriétaire de la collection.', '<a class="btn btn-ghost" href="#/">Retour</a>');
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
  document.body.classList.toggle('is-readonly', Boolean(PROFILE));
  const count = (n) => {
    const c = n.count?.();
    return c ? `<span class="nav-count">${c}</span>` : '';
  };
  $('#nav').innerHTML = NAV.map((n) => `
    <a class="nav-link${n.id === active ? ' is-active' : ''}" href="${n.href}"${n.id === active ? ' aria-current="page"' : ''}>${n.icon}<span>${n.label}</span>${count(n)}</a>`).join('');

  // Compte : avatar Discord une fois connecté, sinon « Se connecter »
  const account = $('#account-link');
  account.className = `nav-link${active === 'profile' ? ' is-active' : ''}`;
  const who = PROFILE ? state.owner : state.user;
  const avatar = safeUrl(who?.avatarUrl) ? `<img class="nav-avatar" src="${esc(who.avatarUrl)}" alt="">` : ICONS.user;
  if (TEST || who) {
    account.innerHTML = `${TEST ? ICONS.user : avatar}<span>${esc(state.settings.name || who?.displayName || 'Profil')}</span>${state.canEdit ? '' : `<span class="nav-count" title="Lecture seule">${ICONS.lock.replace('<svg', '<svg style="width:12px;vertical-align:-2px"')}</span>`}`;
  } else {
    account.innerHTML = `${providerLogo('discord')}<span>Se connecter</span>`;
  }

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
  // Pas connecté : le lien « Se connecter » de la barre latérale ouvre la connexion Discord
  if (e.target.closest('#account-link') && state.loaded && !TEST && !PROFILE && !state.user) {
    e.preventDefault();
    openLogin();
  }
  if (e.target.closest('[data-reload]')) location.reload();
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
addEventListener('hashchange', () => { showNotices(); render(); });

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
showNotices();
render();
load().then(() => {
  // Collection de quelqu'un d'autre : bandeau « lecture seule »
  if (PROFILE && state.owner) {
    document.body.insertAdjacentHTML('beforeend', `<div class="test-banner profile-banner">Collection de ${esc(state.owner.displayName ?? state.owner.username)} · lecture seule${state.user ? '' : ' · <a href="/">Crée la tienne</a>'}</div>`);
  }
}).catch((err) => {
  console.error(err);
  const missing = PROFILE && err.status === 404;
  $('#view').innerHTML = missing
    ? emptyState('🔒', 'Profil introuvable ou privé', 'Cette collection n\'existe pas, ou son propriétaire ne l\'a pas rendue publique.', '<a class="btn btn-ghost" href="/">Aller sur Asobi</a>')
    : emptyState('📡', 'Impossible de charger ta collection', `Le serveur ne répond pas (${esc(err.message)}).`,
      '<button class="btn btn-primary" type="button" data-reload>Réessayer</button>');
});
