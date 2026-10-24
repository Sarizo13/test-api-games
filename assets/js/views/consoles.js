// Consoles : un dossier par console (seulement celles qui contiennent au moins un jeu), puis la page
// d'une console : bandeau (photo, logo, zoom puis diaphragme sur la bande-annonce), chiffres, filtres et cartes.

import { PLATFORMS, FAMILIES, platformMeta } from '../../platforms.js';
import { state, saveSettings, TEST } from '../state.js';
import { cardHtml, cardStats, attachHolo, ratingAverage, STATUS, TIERS } from '../card.js';
import { youtubeTrailer, trailersAllowed } from '../trailer.js';
import { requireEdit, openAdd } from '../add.js';
import { makerLogo, consoleLogo, consolePhoto } from '../brands.js';
import { pageHead, emptyState } from './common.js';
import { $, esc, safeUrl, norm, fmtHours, avg, sum, local, setAmbient, toast } from '../util.js';

const slug = (s) => norm(s).replace(/ /g, '-');
export const consoleHref = (platformId) => `#/console/${slug(platformMeta(platformId).short)}`;
export const platformFromSlug = (s) => PLATFORMS.find((p) => slug(p.short) === s || slug(p.id) === s);

const cover = (g) => safeUrl(g.images?.gridThumb) || safeUrl(g.images?.cover) || safeUrl(g.images?.grid);
// Éventail des jaquettes qui dépassent du dossier, selon leur nombre (la dernière passe devant)
const FANS = { 1: [[0, 0, 0]], 2: [[-30, 6, -6], [30, 6, 6]], 3: [[-44, 10, -9], [44, 10, 9], [0, 0, 0]] };

/* ---------- Tous les dossiers ---------- */

export function renderConsoles(view) {
  const byPlatform = new Map();
  for (const g of state.games) {
    if (!byPlatform.has(g.platform)) byPlatform.set(g.platform, []);
    byPlatform.get(g.platform).push(g);
  }

  const folder = (p, games) => {
    const covers = [...games].sort((a, b) => cardStats(b).power - cardStats(a).power).map(cover).filter(Boolean).slice(0, 3);
    const played = games.filter((g) => g.status !== 'backlog').length;
    return `
      <a class="folder" href="${consoleHref(p.id)}" style="--c:${p.color}" aria-label="${esc(p.id)} : ${games.length} jeu${games.length > 1 ? 'x' : ''}">
        <div class="folder__back"></div>
        ${covers.map((src, i) => {
          const [dx, dy, r] = FANS[covers.length][i];
          return `<img class="folder__cover" src="${esc(src)}" alt="" loading="lazy" style="--dx:${dx}px;--dy:${dy}px;--r:${r}deg">`;
        }).join('')}
        <div class="folder__front">
          <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">
            <div><div class="folder__name">${esc(p.id)}</div>${p.year ? `<div class="folder__year">${p.year}</div>` : ''}</div>
            ${makerLogo(p, 'folder__logo')}
          </div>
          <div class="row" style="justify-content:space-between;align-items:flex-end">
            <div class="folder__meta">${played}/${games.length} lancé${played > 1 ? 's' : ''}<br>${fmtHours(sum(games.map((g) => g.playtimeMinutes ?? 0)))}</div>
            <div class="folder__count">${games.length}</div>
          </div>
        </div>
      </a>`;
  };

  const families = FAMILIES.map((f) => {
    const list = PLATFORMS.filter((p) => p.family === f.id && byPlatform.has(p.id));
    // Consoles inconnues de la liste (ajoutées à la main) : rangées dans « Autres »
    const unknown = f.id === 'autres' ? [...byPlatform.keys()].filter((id) => !PLATFORMS.some((p) => p.id === id)).map(platformMeta) : [];
    const all = [...list, ...unknown];
    const n = all.reduce((a, p) => a + byPlatform.get(p.id).length, 0);
    return all.length ? `
      <section class="family">
        <div class="family__head"><h2 class="h-section">${esc(f.name)}</h2><span class="note">${n} jeu${n > 1 ? 'x' : ''}</span></div>
        <div class="folders">${all.map((p) => folder(p, byPlatform.get(p.id))).join('')}</div>
      </section>` : '';
  }).join('');

  view.innerHTML = `
    ${pageHead('Collection', 'Mes consoles', '', `${byPlatform.size} console${byPlatform.size > 1 ? 's' : ''} · ${state.games.length} jeu${state.games.length > 1 ? 'x' : ''} · un dossier apparaît dès qu'une console contient un jeu.`,
      '<button class="btn btn--primary" type="button" data-action="add" data-edit>+ Ajouter un jeu</button>')}
    ${families || emptyState('▦', 'Aucune console pour l\'instant', 'Ajoute un jeu : sa console apparaîtra ici sous forme de dossier.', '<button class="btn btn--primary" type="button" data-action="add" data-edit>+ Ajouter un jeu</button><a class="btn" href="#/comptes">Importer mes jeux</a>')}`;
  setAmbient(null);
}

/* ---------- Page d'une console ---------- */

const FILTERS = [['all', 'Tous', ''], ...Object.entries(STATUS).map(([k, s]) => [k, s.label, s.icon])];
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
  const family = FAMILIES.find((f) => f.id === p.family)?.name ?? '';

  view.innerHTML = `
    <section class="banner banner--console" style="--c:${p.color}" aria-label="${esc(p.id)}">
      <div class="banner__cover"><div class="banner__zoom">
        ${bgGame ? `<img class="banner__hero" src="${esc(bgGame.images.heroThumb || bgGame.images.hero)}" alt="" style="opacity:.55">` : ''}
        ${photo ? `<img class="banner__photo" src="${esc(photo.src)}" alt="${esc(p.id)}" decoding="async">` : ''}
      </div></div>
      <div class="banner__tools">
        <button class="btn" type="button" data-trailer data-edit title="Changer la bande-annonce de la console">✎ Bande-annonce</button>
      </div>
      <div class="banner__title">
        ${consoleLogo(p, 'banner__mark')}
        <span class="eyebrow">${esc([family, p.year].filter(Boolean).join(' · '))}</span>
        <h1 class="h-hero">${esc(p.id)}</h1>
        <p>${games.length} jeu${games.length > 1 ? 'x' : ''} · ${played.length} lancé${played.length > 1 ? 's' : ''} · ${fmtHours(sum(games.map((g) => g.playtimeMinutes ?? 0)))} de jeu</p>
      </div>
      ${photo ? `<a class="banner__credit" href="${esc(photo.page)}" target="_blank" rel="noopener">Photo : Wikimedia Commons</a>` : ''}
    </section>

    <section class="stats">
      ${[
        { label: 'jeux', value: games.length },
        { label: 'terminés', value: done.length, sub: played.length ? `${Math.round((done.length / played.length) * 100)} % des lancés` : '' },
        { label: 'note moyenne', value: ratings.length ? avg(ratings).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—' },
        { label: 'meilleure carte', value: best ? cardStats(best).power : '—', sub: best ? `${best.name} · ${TIERS[cardStats(best).tier].label}` : '' },
      ].map((s, i) => `<div class="stat" style="--i:${i}"><span class="stat__value">${esc(s.value)}</span><span class="stat__label">${s.label}</span>${s.sub ? `<span class="stat__sub">${esc(s.sub)}</span>` : ''}</div>`).join('')}
    </section>

    <div class="section">
      <div class="toolbar">
        <div class="row" id="filters" role="group" aria-label="Filtrer par statut"></div>
        <select class="select" id="sort" aria-label="Trier">${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}"${k === sort ? ' selected' : ''}>Tri : ${label}</option>`).join('')}</select>
      </div>
      <div id="grid"></div>
    </div>`;

  const renderGrid = () => {
    $('#filters', view).innerHTML = FILTERS.map(([k, label, icon]) => {
      const n = k === 'all' ? games.length : games.filter((g) => g.status === k).length;
      if (k !== 'all' && !n) return '';
      return `<button class="chip" type="button" data-filter="${k}" aria-pressed="${k === filter}">${icon ? `${icon} ` : ''}${esc(label)} <span class="n">${n}</span></button>`;
    }).join('');
    const list = games.filter((g) => filter === 'all' || g.status === filter).sort(SORTS[sort][1]);
    $('#grid', view).innerHTML = list.length
      ? `<div class="grid-cards">${list.map((g, i) => cardHtml(g, { i })).join('')}</div>`
      : emptyState('▦', 'Rien ici', 'Aucun jeu ne correspond à ce filtre.', `<button class="btn btn--primary" type="button" data-add-here data-edit>+ Ajouter un jeu ${esc(p.short)}</button>`);
  };
  renderGrid();
  attachHolo(view);
  if (best) setAmbient(best.images?.gridThumb || best.images?.cover);

  view.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; local.set(`filter:${p.id}`, filter); renderGrid(); return; }
    if (e.target.closest('[data-add-here]')) { openAdd({ platform: p.id }); return; }
    if (e.target.closest('[data-trailer]')) {
      requireEdit(async () => {
        const value = prompt(`Lien YouTube de la bande-annonce de la ${p.id} (vide pour remettre celle par défaut) :`, trailerId ? `https://youtu.be/${trailerId}` : '');
        if (value === null) return;
        try {
          await saveSettings({ consoleTrailers: { [p.id]: value } });
          toast('✎', 'Bande-annonce mise à jour', TEST ? 'Mode test.' : '');
          location.reload();
        } catch (err) { toast('!', 'Lien refusé', err.message); }
      });
    }
  });
  $('#sort', view).addEventListener('change', (e) => { sort = e.target.value; local.set('sort', sort); renderGrid(); });

  // Bande-annonce de la console sous l'image, qui s'ouvre en diaphragme
  let trailer = null;
  if (trailerId && trailersAllowed) {
    trailer = youtubeTrailer($('.banner__cover', view), trailerId, { soundParent: $('.banner__tools', view) });
  }
  return () => trailer?.stop();
}
