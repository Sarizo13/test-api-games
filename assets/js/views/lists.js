// Listes : « À jouer » (la file d'attente, dans l'ordre : glisser-déposer, ↑ ↓, retrait annulable)
// et « Envies » (compte à rebours avant la sortie, « Je l'ai » range le jeu dans la collection).

import { platformMeta } from '../../platforms.js';
import { state, setPlaylist, togglePlaylist, updateGame, removeWish, addWish, onChange } from '../state.js';
import { STATUS } from '../card.js';
import { requireEdit, openAdd } from '../add.js';
import { pageHead, emptyState, sectionHead, thumb } from './common.js';
import { $, $$, esc, safeUrl, fmtHours, fmtDate, daysUntil, sum, toast } from '../util.js';

export function renderLists(view, tab = 'a-jouer') {
  const draw = () => {
    const queue = state.playlist.map((id) => state.games.find((g) => g.id === id)).filter(Boolean);
    const wishes = tab === 'envies';
    view.innerHTML = `
      ${pageHead('Mes listes', wishes ? 'Mes envies' : 'À jouer ensuite', '',
        wishes ? 'Les jeux que tu n\'as pas encore : sorties attendues, coups de cœur repérés, idées pour plus tard.'
          : 'Ta file d\'attente, dans l\'ordre. Le premier jeu est suggéré sur l\'accueil ; un jeu terminé quitte la liste tout seul.',
        wishes ? '<button class="btn btn--primary" type="button" data-wish-add data-edit>+ Ajouter une envie</button>' : '')}
      <div class="tabs" role="tablist" aria-label="Listes" style="--i:${wishes ? 1 : 0}">
        <span class="tabs__thumb"></span>
        <a role="tab" href="#/a-jouer" aria-selected="${!wishes}">≡ À jouer <span class="n">${queue.length}</span></a>
        <a role="tab" href="#/envies" aria-selected="${wishes}">✦ Envies <span class="n">${state.wishlist.length}</span></a>
      </div>
      <div id="list-body" class="section"></div>`;
    if (wishes) drawWishlist($('#list-body', view));
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
      <div class="row row--between">
        <span class="muted">${queue.length} jeu${queue.length > 1 ? 'x' : ''}${hours ? ` · environ <b class="accent">${Math.round(hours)} h</b> pour tout finir` : ''}</span>
        <span class="muted-2" style="font-size:12px">⠿ glisse pour réordonner · un jeu terminé quitte la liste tout seul</span>
      </div>
      <ol class="queue" id="queue">
        ${queue.map((g, i) => {
          const s = STATUS[g.status];
          const ttb = g.timeToBeat?.normally;
          const left = ttb ? Math.max(0, ttb - (g.playtimeMinutes ?? 0) / 60) : null;
          const pct = ttb && g.playtimeMinutes ? Math.min(100, Math.round((g.playtimeMinutes / 60 / ttb) * 100)) : 0;
          return `
            <li class="queue__row" draggable="true" data-id="${esc(g.id)}">
              <span class="queue__handle" title="Glisser pour réordonner" aria-hidden="true">⠿</span>
              <span class="queue__rank">${i + 1}</span>
              <a href="#/jeu/${encodeURIComponent(g.id)}" aria-label="${esc(g.name)}">${thumb(g)}</a>
              <div class="queue__text">
                <a href="#/jeu/${encodeURIComponent(g.id)}"><strong>${esc(g.name)}</strong></a>
                <small><span class="status" data-s="${g.status}">${s.icon} ${s.label}</span> · ${esc(platformMeta(g.platform).short)}${left != null ? ` · ~${Math.round(left)} h restantes` : ''} · ${g.playtimeMinutes ? `${fmtHours(g.playtimeMinutes)} joué` : 'pas encore lancé'}</small>
                <span class="bar"><i style="--v:${pct}%"></i></span>
              </div>
              <div class="queue__actions">
                ${g.status === 'backlog' ? `<button class="btn btn--primary" type="button" data-start="${esc(g.id)}" data-edit>▶ Lancer</button>` : `<a class="btn btn--primary" href="#/jeu/${encodeURIComponent(g.id)}">▶ Reprendre</a>`}
                <button class="btn btn--icon btn--ghost" type="button" data-move="-1" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn btn--icon btn--ghost" type="button" data-move="1" aria-label="Descendre" ${i === queue.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="btn btn--icon btn--ghost" type="button" data-unqueue aria-label="Retirer de la liste">✕</button>
              </div>
            </li>`;
        }).join('')}
      </ol>`
    : emptyState('≡', 'Ta liste est vide', 'Ajoute des jeux de ta collection pour savoir à quoi jouer ensuite.')}

    ${candidates.length ? `
      <div class="section" style="margin-top:12px">
        ${sectionHead('Ajouter depuis ta collection', '<span class="note">jamais joués et en cours</span>')}
        <div class="pick-list">
          ${candidates.slice(0, 12).map((g) => `
            <div class="pick">
              ${thumb(g, 'thumb--sm')}
              <div style="min-width:0"><strong>${esc(g.name)}</strong><small><span class="status" data-s="${g.status}">${STATUS[g.status].icon}</span> ${esc(platformMeta(g.platform).short)}${g.timeToBeat?.normally ? ` · ~${Math.round(g.timeToBeat.normally)} h` : ''}</small></div>
              <button class="btn btn--icon" type="button" data-queue="${esc(g.id)}" aria-label="Ajouter ${esc(g.name)} à la liste" data-edit>+</button>
            </div>`).join('')}
        </div>
      </div>` : ''}`;

  const list = $('#queue', box);
  box.addEventListener('click', (e) => {
    const item = e.target.closest('.queue__row');
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
    if (e.target.closest('[data-unqueue]') && item) {
      requireEdit(() => {
        const before = [...state.playlist];
        const name = state.games.find((g) => g.id === item.dataset.id)?.name ?? 'Jeu';
        togglePlaylist(item.dataset.id);
        toast('↺', 'Retiré de la liste', `${name} reste dans ta collection.`, 4000, { action: { label: 'Annuler', onClick: () => setPlaylist(before) } });
      });
      return;
    }
    const add = e.target.closest('[data-queue]');
    if (add) {
      requireEdit(() => {
        togglePlaylist(add.dataset.queue);
        toast('≡', 'Ajouté à ta liste « À jouer »');
      });
      return;
    }
    const start = e.target.closest('[data-start]');
    if (start) {
      requireEdit(() => {
        const g = state.games.find((x) => x.id === start.dataset.start);
        updateGame(start.dataset.start, { status: 'playing' });
        toast('▶', 'Bonne partie !', `${g?.name ?? ''} passe « En cours » · +20 XP`, 5000, { color: 'var(--st-playing)' });
      });
    }
  });

  // Glisser-déposer pour réordonner
  if (!list) return;
  let dragged = null;
  list.addEventListener('dragstart', (e) => {
    dragged = e.target.closest('.queue__row');
    if (!dragged) return;
    dragged.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged.dataset.id);
  });
  list.addEventListener('dragover', (e) => {
    const over = e.target.closest('.queue__row');
    if (!dragged || !over) return;
    e.preventDefault();
    $$('.queue__row', list).forEach((el) => el.classList.toggle('is-over', el === over && el !== dragged));
  });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) $$('.is-over', list).forEach((el) => el.classList.remove('is-over')); });
  list.addEventListener('drop', (e) => {
    const over = e.target.closest('.queue__row');
    if (!dragged || !over || over === dragged) return;
    e.preventDefault();
    const ids = $$('.queue__row', list).map((el) => el.dataset.id);
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
    <div class="grid-2">
      ${items.map((w, i) => {
        const d = daysUntil(w.releaseDate);
        const upcoming = d != null && d > 0;
        return `
          <article class="wish" style="--i:${i}">
            ${safeUrl(w.cover) ? `<img src="${esc(w.cover)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
            <div class="wish__text">
              <strong>${esc(w.name)}</strong>
              <small>${esc([w.year, w.platforms?.slice(0, 4).map((p) => platformMeta(p).short).join(', ')].filter(Boolean).join(' · '))}</small>
              <div class="countdown">
                <span class="countdown__days${upcoming ? '' : ' is-out'}">${upcoming ? `J-${d}` : w.releaseDate ? '✓ Disponible' : 'Date inconnue'}</span>
                ${w.releaseDate ? `<small>${upcoming ? 'sortie le ' : 'sorti le '}${esc(fmtDate(w.releaseDate, { day: 'numeric', month: 'long', year: 'numeric' }))}</small>` : ''}
              </div>
              <div class="actions">
                <button class="btn btn--primary" type="button" data-got="${w.igdbId}" data-edit>✓ Je l'ai</button>
                <button class="btn btn--ghost" type="button" data-unwish="${w.igdbId}" data-edit>Retirer</button>
              </div>
            </div>
          </article>`;
      }).join('')}
    </div>`
    : emptyState('✦', 'Aucune envie pour l\'instant', 'Ajoute un jeu à tes envies depuis la recherche, l\'actualité de l\'accueil ou la page Découvrir.',
      '<button class="btn btn--primary" type="button" data-wish-add data-edit>+ Ajouter une envie</button>');

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
      requireEdit(() => {
        removeWish(Number(un.dataset.unwish));
        toast('↺', `${w?.name ?? 'Jeu'} retiré de tes envies`, '', 4000, w ? { action: { label: 'Annuler', onClick: () => addWish(w) } } : {});
      });
    }
  });
}

