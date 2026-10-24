// Asobi : navigation (adresses en #/…), coque (barre latérale, onglets mobiles, fil d'Ariane, recherche),
// déballage des cartes, passage de niveau, et chargement des données.

import { platformMeta } from '../platforms.js';
import { state, load, onChange, gameById, updateGame, TEST, PROFILE } from './state.js';
import { openAdd, openLogin, requireEdit } from './add.js';
import { cardHtml, gameLine, tearCard } from './card.js';
import { playerLevel } from './level.js';
import { renderHome } from './views/home.js';
import { renderConsoles, renderConsole, platformFromSlug, consoleHref } from './views/consoles.js';
import { renderGame } from './views/game.js';
import { renderLists } from './views/lists.js';
import { renderDiscover } from './views/discover.js';
import { renderProfile } from './views/profile.js';
import { renderAccounts } from './views/accounts.js';
import { renderFriends, renderDuel } from './views/friends.js';
import { renderLogin } from './views/landing.js';
import { emptyState, thumb } from './views/common.js';
import { $, esc, safeUrl, norm, highlight, listbox, toast, confetti, local, ICONS } from './util.js';

/* ---------- Pages ---------- */

const ROUTES = [
  { re: /^\/?$/, nav: 'home', title: 'Accueil', render: (v) => renderHome(v) },
  { re: /^\/consoles$/, nav: 'consoles', title: 'Consoles', render: (v) => renderConsoles(v) },
  { re: /^\/console\/([^/]+)$/, nav: 'consoles', render: (v, slug) => renderConsole(v, slug) },
  { re: /^\/jeu\/([^/]+)$/, nav: 'consoles', live: true, render: (v, id) => renderGame(v, id) },
  { re: /^\/a-jouer$/, nav: 'queue', title: 'À jouer', live: true, render: (v) => renderLists(v, 'a-jouer') },
  { re: /^\/envies$/, nav: 'wish', title: 'Envies', live: true, render: (v) => renderLists(v, 'envies') },
  { re: /^\/decouvrir$/, nav: 'discover', title: 'Découvrir', render: (v) => renderDiscover(v) },
  { re: /^\/amis$/, nav: 'friends', title: 'Amis', live: true, own: true, render: (v) => renderFriends(v) },
  { re: /^\/amis\/([\w.]+)$/, nav: 'friends', live: true, own: true, render: (v, name) => renderDuel(v, name) },
  { re: /^\/profil$/, nav: 'profile', title: 'Profil', render: (v) => renderProfile(v) },
  { re: /^\/comptes$/, nav: 'profile', title: 'Comptes connectés', live: true, own: true, render: (v) => renderAccounts(v) },
];

const NAV = [
  { id: 'home', href: '#/', label: 'Accueil', icon: ICONS.home },
  { id: 'consoles', href: '#/consoles', label: 'Consoles', icon: ICONS.folder, count: () => new Set(state.games.map((g) => g.platform)).size },
  { id: 'queue', href: '#/a-jouer', label: 'À jouer', icon: ICONS.list, count: () => state.playlist.length },
  { id: 'wish', href: '#/envies', label: 'Envies', icon: ICONS.star, count: () => state.wishlist.length },
  { id: 'discover', href: '#/decouvrir', label: 'Découvrir', icon: ICONS.compass, count: () => state.games.filter((g) => g.status === 'backlog').length },
  { id: 'friends', href: '#/amis', label: 'Amis', icon: ICONS.user, own: true, count: () => state.settings.friends?.length ?? 0 },
];
const TABBAR = ['home', 'consoles', 'queue', 'discover', 'profile'];

// « #/comptes?steam=verifie » : la partie après « ? » porte un message de retour, pas la page
const path = () => decodeURI(location.hash.replace(/^#/, '').split('?')[0]) || '/';

/** Messages laissés dans l'adresse par le serveur après une redirection (connexion, vérification Steam…). */
const NOTICES = {
  'connexion=annulee': ['↩', 'Connexion annulée', 'Tu peux réessayer quand tu veux.'],
  'steam=verifie': ['✓', 'Compte Steam vérifié', 'Tu peux maintenant activer l\'import.'],
  'steam=deja-pris': ['!', 'Compte Steam déjà utilisé', 'Il est relié à un autre compte Asobi.'],
  'steam=refuse': ['!', 'Vérification Steam refusée', 'Recommence depuis cette page.'],
};
function showNotices() {
  const [page, query] = location.hash.split('?');
  if (!query) return;
  const params = new URLSearchParams(query);
  for (const [key, value] of params) {
    if (key === 'erreur') toast('!', 'Connexion impossible', value, 9000, { color: 'var(--st-dropped)' });
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
  // Un nouvel élément à chaque page : les écouteurs de l'ancienne disparaissent avec lui, et l'entrée rejoue
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);

  const m = match();
  current = m;
  const guest = state.loaded && !TEST && !PROFILE && !state.user;
  if (!state.loaded) {
    view.innerHTML = '<div class="skeleton" style="height:120px;max-width:620px"></div><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:360px"></div>';
  } else if (guest) {
    cleanup = renderLogin(view); // pas connecté : le mur de jaquettes et la connexion Discord
  } else if (m?.route.own && (PROFILE || TEST)) {
    view.innerHTML = emptyState('🔒', 'Page privée', PROFILE ? 'Cette page n\'existe que pour le propriétaire de la collection.' : 'Indisponible en mode test : connecte-toi avec Discord.', '<a class="btn btn--primary" href="#/">Retour à l\'accueil</a>');
  } else if (!m) {
    view.innerHTML = emptyState('?', 'Page introuvable', 'Cette adresse ne mène nulle part : cette page est restée sous blister.', '<a class="btn btn--primary" href="#/">Retour à l\'accueil</a>');
  } else {
    try {
      cleanup = m.route.render(view, ...m.params) ?? null;
    } catch (err) {
      console.error(err);
      view.innerHTML = emptyState('⚠', 'Cette page a planté', esc(err.message), '<a class="btn btn--primary" href="#/">Retour à l\'accueil</a>');
    }
  }
  if (!keepScroll) scrollTo({ top: 0, behavior: 'instant' });
  renderChrome();
}

/* ---------- Barre latérale, onglets du bas, fil d'Ariane ---------- */

function renderChrome() {
  const active = current?.route.nav;
  document.body.classList.toggle('is-readonly', Boolean(PROFILE));
  const nav = NAV.filter((n) => !(n.own && PROFILE));
  $('#nav').innerHTML = nav.map((n) => {
    const c = state.loaded ? n.count?.() : 0;
    return `<a class="nav-link" href="${n.href}"${n.id === active ? ' aria-current="page"' : ''}>${n.icon}<span>${n.label}</span>${c ? `<span class="count">${c}</span>` : ''}</a>`;
  }).join('');

  // Carte du joueur : avatar dans l'anneau d'XP, niveau et rang ; cadenas sans connexion
  const me = $('#me');
  const who = PROFILE ? state.owner : state.user;
  const lvl = playerLevel(state.games);
  me.classList.toggle('is-locked', !TEST && !who);
  me.setAttribute('aria-current', active === 'profile' ? 'page' : 'false');
  const name = PROFILE ? (state.owner?.displayName ?? PROFILE) : (state.settings.name || who?.displayName || (TEST ? 'Mode test' : 'Se connecter'));
  const avatar = safeUrl(who?.avatarUrl) ? `<img src="${esc(who.avatarUrl)}" alt="">` : esc((name[0] ?? '?').toUpperCase());
  me.innerHTML = `
    <span class="me__ring" style="--xp:${TEST || who ? lvl.pct : 0}%"><span>${avatar}</span></span>
    <span class="me__text"><span class="me__name">${esc(name)}</span>
      <span class="me__level">${TEST || who ? `Niv. ${lvl.level} · ${esc(lvl.rank.name)}` : 'Connexion Discord'}</span></span>`;

  const all = [...NAV, { id: 'profile', href: '#/profil', label: 'Profil', icon: ICONS.user }];
  $('#tabbar').innerHTML = TABBAR.map((id) => all.find((n) => n.id === id)).map((n) => `
    <a href="${n.href}"${n.id === active ? ' aria-current="page"' : ''}>${n.icon}<span>${n.label}</span></a>`).join('');

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
      if (g) crumbs.push([platformMeta(g.platform).short, consoleHref(g.platform)], [g.name]);
    } else if (route.re.source.includes('amis\\/')) {
      crumbs.push(['Amis', '#/amis'], [param]);
    } else if (route.title) crumbs.push([route.title]);
  }
  $('#crumbs').innerHTML = crumbs.map(([label, href], i) => (i === crumbs.length - 1 || !href
    ? `<strong>${esc(label)}</strong>` : `<a href="${href}">${esc(label)}</a>`)).join('');
  document.title = crumbs.length && current?.route.nav !== 'home' ? `${crumbs.at(-1)[0]} · Asobi` : 'Asobi';
}

/** Bandeaux du haut : mode test, collection de quelqu'un d'autre. */
function renderNotices() {
  const box = $('#notices');
  if (TEST) box.innerHTML = '<div class="banner-test notice-bar"><b class="mono">MODE TEST</b> Données fictives, rien n\'est enregistré.</div>';
  else if (PROFILE && state.owner) {
    box.innerHTML = `<div class="banner-readonly notice-bar">🔒 Collection de ${esc(state.owner.displayName ?? state.owner.username)} · lecture seule
      <a class="accent" style="margin-left:auto" href="/">${state.user ? 'Ma collection' : 'Crée la tienne'}</a></div>`;
  } else box.innerHTML = '';
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
    results = [...games, ...(state.canEdit ? [{ query: q }] : [])];
    box.open(`${games.length ? '<li class="suggest__group" role="presentation">Dans ta collection</li>' : ''}${results.map((r, i) => (r.game ? `
      <li role="option" id="ss-${i}" class="suggest__item" data-index="${i}" aria-selected="false">
        ${thumb(r.game, 'thumb--sm')}
        <span class="suggest__text"><strong>${highlight(r.game.name, q)}</strong><small>${esc(gameLine(r.game))}</small></span>
      </li>` : `
      <li role="option" id="ss-${i}" class="suggest__item suggest__add" data-index="${i}" aria-selected="false">+ Ajouter « ${esc(q)} »</li>`)).join('')
      || '<li class="suggest__empty">Aucun jeu ne correspond.</li>'}`);
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

/* ---------- Déballage d'une carte sous blister ---------- */

/** Clic sur une carte sous blister : le film se déchire, le jeu passe « en cours » (annulable). */
function unwrap(card) {
  const g = gameById(card.dataset.id);
  if (!g) return;
  const before = { status: g.status, startedAt: g.startedAt ?? null };
  tearCard(card, async () => {
    const done = await updateGame(g.id, { status: 'playing' });
    if (!done) return;
    if (!card.classList.contains('tcg--large') && card.isConnected) {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(g, { mini: card.classList.contains('tcg--mini') });
      const next = tmp.firstElementChild;
      next.style.animation = 'none';
      card.replaceWith(next);
    }
    toast('▶', 'Carte déballée !', `${g.name} passe « En cours » · +20 XP`, 6000, {
      color: 'var(--st-playing)',
      action: { label: 'Annuler', onClick: () => updateGame(g.id, before) },
    });
  });
}

document.addEventListener('click', (e) => {
  const sealed = e.target.closest('.tcg[data-tier="sealed"]');
  if (sealed && sealed.dataset.id && !e.defaultPrevented) {
    e.preventDefault();
    requireEdit(() => unwrap(sealed));
    return;
  }
  if (e.target.closest('[data-action="add"]')) openAdd();
  // Pas connecté : la carte du joueur ouvre la connexion Discord
  if (e.target.closest('#me') && state.loaded && !TEST && !PROFILE && !state.user) {
    e.preventDefault();
    openLogin();
  }
  if (e.target.closest('[data-reload]')) location.reload();
});

/* ---------- Passage de niveau ---------- */

function levelUp(lvl) {
  const el = document.createElement('div');
  el.className = 'levelup';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Niveau ${lvl.level} atteint`);
  el.innerHTML = `
    <div class="levelup__rays"></div>
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:16px">
      <span class="eyebrow">Niveau supérieur</span>
      <div class="levelup__num">${lvl.level}</div>
      <span class="rank" style="--rc:${lvl.rank.color}">${esc(lvl.rank.name)}</span>
      <div class="xpbar" style="width:min(340px,80vw)"><i style="--v:0%"></i></div>
      <span class="muted mono" style="font-size:13px">${lvl.xp} / ${lvl.need} XP</span>
      <button class="btn btn--primary" type="button">Continuer</button>
    </div>`;
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelector('.xpbar i').style.setProperty('--v', `${lvl.pct}%`)));
  confetti();
  setTimeout(() => el.querySelector('button')?.focus(), 50);
}

let knownLevel = null;
function checkLevel({ silent = false } = {}) {
  if (!state.canEdit && !TEST) return;
  const lvl = playerLevel(state.games);
  const key = `level:${state.user?.username ?? 'test'}`;
  const saved = knownLevel ?? local.get(key, null);
  if (!silent && saved != null && lvl.level > saved) levelUp(lvl);
  knownLevel = lvl.level;
  local.set(key, lvl.level);
}

/* ---------- Démarrage ---------- */

// Image cassée d'une carte : un nouvel essai (souvent une erreur passagère du CDN), puis les autres visuels
// du jeu, et seulement ensuite le titre. Ailleurs, l'image disparaît simplement.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.classList.contains('tcg__art')) {
    const failed = img.currentSrc || img.src;
    img.removeAttribute('srcset');
    if (!img.dataset.retry) {
      img.dataset.retry = '1';
      setTimeout(() => { if (img.isConnected) img.src = `${failed}${failed.includes('?') ? '&' : '?'}r=1`; }, 1500 + Math.random() * 2000);
      return;
    }
    const alts = (img.dataset.alt ?? '').split(' ').filter(Boolean);
    if (alts.length) { img.dataset.alt = alts.slice(1).join(' '); img.src = alts[0]; return; }
  }
  if (img.dataset.title) {
    const fallback = Object.assign(document.createElement('div'), { className: 'tcg__fallback', textContent: img.dataset.title });
    img.replaceWith(fallback);
  } else img.style.visibility = 'hidden';
}, true);

addEventListener('scroll', () => $('.topbar').classList.toggle('is-scrolled', scrollY > 8), { passive: true });
addEventListener('hashchange', () => { showNotices(); render(); });

onChange((e) => {
  const type = e.detail.type;
  // Les pages « vivantes » (fiche, listes, amis) se mettent à jour elles-mêmes ; les autres sont redessinées
  if (['load', 'auth', 'settings'].includes(type) || (type === 'games' && !current?.route.live)) render({ keepScroll: true });
  else renderChrome();
  if (['game', 'games'].includes(type)) checkLevel();
});

setupSearch();
showNotices();
render();
load().then(() => {
  renderNotices();
  checkLevel({ silent: true });
}).catch((err) => {
  console.error(err);
  const missing = PROFILE && err.status === 404;
  $('#view').innerHTML = missing
    ? emptyState('🔒', 'Profil introuvable ou privé', 'Cette collection n\'existe pas, ou son propriétaire ne l\'a pas rendue publique.', '<a class="btn btn--primary" href="/">Aller sur Asobi</a>')
    : emptyState('⚠', 'Connexion perdue', `Le serveur ne répond pas (${esc(err.message)}). Ta collection est intacte.`,
      '<button class="btn btn--primary" type="button" data-reload>↻ Réessayer</button>');
});
