import { PLATFORMS, platformMeta } from './platforms.js';

const CONFIG = {
  // Dépôt GitHub qui reçoit les demandes d'ajout, au format "pseudo/nom-du-repo".
  // Laisse vide : il est détecté tout seul quand le site tourne sur <pseudo>.github.io.
  repo: 'Sarizo13/test-api-games',
  heroCount: 5,
  pendingTtl: 20 * 60 * 1000, // un ajout en attente disparaît au bout de 20 min
  pollEvery: 30 * 1000,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
const canTransition = 'startViewTransition' in document && !reduceMotion;

const els = {
  hero: $('#hero'),
  heroSlides: $('#hero-slides'),
  heroNav: $('#hero-nav'),
  stats: $('#stats'),
  tabs: $('#tabs'),
  indicator: $('#tab-indicator'),
  sort: $('#sort'),
  search: $('#search'),
  library: $('#library'),
  detail: $('#detail'),
  detailPanel: $('#detail-panel'),
  add: $('#add'),
  addForm: $('#add-form'),
  addName: $('#add-name'),
  addIgdb: $('#add-igdb'),
  addPlatforms: $('#add-platforms'),
  addHelp: $('#add-help'),
  addWarning: $('#add-warning'),
  addSubmit: $('#add-submit'),
  toasts: $('#toasts'),
  ambient: $$('.ambient-layer'),
};

const state = {
  games: [],
  pending: [],
  platform: 'all',
  sort: 'added',
  query: '',
  visible: [],
  detailId: null,
  repo: detectRepo(),
};

/* ==========================================================================
   Utilitaires
   ========================================================================== */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');
// Guillemets simples : la valeur finit souvent dans un attribut style="…"
const cssUrl = (u) => (safeUrl(u) ? `url('${safeUrl(u).replace(/'/g, '%27').replace(/"/g, '%22')}')` : 'none');
const year = (g) => (g.releaseDate ? g.releaseDate.slice(0, 4) : '');
const fmtDate = (iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', opts);
};

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`ludotheque:${key}`)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`ludotheque:${key}`, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  },
};

function detectRepo() {
  if (CONFIG.repo) return CONFIG.repo;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return null;
  const first = location.pathname.split('/').filter(Boolean)[0];
  return first && !first.includes('.') ? `${m[1]}/${first}` : `${m[1]}/${m[1]}.github.io`;
}

/** Exécute une mise à jour du DOM dans une View Transition quand le navigateur le permet. */
function transition(update) {
  if (!canTransition) { update(); return null; }
  document.documentElement.classList.add('vt-running');
  const t = document.startViewTransition(update);
  t.finished.finally(() => document.documentElement.classList.remove('vt-running'));
  return t;
}

function inViewport(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
}

/** Donne un nom de transition aux seules cartes visibles : les autres n'ont pas besoin d'être animées. */
function nameVisibleCards() {
  for (const inner of $$('.card-inner', els.library)) {
    const card = inner.parentElement;
    inner.style.viewTransitionName = card.dataset.id && inViewport(inner) ? `g-${card.dataset.id}` : '';
  }
}

function clearCardNames() {
  for (const inner of $$('.card-inner', els.library)) inner.style.viewTransitionName = '';
}

function toast(icon, title, text = '', ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${icon}</span><div><strong>${esc(title)}</strong>${esc(text)}</div>`;
  els.toasts.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

function countUp(el, to) {
  if (reduceMotion || to < 2) { el.textContent = to; return; }
  const start = performance.now();
  const dur = 900;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(to * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ==========================================================================
   Données
   ========================================================================== */

function normalizeGames(list) {
  const seen = new Set();
  return list.filter((g) => g && g.name).map((g) => {
    let id = String(g.id || `${g.name}-${g.platform}`).toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'jeu';
    if (/^\d/.test(id)) id = `j-${id}`;
    while (seen.has(id)) id += '-2';
    seen.add(id);
    return {
      ...g,
      id,
      platform: g.platform || 'Autre',
      genres: Array.isArray(g.genres) ? g.genres : [],
      developers: Array.isArray(g.developers) ? g.developers : [],
      images: { screenshots: [], ...(g.images || {}) },
    };
  });
}

async function fetchGames() {
  const res = await fetch(`data/games.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return normalizeGames(Array.isArray(data) ? data : data.games || []);
}

function platformsInUse() {
  const used = new Set(state.games.map((g) => g.platform));
  const known = PLATFORMS.filter((p) => used.has(p.id)).map((p) => p.id);
  const extra = [...used].filter((id) => !known.includes(id)).sort((a, b) => a.localeCompare(b, 'fr'));
  return [...known, ...extra];
}

function filteredGames() {
  const q = norm(state.query);
  return state.games.filter((g) =>
    (state.platform === 'all' || g.platform === state.platform)
    && (!q || norm(`${g.name} ${g.genres.join(' ')} ${g.developers.join(' ')}`).includes(q)));
}

const sorters = {
  added: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
  name: (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
  release: (a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''),
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
};

/* ---------- Ajouts en attente (le temps que l'Action GitHub tourne) ---------- */

function loadPending() {
  const now = Date.now();
  state.pending = store.get('pending', []).filter((p) => now - p.at < CONFIG.pendingTtl && !isArrived(p));
  store.set('pending', state.pending);
}

function isArrived(p) {
  const n = norm(p.name);
  return state.games.some((g) => g.platform === p.platform
    && (norm(g.name) === n || norm(g.name).includes(n) || n.includes(norm(g.name)))
    && new Date(g.addedAt || 0).getTime() > p.at - 5 * 60 * 1000);
}

let pollTimer = null;

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!state.pending.length) return;
  pollTimer = setTimeout(async () => {
    try {
      const before = new Set(state.games.map((g) => g.id));
      const games = await fetchGames();
      const fresh = games.filter((g) => !before.has(g.id));
      if (fresh.length) {
        state.games = games;
        loadPending();
        transition(() => { renderAll(); nameVisibleCards(); })?.finished.finally(clearCardNames);
        for (const g of fresh) toast('🎮', `${g.name} est arrivé !`, ` Rangé dans ${platformMeta(g.platform).short}.`);
      } else {
        loadPending();
        if (!state.pending.length) renderLibrary();
      }
    } catch { /* on réessaiera au prochain tour */ }
    schedulePoll();
  }, CONFIG.pollEvery);
}

/* ==========================================================================
   Fond d'ambiance
   ========================================================================== */

let ambientIndex = 0;
let ambientUrl = '';

function setAmbient(url) {
  if (!safeUrl(url) || url === ambientUrl) return;
  ambientUrl = url;
  const next = els.ambient[ambientIndex = 1 - ambientIndex];
  const prev = els.ambient[1 - ambientIndex];
  const img = new Image();
  img.onload = () => {
    if (ambientUrl !== url) return;
    next.style.backgroundImage = cssUrl(url);
    next.classList.add('is-visible');
    prev.classList.remove('is-visible');
  };
  img.src = url;
}

/* ==========================================================================
   Hero
   ========================================================================== */

let heroIndex = 0;

function heroImage(g) {
  return g.images.hero || g.images.screenshots[0] || '';
}

/** Fond léger à afficher tout de suite (les heroes HD pèsent parfois plusieurs Mo). */
function heroPreview(g) {
  return (g.images.hero && g.images.heroThumb) || heroImage(g);
}

/** Remplace la miniature par l'image HD dès qu'elle est téléchargée. */
function upgradeBg(el) {
  const full = el?.dataset.full;
  if (!full) return;
  delete el.dataset.full;
  const img = new Image();
  img.onload = () => { el.style.backgroundImage = cssUrl(full); };
  img.src = full;
}

function bgAttrs(preview, full) {
  return `style="background-image:${cssUrl(preview)}"${full && full !== preview ? ` data-full="${esc(safeUrl(full))}"` : ''}`;
}

function renderHero() {
  const featured = [...state.games].filter(heroImage).sort(sorters.added).slice(0, CONFIG.heroCount);
  els.hero.classList.toggle('is-empty', !featured.length);
  if (!featured.length) { els.heroSlides.replaceChildren(); els.heroNav.replaceChildren(); return; }

  els.heroSlides.innerHTML = featured.map((g) => {
    const p = platformMeta(g.platform);
    const meta = [year(g), g.genres.slice(0, 3).join(' · ')].filter(Boolean).map(esc).join(' <span aria-hidden="true">•</span> ');
    const title = g.images.logo
      ? `<img class="hero-logo" src="${esc(safeUrl(g.images.logo))}" alt="${esc(g.name)}" data-title="${esc(g.name)}">`
      : `<h2 class="hero-title">${esc(g.name)}</h2>`;
    return `
      <div class="hero-slide" data-id="${g.id}">
        <div class="hero-bg" ${bgAttrs(heroPreview(g), heroImage(g))}></div>
        <div class="hero-content">
          ${title}
          <div class="hero-meta"><span class="badge" style="--pc:${p.color}">${esc(p.short)}</span>${meta}</div>
          ${g.summary ? `<p class="hero-summary">${esc(g.summary)}</p>` : '<p></p>'}
          <div><button class="btn btn-ghost" type="button" data-open="${g.id}">Voir la fiche</button></div>
        </div>
      </div>`;
  }).join('');

  els.heroNav.innerHTML = featured.length > 1
    ? featured.map((g, i) => `<button class="hero-dot" type="button" data-slide="${i}" aria-label="${esc(g.name)}"></button>`).join('')
    : '';

  heroIndex = Math.min(heroIndex, featured.length - 1);
  showSlide(heroIndex);
}

function showSlide(i) {
  const slides = $$('.hero-slide', els.heroSlides);
  if (!slides.length) return;
  heroIndex = (i + slides.length) % slides.length;
  slides.forEach((s, n) => s.classList.toggle('is-active', n === heroIndex));
  upgradeBg($('.hero-bg', slides[heroIndex]));
  upgradeBg($('.hero-bg', slides[(heroIndex + 1) % slides.length])); // on prépare le suivant
  $$('.hero-dot', els.heroNav).forEach((d, n) => {
    d.classList.remove('is-active');
    if (n === heroIndex) { void d.offsetWidth; d.classList.add('is-active'); } // relance la barre de progression
  });
  const game = state.games.find((g) => g.id === slides[heroIndex].dataset.id);
  if (game) setAmbient(game.images.grid || heroImage(game));
}

// La barre de progression du point actif sert de minuteur : quand elle est pleine, on passe au jeu suivant.
// Survoler le hero met l'animation en pause, donc le défilement aussi.
if (!reduceMotion) {
  els.heroNav.addEventListener('animationend', (e) => {
    if (e.target.classList.contains('is-active')) showSlide(heroIndex + 1);
  });
}
els.heroNav.addEventListener('click', (e) => {
  const dot = e.target.closest('[data-slide]');
  if (dot) showSlide(Number(dot.dataset.slide));
});
els.hero.addEventListener('mouseenter', () => els.hero.classList.add('is-paused'));
els.hero.addEventListener('mouseleave', () => els.hero.classList.remove('is-paused'));
els.hero.addEventListener('focusin', () => els.hero.classList.add('is-paused'));
els.hero.addEventListener('focusout', () => els.hero.classList.remove('is-paused'));

/* ==========================================================================
   Stats
   ========================================================================== */

function renderStats() {
  const games = state.games;
  if (!games.length) { els.stats.replaceChildren(); return; }
  const genreCount = {};
  for (const g of games) for (const genre of g.genres) genreCount[genre] = (genreCount[genre] || 0) + 1;
  const topGenre = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const recent = games.filter((g) => new Date(g.addedAt || 0).getTime() > monthAgo).length;

  const items = [
    { value: games.length, label: games.length > 1 ? 'jeux' : 'jeu' },
    { value: platformsInUse().length, label: 'plateformes' },
    { value: recent, label: 'ajoutés ce mois-ci' },
    topGenre && { text: topGenre, label: 'genre favori' },
  ].filter(Boolean);

  els.stats.innerHTML = items.map((s) =>
    `<div class="stat"><span class="stat-value">${s.text ? esc(s.text) : '0'}</span><span class="stat-label">${s.label}</span></div>`).join('');
  items.forEach((s, i) => { if (!s.text) countUp(els.stats.children[i].firstElementChild, s.value); });
}

/* ==========================================================================
   Onglets de plateformes
   ========================================================================== */

function renderTabs() {
  const counts = {};
  for (const g of state.games) counts[g.platform] = (counts[g.platform] || 0) + 1;
  const ids = platformsInUse();
  if (state.platform !== 'all' && !ids.includes(state.platform)) state.platform = 'all';

  const tabs = [{ id: 'all', short: 'Tout', color: 'var(--accent)', count: state.games.length },
    ...ids.map((id) => ({ ...platformMeta(id), id, count: counts[id] }))];

  $$('.tab', els.tabs).forEach((t) => t.remove());
  els.tabs.insertAdjacentHTML('beforeend', tabs.map((t) => `
    <button class="tab${t.id === state.platform ? ' is-active' : ''}" type="button" role="tab"
      aria-selected="${t.id === state.platform}" data-platform="${esc(t.id)}" style="--pc:${t.color}">
      ${t.id === 'all' ? '' : '<span class="tab-dot"></span>'}${esc(t.short)}<span class="tab-count">${t.count}</span>
    </button>`).join(''));
  moveIndicator();
}

function moveIndicator() {
  const active = $('.tab.is-active', els.tabs);
  if (!active) return;
  els.indicator.style.width = `${active.offsetWidth}px`;
  els.indicator.style.transform = `translateX(${active.offsetLeft}px)`;
  els.indicator.style.setProperty('--pc', active.style.getPropertyValue('--pc'));
}

function selectPlatform(id) {
  if (id === state.platform) return;
  nameVisibleCards();
  if (canTransition) els.indicator.style.viewTransitionName = 'tab-indicator';
  const t = transition(() => {
    state.platform = id;
    store.set('platform', id);
    $$('.tab', els.tabs).forEach((tab) => {
      const on = tab.dataset.platform === id;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on);
    });
    moveIndicator();
    renderLibrary({ animate: !canTransition });
    nameVisibleCards();
  });
  t?.finished.finally(() => { clearCardNames(); els.indicator.style.viewTransitionName = ''; });
  $('.tab.is-active', els.tabs)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
}

els.tabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) selectPlatform(tab.dataset.platform);
});

addEventListener('resize', moveIndicator);

/* ==========================================================================
   Bibliothèque
   ========================================================================== */

function cardHtml(g) {
  const p = platformMeta(g.platform);
  const sources = [g.images.grid, g.images.cover].map(safeUrl).filter(Boolean);
  const sub = [year(g), g.genres[0]].filter(Boolean).map(esc).join(' · ');
  const visual = sources.length
    ? `<img class="card-img is-loading" src="${esc(sources[0])}" data-fallbacks="${esc(sources.slice(1).join(' '))}" data-title="${esc(g.name)}" alt="" loading="lazy" decoding="async">`
    : `<div class="card-fallback">${esc(g.name)}</div>`;
  return `
    <button class="card" type="button" data-id="${g.id}" style="--pc:${p.color}" aria-label="${esc(g.name)} (${esc(p.short)})">
      <div class="card-inner"${g.images.gridThumb ? ` style="background-image:${cssUrl(g.images.gridThumb)}"` : ''}>
        ${visual}
        <span class="badge card-plat" style="--pc:${p.color}">${esc(p.short)}</span>
        <div class="card-glare"></div>
        <div class="card-info"><h3>${esc(g.name)}</h3><p>${sub}</p></div>
      </div>
    </button>`;
}

function pendingHtml(p) {
  const meta = platformMeta(p.platform);
  return `
    <div class="card is-pending" style="--pc:${meta.color}" title="Ajout en cours via GitHub">
      <div class="card-inner shimmer">
        <div class="card-fallback"><span class="spinner"></span>${esc(p.name)}<small>Ajout en cours…</small></div>
      </div>
    </div>`;
}

function renderLibrary({ animate = true } = {}) {
  const list = filteredGames().sort(sorters[state.sort] || sorters.added);
  state.visible = list;
  const q = norm(state.query);
  const pending = state.pending.filter((p) =>
    (state.platform === 'all' || p.platform === state.platform) && (!q || norm(p.name).includes(q)));

  if (!state.games.length && !pending.length) {
    els.library.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🕹️</div>
        <h2>Ta ludothèque est vide</h2>
        <p>Ajoute ton premier jeu : la jaquette et les infos arrivent toutes seules.</p>
        <button class="btn btn-primary" type="button" data-action="add">Ajouter un jeu</button>
      </div>`;
    return;
  }

  if (!list.length && !pending.length) {
    els.library.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔍</div>
        <h2>Aucun jeu trouvé</h2>
        <p>Rien ne correspond à « ${esc(state.query)} »${state.platform !== 'all' ? ` sur ${esc(platformMeta(state.platform).short)}` : ''}.</p>
      </div>`;
    return;
  }

  const ids = state.platform === 'all' ? platformsInUse() : [state.platform];
  for (const p of pending) if (!ids.includes(p.platform)) ids.push(p.platform);

  els.library.innerHTML = ids.map((id) => {
    const games = list.filter((g) => g.platform === id);
    const ghosts = pending.filter((p) => p.platform === id);
    if (!games.length && !ghosts.length) return '';
    const meta = platformMeta(id);
    return `
      <section class="shelf" style="--pc:${meta.color}" aria-label="${esc(meta.id)}">
        <header class="shelf-head">
          <span class="shelf-bar"></span>
          <h2>${esc(meta.id)}</h2>
          <span class="tab-count">${games.length}</span>
          <span class="shelf-line"></span>
        </header>
        <div class="grid">${ghosts.map(pendingHtml).join('')}${games.map(cardHtml).join('')}</div>
      </section>`;
  }).join('');

  if (animate) reveal();
}

/* ---------- Apparition des cartes au défilement ---------- */

const revealObserver = 'IntersectionObserver' in window && !reduceMotion
  ? new IntersectionObserver((entries) => {
    let i = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.style.setProperty('--delay', `${Math.min(i++, 12) * 45}ms`);
      entry.target.classList.add('in');
      revealObserver.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -40px 0px' })
  : null;

function reveal() {
  if (!revealObserver) return;
  revealObserver.disconnect();
  for (const card of $$('.card', els.library)) {
    card.classList.add('reveal');
    revealObserver.observe(card);
  }
}

/* ---------- Images : fondu à l'arrivée, repli si l'URL est cassée ---------- */

els.library.addEventListener('load', (e) => {
  if (e.target.classList?.contains('card-img')) e.target.classList.remove('is-loading');
}, true);

document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const [next, ...rest] = (img.dataset.fallbacks || '').split(' ').filter(Boolean);
  if (next) {
    img.dataset.fallbacks = rest.join(' ');
    img.src = next;
    return;
  }
  if (img.classList.contains('card-img') || img.closest('.detail-cover')) {
    const div = document.createElement('div');
    div.className = 'card-fallback';
    div.textContent = img.dataset.title || '';
    img.replaceWith(div);
  } else if (img.classList.contains('hero-logo')) {
    const h = document.createElement('h2');
    h.className = 'hero-title';
    h.textContent = img.dataset.title || '';
    img.replaceWith(h);
  } else {
    img.remove();
  }
}, true);

/* ---------- Effet 3D au survol ---------- */

let tiltCard = null;
let tiltFrame = 0;
let ambientTimer = 0;

function resetTilt(card) {
  card.classList.remove('is-tilting');
  card.style.removeProperty('--rx');
  card.style.removeProperty('--ry');
}

if (canHover && !reduceMotion) {
  els.library.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.card:not(.is-pending)');
    if (card !== tiltCard) {
      if (tiltCard) resetTilt(tiltCard);
      tiltCard = card;
    }
    if (!card) return;
    cancelAnimationFrame(tiltFrame);
    tiltFrame = requestAnimationFrame(() => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.classList.add('is-tilting');
      card.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
      card.style.setProperty('--rx', `${(0.5 - y) * 14}deg`);
      card.style.setProperty('--mx', `${x * 100}%`);
      card.style.setProperty('--my', `${y * 100}%`);
    });
  });
  els.library.addEventListener('pointerleave', () => {
    if (tiltCard) resetTilt(tiltCard);
    tiltCard = null;
  });
}

els.library.addEventListener('pointerover', (e) => {
  const card = e.target.closest('.card[data-id]');
  if (!card) return;
  clearTimeout(ambientTimer);
  ambientTimer = setTimeout(() => {
    const g = state.games.find((x) => x.id === card.dataset.id);
    if (g) setAmbient(g.images.grid || g.images.cover || heroImage(g));
  }, 180);
});

els.library.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="add"]')) { openAdd(); return; }
  const card = e.target.closest('.card[data-id]');
  if (card) openDetail(card.dataset.id);
});

/* ==========================================================================
   Recherche & tri
   ========================================================================== */

let searchTimer = 0;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = els.search.value;
    renderLibrary();
  }, 120);
});

els.sort.addEventListener('change', () => {
  nameVisibleCards();
  const t = transition(() => {
    state.sort = els.sort.value;
    store.set('sort', state.sort);
    renderLibrary({ animate: !canTransition });
    nameVisibleCards();
  });
  t?.finished.finally(clearCardNames);
});

/* ==========================================================================
   Modales
   ========================================================================== */

let lastFocus = null;

function openModal(modal, { viaTransition = false } = {}) {
  lastFocus = document.activeElement;
  modal.classList.toggle('vt', viaTransition);
  modal.classList.remove('is-closing');
  modal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeModal(modal, { instant = false } = {}) {
  if (modal.hidden) return;
  const done = () => {
    modal.hidden = true;
    modal.classList.remove('is-closing', 'vt');
    if (!$$('.modal').some((m) => !m.hidden)) document.body.classList.remove('modal-open');
    lastFocus?.focus?.({ preventScroll: true });
  };
  if (instant || reduceMotion) { done(); return; }
  modal.classList.add('is-closing');
  setTimeout(done, 260);
}

for (const modal of $$('.modal')) {
  modal.addEventListener('click', (e) => {
    if (!e.target.closest('[data-close]')) return;
    if (modal === els.detail) closeDetail(); else closeModal(modal);
  });
  // Garde le focus clavier dans la modale
  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = $$('a[href], button:not([disabled]), input, select, summary', modal).filter((el) => el.offsetParent);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/* ---------- Fiche d'un jeu ---------- */

function cardInnerFor(id) {
  const inner = $(`.card[data-id="${CSS.escape(id)}"] .card-inner`, els.library);
  return inner && inViewport(inner) ? inner : null;
}

function ratingColor(r) {
  return r >= 80 ? '#34d399' : r >= 60 ? '#fbbf24' : '#ff7a59';
}

function renderDetail(g) {
  const p = platformMeta(g.platform);
  const list = state.visible.some((x) => x.id === g.id) ? state.visible : state.games;
  const index = list.findIndex((x) => x.id === g.id);
  const prev = list[index - 1];
  const next = list[index + 1];
  const heroBg = heroImage(g) || g.images.grid || g.images.cover;
  const heroBgPreview = heroImage(g) ? heroPreview(g) : g.images.gridThumb || heroBg;
  const cover = safeUrl(g.images.grid) || safeUrl(g.images.cover);

  const facts = [
    ['Sortie', fmtDate(g.releaseDate)],
    g.developers.length && ['Studio', g.developers.slice(0, 2).join(', ')],
    ['Ajouté le', fmtDate(g.addedAt)],
  ].filter(Boolean);

  const links = [
    g.igdbUrl && ['IGDB', g.igdbUrl],
    g.sgdbId && ['SteamGridDB', `https://www.steamgriddb.com/game/${g.sgdbId}`],
    g.steamAppId && ['Steam', `https://store.steampowered.com/app/${g.steamAppId}`],
  ].filter(Boolean);

  const shots = g.images.screenshots.map(safeUrl).filter(Boolean).slice(0, 6);

  els.detailPanel.innerHTML = `
    <button class="icon-btn modal-close" type="button" data-close aria-label="Fermer">
      <svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>
    </button>
    <div class="detail-hero">
      <div class="detail-hero-bg${heroImage(g) ? '' : ' is-blurred'}" ${bgAttrs(heroBgPreview, heroBg)}></div>
      ${g.images.logo ? `<img class="detail-logo" src="${esc(safeUrl(g.images.logo))}" alt="">` : ''}
    </div>
    <div class="detail-body">
      <div class="detail-cover" id="detail-cover">
        ${cover
          ? `<img src="${esc(cover)}" data-fallbacks="${esc(cover === safeUrl(g.images.cover) ? '' : safeUrl(g.images.cover))}" data-title="${esc(g.name)}" alt="Jaquette de ${esc(g.name)}">`
          : `<div class="card-fallback" style="--pc:${p.color}">${esc(g.name)}</div>`}
      </div>
      <div class="detail-main">
        <div class="detail-top">
          <span class="badge" style="--pc:${p.color}">${esc(p.id)}</span>
          ${g.rating != null ? `
            <div class="rating" style="--rating-color:${ratingColor(g.rating)}" title="Note IGDB">
              <svg viewBox="0 0 60 60"><circle class="track" cx="30" cy="30" r="26"/><circle class="value" cx="30" cy="30" r="26"/></svg>
              <span>${Math.round(g.rating)}</span>
            </div>` : ''}
        </div>
        <h2 id="detail-title">${esc(g.name)}</h2>
        <dl class="facts">${facts.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        ${g.genres.length ? `<div class="genres">${g.genres.map((x) => `<span class="genre">${esc(x)}</span>`).join('')}</div>` : '<div></div>'}
        ${g.summary ? `<p class="summary">${esc(g.summary)}</p>` : '<p class="summary">Pas encore de résumé pour ce jeu.</p>'}
        ${shots.length ? `<div class="shots">${shots.map((s) => `<button type="button" data-shot="${esc(s)}"><img src="${esc(s.replace('/t_1080p/', '/t_screenshot_med/'))}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        ${links.length ? `<div class="links">${links.map(([label, url]) => `<a class="btn btn-ghost" href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${label} ↗</a>`).join('')}</div>` : ''}
      </div>
    </div>
    <nav class="detail-nav" aria-label="Jeu précédent ou suivant">
      ${prev ? `<button type="button" data-goto="${prev.id}">← ${esc(prev.name)}</button>` : '<span></span>'}
      <span>${index + 1} / ${list.length}</span>
      ${next ? `<button type="button" data-goto="${next.id}">${esc(next.name)} →</button>` : '<span></span>'}
    </nav>`;

  upgradeBg($('.detail-hero-bg', els.detailPanel));
  const ring = $('.rating .value', els.detailPanel);
  if (ring) requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.strokeDashoffset = 163.36 * (1 - Math.min(100, g.rating) / 100);
  }));
  els.detailPanel.scrollTop = 0;
}

function openDetail(id) {
  const g = state.games.find((x) => x.id === id);
  if (!g) return;
  const wasOpen = !els.detail.hidden;
  state.detailId = id;
  history.replaceState(null, '', `#jeu/${id}`);
  setAmbient(g.images.grid || heroImage(g));

  if (wasOpen) {
    renderDetail(g);
    els.detailPanel.animate?.([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out' });
    $('.modal-close', els.detailPanel).focus({ preventScroll: true });
    return;
  }

  // La jaquette « s'envole » de la carte jusqu'à la fiche grâce à une View Transition partagée
  const inner = canTransition ? cardInnerFor(id) : null;
  if (inner) inner.style.viewTransitionName = 'active-cover';
  const t = inner ? transition(() => {
    inner.style.viewTransitionName = '';
    renderDetail(g);
    $('#detail-cover').style.viewTransitionName = 'active-cover';
    openModal(els.detail, { viaTransition: true });
  }) : null;

  if (!t) {
    renderDetail(g);
    openModal(els.detail);
  }
  const focus = () => $('.modal-close', els.detailPanel)?.focus({ preventScroll: true });
  if (t) t.finished.finally(() => { $('#detail-cover') && ($('#detail-cover').style.viewTransitionName = ''); focus(); });
  else focus();
}

function closeDetail() {
  if (els.detail.hidden) return;
  const id = state.detailId;
  state.detailId = null;
  history.replaceState(null, '', location.pathname + location.search);
  const cover = $('#detail-cover');
  const inner = canTransition && id ? cardInnerFor(id) : null;
  if (!inner || !cover) { closeModal(els.detail); return; }
  cover.style.viewTransitionName = 'active-cover';
  const t = transition(() => {
    cover.style.viewTransitionName = '';
    inner.style.viewTransitionName = 'active-cover';
    closeModal(els.detail, { instant: true });
  });
  t.finished.finally(() => { inner.style.viewTransitionName = ''; });
}

els.detailPanel.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) { openDetail(go.dataset.goto); return; }
  const shot = e.target.closest('[data-shot]');
  if (shot) openLightbox(shot.dataset.shot);
});

function openLightbox(url) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${esc(url)}" alt="">`;
  box.addEventListener('click', () => box.remove());
  document.body.append(box);
}

els.heroSlides.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open]');
  if (btn) openDetail(btn.dataset.open);
});

/* ---------- Ajout d'un jeu ---------- */

let duplicateConfirmed = false;

function openAdd() {
  const last = store.get('lastPlatform', 'PC');
  const selected = state.platform !== 'all' ? state.platform : last;
  els.addPlatforms.innerHTML = PLATFORMS.map((p) => `
    <label class="chip" style="--pc:${p.color}">
      <input type="radio" name="platform" value="${esc(p.id)}"${p.id === selected ? ' checked' : ''}>
      <span>${esc(p.short)}</span>
    </label>`).join('');
  if (!$('input:checked', els.addPlatforms)) $('input', els.addPlatforms).checked = true;

  els.addForm.reset();
  $(`input[value="${CSS.escape(selected)}"]`, els.addPlatforms)?.click();
  els.addWarning.hidden = true;
  duplicateConfirmed = false;
  updateAddHelp();
  openModal(els.add);
  setTimeout(() => els.addName.focus(), 50);
}

function cliCommand(name, platform, igdb) {
  const q = (s) => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;
  return `node scripts/add-game.mjs ${q(name || 'Nom du jeu')} --platform ${q(platform)}${igdb ? ` --igdb ${igdb}` : ''}`;
}

function updateAddHelp() {
  const platform = $('input:checked', els.addPlatforms)?.value || 'PC';
  if (state.repo) {
    els.addHelp.innerHTML = `Une page GitHub s'ouvre avec le formulaire déjà rempli : clique sur <b>Create</b>.
      Le jeu apparaît ici environ une minute plus tard.`;
    $('span', els.addSubmit).textContent = duplicateConfirmed ? 'Ajouter quand même' : 'Continuer sur GitHub';
  } else {
    els.addHelp.innerHTML = `Dépôt GitHub non détecté (le site tourne en local). Renseigne <b>CONFIG.repo</b> dans
      <b>assets/app.js</b>, ou ajoute le jeu en ligne de commande :
      <code>${esc(cliCommand(els.addName.value.trim(), platform, els.addIgdb.value.trim()))}</code>`;
    $('span', els.addSubmit).textContent = 'Copier la commande';
  }
}

els.addForm.addEventListener('input', (e) => {
  if (e.target === els.addName) { duplicateConfirmed = false; els.addWarning.hidden = true; }
  updateAddHelp();
});

els.addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = els.addName.value.trim().replace(/\s+/g, ' ');
  const platform = $('input:checked', els.addPlatforms)?.value;
  const igdb = els.addIgdb.value.trim();
  if (!name || !platform) {
    els.addForm.classList.remove('shake');
    void els.addForm.offsetWidth;
    els.addForm.classList.add('shake');
    els.addName.focus();
    return;
  }
  store.set('lastPlatform', platform);

  if (!state.repo) {
    try {
      await navigator.clipboard.writeText(cliCommand(name, platform, igdb));
      toast('📋', 'Commande copiée', ' Colle-la dans un terminal, à la racine du projet.');
    } catch {
      toast('⚠️', 'Copie impossible', ' Sélectionne la commande à la main.');
    }
    return;
  }

  const dup = state.games.find((g) => g.platform === platform && norm(g.name) === norm(name));
  if (dup && !duplicateConfirmed) {
    duplicateConfirmed = true;
    els.addWarning.textContent = `${dup.name} est déjà dans ta collection sur ${platformMeta(platform).short}.`;
    els.addWarning.hidden = false;
    updateAddHelp();
    return;
  }

  const url = new URL(`https://github.com/${state.repo}/issues/new`);
  url.searchParams.set('template', 'add-game.yml');
  url.searchParams.set('title', `[Ajout] ${name} (${platform})`);
  url.searchParams.set('name', name);
  url.searchParams.set('platform', platform);
  if (igdb) url.searchParams.set('igdb', igdb);
  window.open(url, '_blank', 'noopener');

  state.pending = [{ name, platform, at: Date.now() }, ...state.pending];
  store.set('pending', state.pending);
  closeModal(els.add);
  renderLibrary();
  schedulePoll();
  toast('🚀', `${name} est en route`, ' Valide l\'issue sur GitHub, la carte se mettra à jour toute seule.', 7000);
});

$('#open-add').addEventListener('click', openAdd);

/* ==========================================================================
   Clavier, scroll, démarrage
   ========================================================================== */

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    const box = $('.lightbox');
    if (box) { box.remove(); return; }
    if (!els.add.hidden) closeModal(els.add);
    else if (!els.detail.hidden) closeDetail();
    return;
  }
  if (!els.detail.hidden && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !$('.lightbox')) {
    const btn = $$('[data-goto]', els.detailPanel).find((b) => (e.key === 'ArrowLeft' ? b.textContent.startsWith('←') : b.textContent.endsWith('→')));
    if (btn) openDetail(btn.dataset.goto);
    return;
  }
  if (e.key === '/' && !typing && els.add.hidden && els.detail.hidden) {
    e.preventDefault();
    els.search.focus();
  }
});

const topbar = $('.topbar');
addEventListener('scroll', () => topbar.classList.toggle('is-scrolled', scrollY > 8), { passive: true });

function renderSkeleton() {
  els.library.innerHTML = `
    <section class="shelf">
      <header class="shelf-head"><span class="shimmer" style="width:160px;height:24px;border-radius:8px"></span></header>
      <div class="grid">${'<div class="card skeleton"><div class="card-inner"></div></div>'.repeat(12)}</div>
    </section>`;
}

function renderAll() {
  renderHero();
  renderStats();
  renderTabs();
  renderLibrary();
}

async function init() {
  state.platform = store.get('platform', 'all');
  state.sort = store.get('sort', 'added');
  if (!sorters[state.sort]) state.sort = 'added';
  els.sort.value = state.sort;
  renderSkeleton();

  try {
    state.games = await fetchGames();
  } catch (err) {
    console.error(err);
    state.games = [];
    toast('⚠️', 'Collection introuvable', ' Impossible de lire data/games.json.');
  }

  loadPending();
  renderAll();
  schedulePoll();

  const deep = location.hash.match(/^#jeu\/(.+)$/);
  if (deep) openDetail(decodeURIComponent(deep[1]));

  if (document.fonts) document.fonts.ready.then(moveIndicator);
}

init();
