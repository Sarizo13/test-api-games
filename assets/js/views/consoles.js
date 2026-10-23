// Consoles : un dossier par console (seulement celles qui contiennent au moins un jeu), puis la page
// d'une console avec sa bande-annonce, ses chiffres et ses cartes.

import { PLATFORMS, FAMILIES, platformMeta } from '../../platforms.js';
import { state, saveSettings, TEST } from '../state.js';
import { cardHtml, cardStats, attachHolo, ratingAverage, STATUS, TIERS } from '../card.js';
import { youtubeTrailer, trailersAllowed } from '../trailer.js';
import { requireEdit, openAdd } from '../add.js';
import { makerLogo, consoleLogo, consolePhoto } from '../brands.js';
import { sectionHead, emptyState, thumb } from './common.js';
import { $, esc, cssUrl, norm, fmtHours, avg, sum, local, setAmbient, toast, ICONS } from '../util.js';

const slug = (s) => norm(s).replace(/ /g, '-');
export const consoleHref = (platformId) => `#/console/${slug(platformMeta(platformId).short)}`;
export const platformFromSlug = (s) => PLATFORMS.find((p) => slug(p.short) === s || slug(p.id) === s);

/* ---------- Tous les dossiers ---------- */

export function renderConsoles(view) {
  const byPlatform = new Map();
  for (const g of state.games) {
    if (!byPlatform.has(g.platform)) byPlatform.set(g.platform, []);
    byPlatform.get(g.platform).push(g);
  }

  const folder = (p, games, i) => {
    const covers = [...games].sort((a, b) => cardStats(b).power - cardStats(a).power).slice(0, 3);
    const played = games.filter((g) => g.status !== 'backlog').length;
    return `
      <a class="folder" href="${consoleHref(p.id)}" style="--c:${p.color};--i:${i}" aria-label="${esc(p.id)} : ${games.length} jeux">
        <span class="folder-tab"></span>
        <span class="folder-papers">${covers.map((g) => thumb(g)).join('')}</span>
        <span class="folder-body">
          <span class="folder-brand" aria-hidden="true">${makerLogo(p)}</span>
          <span><span class="folder-name">${esc(p.id)}</span>${p.year ? `<span class="folder-year">${p.year}</span>` : ''}</span>
          <span class="folder-meta">
            <span>${played}/${games.length} lancés<br>${fmtHours(sum(games.map((g) => g.playtimeMinutes ?? 0)))}</span>
            <span class="folder-count">${games.length}</span>
          </span>
        </span>
      </a>`;
  };

  let i = 0;
  const families = FAMILIES.map((f) => {
    const list = PLATFORMS.filter((p) => p.family === f.id && byPlatform.has(p.id));
    // Consoles inconnues de la liste (ajoutées à la main) : rangées dans « Autres »
    const unknown = f.id === 'autres' ? [...byPlatform.keys()].filter((id) => !PLATFORMS.some((p) => p.id === id)).map(platformMeta) : [];
    const all = [...list, ...unknown];
    return all.length ? `
      <section class="family">
        ${sectionHead(esc(f.name), `<span class="muted" style="font-size:13px">${all.reduce((a, p) => a + byPlatform.get(p.id).length, 0)} jeux</span>`)}
        <div class="folders">${all.map((p) => folder(p, byPlatform.get(p.id), i++)).join('')}</div>
      </section>` : '';
  }).join('');

  view.innerHTML = `
    <div class="page-head">
      <div><p class="kicker">Collection</p><h1>Mes consoles</h1>
      <p>Un dossier par console. Une console apparaît dès qu'elle contient un jeu.</p></div>
      <button class="btn btn-primary" type="button" data-action="add">${ICONS.plus}Ajouter un jeu</button>
    </div>
    ${families || emptyState('🗂️', 'Aucune console pour l\'instant', 'Ajoute un jeu : sa console apparaîtra ici sous forme de dossier.', '<button class="btn btn-primary" type="button" data-action="add">Ajouter un jeu</button>')}`;
}

/* ---------- Page d'une console ---------- */

const FILTERS = [['all', 'Tous'], ...Object.entries(STATUS).map(([k, s]) => [k, s.label])];
const SORTS = {
  added: ['Ajout récent', (a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '')],
  power: ['Puissance', (a, b) => cardStats(b).power - cardStats(a).power],
  name: ['Nom', (a, b) => a.name.localeCompare(b.name, 'fr')],
  rating: ['Ma note', (a, b) => (ratingAverage(b) ?? -1) - (ratingAverage(a) ?? -1)],
  time: ['Temps de jeu', (a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0)],
  release: ['Date de sortie', (a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')],
};

export function renderConsole(view, platformSlug) {
  const p = platformFromSlug(platformSlug) ?? platformMeta(decodeURIComponent(platformSlug));
  const games = state.games.filter((g) => g.platform === p.id);
  let filter = local.get(`filter:${p.id}`, 'all');
  let sort = local.get('sort', 'added');
  if (!SORTS[sort]) sort = 'added';

  const trailerId = state.settings.consoleTrailers?.[p.id] ?? p.trailer;
  // La photo de la console ; à défaut (arcade, mobile…), l'image du meilleur jeu
  const photo = consolePhoto(p);
  const bgGame = photo ? null : [...games].filter((g) => g.images?.hero).sort((a, b) => cardStats(b).power - cardStats(a).power)[0];
  const played = games.filter((g) => g.status !== 'backlog');
  const ratings = games.map(ratingAverage).filter((r) => r != null);
  const done = games.filter((g) => ['finished', 'completed'].includes(g.status));
  const best = [...games].sort((a, b) => cardStats(b).power - cardStats(a).power)[0];

  view.innerHTML = `
    <section class="console-hero${trailerId && trailersAllowed ? ' has-trailer' : ''}" style="--c:${p.color}">
      <div class="hero-bg" style="${bgGame
        ? `background-image:${cssUrl(bgGame.images.heroThumb || bgGame.images.hero)}`
        // Sinon un fond opaque : la vidéo doit rester cachée pendant le zoom
        : 'background:radial-gradient(70% 90% at 75% 45%, color-mix(in srgb, var(--c) 55%, transparent), transparent 70%), linear-gradient(160deg, color-mix(in srgb, var(--c) 28%, #151826), #08090f)'}">
        ${photo ? `<img class="hero-photo" src="${esc(photo.src)}" alt="${esc(p.id)}" decoding="async">` : ''}
      </div>
      <div class="hero-tools">
        <button class="icon-btn" type="button" data-trailer title="Changer la bande-annonce de la console" aria-label="Changer la bande-annonce">${ICONS.edit}</button>
      </div>
      ${photo ? `<a class="hero-credit" href="${esc(photo.page)}" target="_blank" rel="noopener">Photo : Wikimedia Commons</a>` : ''}
      <div>
        <span class="console-mark">${consoleLogo(p)}</span>
        <p class="kicker">${esc(FAMILIES.find((f) => f.id === p.family)?.name ?? '')}${p.year ? ` · ${p.year}` : ''}</p>
        <h1>${esc(p.id)}</h1>
        <p>${games.length} jeu${games.length > 1 ? 'x' : ''} · ${played.length} lancé${played.length > 1 ? 's' : ''} · ${fmtHours(sum(games.map((g) => g.playtimeMinutes ?? 0)))} de jeu</p>
      </div>
    </section>

    <section class="stats">
      ${[
        { label: 'jeux', value: games.length, c: p.color },
        { label: 'terminés', value: done.length, c: '#34d399' },
        { label: 'note moyenne', value: ratings.length ? avg(ratings).toFixed(1).replace('.', ',') : '—', c: '#fbbf24' },
        { label: 'meilleure carte', value: best ? cardStats(best).power : '—', sub: best?.name, c: best ? TIERS[cardStats(best).tier].color : '#888' },
      ].map((s, i) => `<div class="stat" style="--i:${i};--c:${s.c}"><span class="stat-value">${esc(s.value)}</span><span class="stat-label">${s.label}</span>${s.sub ? `<span class="stat-sub">${esc(s.sub)}</span>` : ''}</div>`).join('')}
    </section>

    <div class="toolbar">
      <div class="chips" id="filters"></div>
      <span class="spacer"></span>
      <select class="select" id="sort" aria-label="Trier">${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${label}</option>`).join('')}</select>
    </div>
    <div id="grid"></div>`;

  const renderGrid = () => {
    $('#filters', view).innerHTML = FILTERS.map(([k, label]) => {
      const n = k === 'all' ? games.length : games.filter((g) => g.status === k).length;
      if (k !== 'all' && !n) return '';
      return `<button class="chip${k === filter ? ' is-on' : ''}" type="button" data-filter="${k}" style="--c:${STATUS[k]?.color ?? p.color}">${esc(label)} <span class="chip-count">${n}</span></button>`;
    }).join('');
    const list = games.filter((g) => filter === 'all' || g.status === filter).sort(SORTS[sort][1]);
    $('#grid', view).innerHTML = list.length
      ? `<div class="cards">${list.map((g, i) => cardHtml(g, { i })).join('')}</div>`
      : emptyState('🗂️', 'Rien ici', 'Aucun jeu ne correspond à ce filtre.');
  };
  renderGrid();
  attachHolo(view);
  if (best) setAmbient(best.images?.gridThumb || best.images?.cover);

  view.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; local.set(`filter:${p.id}`, filter); renderGrid(); return; }
    if (e.target.closest('[data-trailer]')) {
      requireEdit(async () => {
        const value = prompt(`Lien YouTube de la bande-annonce de la ${p.id} (vide pour remettre celle par défaut) :`, trailerId ? `https://youtu.be/${trailerId}` : '');
        if (value === null) return;
        try {
          await saveSettings({ consoleTrailers: { [p.id]: value } });
          toast('🎬', 'Bande-annonce mise à jour', TEST ? ' (mode test)' : '');
          location.reload();
        } catch (err) { toast('⚠️', 'Lien refusé', ` ${err.message}`); }
      });
    }
  });
  $('#sort', view).addEventListener('change', (e) => { sort = e.target.value; local.set('sort', sort); renderGrid(); });

  // Bande-annonce de la console derrière le bandeau
  let trailer = null;
  if (trailerId && trailersAllowed) {
    const hero = $('.console-hero', view);
    trailer = youtubeTrailer($('.hero-bg', hero), trailerId, { soundParent: hero });
  }
  return () => trailer?.stop();
}

/** Ajouter un jeu directement sur cette console. */
export const addOnConsole = (platformId) => openAdd({ platform: platformId });
