// Listes : « À jouer » (ta file d'attente, dans l'ordre) et « Envies » (les jeux que tu n'as pas encore).

import { platformMeta } from '../../platforms.js';
import { state, setPlaylist, togglePlaylist, updateGame, removeWish, onChange } from '../state.js';
import { STATUS } from '../card.js';
import { requireEdit, openAdd } from '../add.js';
import { emptyState, sectionHead, thumb } from './common.js';
import { $, $$, esc, safeUrl, fmtHours, fmtDate, countdown, daysUntil, sum, confetti, toast, ICONS } from '../util.js';

export function renderLists(view, tab = 'a-jouer') {
  const draw = () => {
    const queue = state.playlist.map((id) => state.games.find((g) => g.id === id)).filter(Boolean);
    view.innerHTML = `
      <div class="page-head">
        <div><p class="kicker">Mes listes</p><h1>${tab === 'envies' ? 'Mes envies' : 'À jouer ensuite'}</h1>
        <p>${tab === 'envies'
          ? 'Les jeux que tu n\'as pas encore : sorties attendues, coups de cœur repérés, idées pour plus tard.'
          : 'Ta file d\'attente, dans l\'ordre. Glisse les jeux pour les réordonner ; un jeu terminé quitte la liste tout seul.'}</p></div>
        ${tab === 'envies' ? `<button class="btn btn-primary" type="button" data-wish-add>${ICONS.plus}Ajouter une envie</button>` : ''}
      </div>
      <nav class="tabs-head" aria-label="Listes">
        <a href="#/a-jouer" class="${tab === 'a-jouer' ? 'is-active' : ''}">${ICONS.list}À jouer <span class="chip-count">${queue.length}</span></a>
        <a href="#/envies" class="${tab === 'envies' ? 'is-active' : ''}">✨ Envies <span class="chip-count">${state.wishlist.length}</span></a>
      </nav>
      <div id="list-body"></div>`;
    if (tab === 'envies') drawWishlist($('#list-body', view));
    else drawQueue($('#list-body', view), queue);
  };

  draw();
  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-wish-add]')) openAdd({ target: 'wishlist' });
  });
  // Les listes changent souvent (ordre, ajouts, jeux terminés) : on redessine à chaque fois
  return onChange((e) => { if (['playlist', 'wishlist', 'games', 'game'].includes(e.detail.type)) draw(); });
}

/* ---------- À jouer ---------- */

function drawQueue(box, queue) {
  const hours = sum(queue.map((g) => Math.max(0, (g.timeToBeat?.normally ?? 0) - (g.playtimeMinutes ?? 0) / 60)));
  const candidates = state.games
    .filter((g) => !state.playlist.includes(g.id) && ['backlog', 'playing'].includes(g.status))
    .sort((a, b) => (b.igdbRating ?? 0) - (a.igdbRating ?? 0));

  box.innerHTML = `
    ${queue.length ? `
      <p class="muted" style="margin:-8px 0 16px">${queue.length} jeu${queue.length > 1 ? 'x' : ''}${hours ? ` · environ <b style="color:var(--text)">${Math.round(hours)} h</b> pour tout finir` : ''}</p>
      <ol class="queue" id="queue" style="padding:0;margin:0 0 40px;list-style:none">
        ${queue.map((g, i) => {
          const s = STATUS[g.status];
          const left = g.timeToBeat?.normally ? Math.max(0, g.timeToBeat.normally - (g.playtimeMinutes ?? 0) / 60) : null;
          return `
            <li class="q-item" draggable="true" data-id="${esc(g.id)}" style="--i:${i}">
              <span class="q-handle" title="Glisser pour réordonner">${ICONS.grip}</span>
              <span class="q-rank"></span>
              <a href="#/jeu/${encodeURIComponent(g.id)}">${thumb(g)}</a>
              <div style="min-width:0">
                <a href="#/jeu/${encodeURIComponent(g.id)}"><strong>${esc(g.name)}</strong></a>
                <small><span style="color:${s.color}">${s.icon} ${s.label}</span> · ${esc(platformMeta(g.platform).short)}${left != null ? ` · ~${Math.round(left)} h restantes` : ''}${g.playtimeMinutes ? ` · ${fmtHours(g.playtimeMinutes)} joué` : ''}</small>
              </div>
              <div class="q-actions">
                ${g.status === 'backlog' ? `<button class="btn btn-primary btn-sm" type="button" data-start="${esc(g.id)}">${ICONS.play}Lancer</button>` : ''}
                <button class="icon-btn" type="button" data-move="-1" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${ICONS.up}</button>
                <button class="icon-btn" type="button" data-move="1" aria-label="Descendre" ${i === queue.length - 1 ? 'disabled' : ''}>${ICONS.down}</button>
                <button class="icon-btn" type="button" data-unqueue aria-label="Retirer de la liste">${ICONS.close}</button>
              </div>
            </li>`;
        }).join('')}
      </ol>`
    : emptyState('📋', 'Ta liste est vide', 'Ajoute des jeux de ta collection pour savoir à quoi jouer ensuite.')}

    ${candidates.length ? `
      ${sectionHead('Ajouter depuis ta collection', '<span class="muted" style="font-size:13px">jamais joués et en cours</span>')}
      <div class="grid-auto" style="--min:240px">
        ${candidates.slice(0, 12).map((g, i) => `
          <div class="now-item" style="--i:${i}">
            ${thumb(g)}
            <div><strong>${esc(g.name)}</strong><small>${STATUS[g.status].icon} ${STATUS[g.status].label} · ${esc(platformMeta(g.platform).short)}${g.timeToBeat?.normally ? ` · ~${Math.round(g.timeToBeat.normally)} h` : ''}</small></div>
            <button class="icon-btn" type="button" data-queue="${esc(g.id)}" aria-label="Ajouter à la liste">${ICONS.plus}</button>
          </div>`).join('')}
      </div>` : ''}`;

  const list = $('#queue', box);
  box.addEventListener('click', (e) => {
    const item = e.target.closest('.q-item');
    const move = e.target.closest('[data-move]');
    if (move && item) {
      requireEdit(() => {
        const ids = [...state.playlist];
        const from = ids.indexOf(item.dataset.id);
        const to = from + Number(move.dataset.move);
        if (to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        setPlaylist(ids);
      });
      return;
    }
    if (e.target.closest('[data-unqueue]') && item) { requireEdit(() => togglePlaylist(item.dataset.id)); return; }
    const add = e.target.closest('[data-queue]');
    if (add) {
      requireEdit(() => {
        togglePlaylist(add.dataset.queue);
        toast('📋', 'Ajouté à ta liste « à jouer »');
      });
      return;
    }
    const start = e.target.closest('[data-start]');
    if (start) {
      requireEdit(() => {
        const r = start.getBoundingClientRect();
        confetti(r.left + r.width / 2, r.top);
        updateGame(start.dataset.start, { status: 'playing' });
        toast('▶', 'Bonne partie !', ` ${state.games.find((g) => g.id === start.dataset.start)?.name ?? ''} passe « en cours ».`);
      });
    }
  });

  // Glisser-déposer pour réordonner
  if (!list) return;
  let dragged = null;
  list.addEventListener('dragstart', (e) => {
    dragged = e.target.closest('.q-item');
    if (!dragged) return;
    dragged.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged.dataset.id);
  });
  list.addEventListener('dragover', (e) => {
    const over = e.target.closest('.q-item');
    if (!dragged || !over) return;
    e.preventDefault();
    $$('.q-item', list).forEach((el) => el.classList.toggle('is-over', el === over && el !== dragged));
  });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) $$('.is-over', list).forEach((el) => el.classList.remove('is-over')); });
  list.addEventListener('drop', (e) => {
    const over = e.target.closest('.q-item');
    if (!dragged || !over || over === dragged) return;
    e.preventDefault();
    const ids = $$('.q-item', list).map((el) => el.dataset.id);
    const from = ids.indexOf(dragged.dataset.id);
    const to = ids.indexOf(over.dataset.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    requireEdit(() => setPlaylist(ids));
  });
  list.addEventListener('dragend', () => {
    dragged?.classList.remove('is-dragging');
    $$('.is-over', list).forEach((el) => el.classList.remove('is-over'));
    dragged = null;
  });
}

/* ---------- Envies ---------- */

function drawWishlist(box) {
  // Les sorties à venir d'abord (la plus proche en tête), puis le reste du plus récent au plus ancien ajout
  const items = [...state.wishlist].sort((a, b) => {
    const da = daysUntil(a.releaseDate);
    const db = daysUntil(b.releaseDate);
    const ua = da != null && da >= 0;
    const ub = db != null && db >= 0;
    if (ua !== ub) return ua ? -1 : 1;
    if (ua) return da - db;
    return (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
  });

  box.innerHTML = items.length ? `
    <div class="grid-auto" style="--min:300px">
      ${items.map((w, i) => {
        const d = daysUntil(w.releaseDate);
        const upcoming = d != null && d >= 0;
        return `
          <article class="wish-card" style="--i:${i}">
            ${safeUrl(w.cover) ? `<img src="${esc(w.cover)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
            <div style="min-width:0">
              <strong>${esc(w.name)}</strong>
              <small>${esc([w.year, w.platforms?.slice(0, 4).map((p) => platformMeta(p).short).join(', ')].filter(Boolean).join(' · '))}</small><br>
              <span class="countdown${upcoming ? '' : ' is-out'}">${upcoming ? `⏳ ${esc(countdown(w.releaseDate))} · ${esc(fmtDate(w.releaseDate, { day: 'numeric', month: 'short', year: 'numeric' }))}` : w.releaseDate ? '✓ Disponible' : 'Date inconnue'}</span>
              <div class="row">
                <button class="btn btn-primary btn-sm" type="button" data-got="${w.igdbId}">${ICONS.check}Je l'ai</button>
                <button class="btn btn-ghost btn-sm" type="button" data-unwish="${w.igdbId}">Retirer</button>
              </div>
            </div>
          </article>`;
      }).join('')}
    </div>`
    : emptyState('✨', 'Aucune envie pour l\'instant', 'Ajoute un jeu à tes envies depuis la recherche, l\'actualité de l\'accueil ou la page Découvrir.',
      `<button class="btn btn-primary" type="button" data-wish-add>${ICONS.plus}Ajouter une envie</button>`);

  box.addEventListener('click', (e) => {
    const got = e.target.closest('[data-got]');
    if (got) {
      const w = state.wishlist.find((x) => x.igdbId === Number(got.dataset.got));
      if (w) openAdd({ pick: w }); // l'envie quitte la liste dès que le jeu rejoint la collection
      return;
    }
    const un = e.target.closest('[data-unwish]');
    if (un) {
      const w = state.wishlist.find((x) => x.igdbId === Number(un.dataset.unwish));
      requireEdit(() => { removeWish(Number(un.dataset.unwish)); toast('✨', `${w?.name ?? 'Jeu'} retiré de tes envies`); });
    }
  });
}
