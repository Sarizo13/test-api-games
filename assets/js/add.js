// Fenêtre d'ajout : propositions IGDB pendant la frappe, puis destination (collection ou envies).
// Aussi : fenêtre de connexion, demandée dès qu'une modification nécessite le mot de passe.

import { PLATFORMS, FAMILIES, platformMeta } from '../platforms.js';
import { STATUS } from './card.js';
import { state, TEST, addGame, addWish, searchIgdb, login } from './state.js';
import { $, $$, esc, norm, safeUrl, highlight, listbox, openModal, toast, confetti, ICONS } from './util.js';

/* ---------- Connexion ---------- */

export function openLogin({ then } = {}) {
  const { el, close } = openModal(`
    <h2>Connexion</h2>
    <p class="modal-lead">Le mot de passe de ton mini-serveur permet de modifier ta collection. Il est retenu sur cet appareil.</p>
    <form id="login-form">
      <label class="field"><span>Mot de passe</span><input class="input" id="login-password" type="password" autocomplete="current-password" required></label>
      <p class="modal-warning" id="login-error" hidden></p>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-close>Annuler</button>
        <button class="btn btn-primary" type="submit">Se connecter</button>
      </div>
    </form>`);
  setTimeout(() => $('#login-password', el).focus(), 60);
  $('#login-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', el);
    btn.disabled = true;
    try {
      await login($('#login-password', el).value);
      close();
      toast('🔓', 'Connecté', ' Tu peux modifier ta collection.');
      then?.();
    } catch (err) {
      $('#login-error', el).textContent = err.status === 401 ? 'Mot de passe incorrect.' : err.message;
      $('#login-error', el).hidden = false;
      btn.disabled = false;
    }
  });
}

/** Exécute `fn` si l'on peut modifier, sinon demande la connexion d'abord. */
export function requireEdit(fn) {
  if (state.canEdit) fn();
  else openLogin({ then: fn });
}

/* ---------- Ajout d'un jeu ---------- */

/** Les consoles où le jeu existe en pastilles, toutes les autres dans une liste déroulante classée par famille. */
export function platformPicker(selected, available = []) {
  const chips = available.map((id) => platformMeta(id)).map((p) => `
    <button type="button" class="chip${p.id === selected ? ' is-on' : ''}" data-platform="${esc(p.id)}" style="--c:${p.color}">
      <span class="dot"></span>${esc(p.short)}
    </button>`).join('');
  const others = FAMILIES.map((f) => {
    const list = PLATFORMS.filter((p) => p.family === f.id && !available.includes(p.id));
    return list.length ? `<optgroup label="${esc(f.name)}">${list.map((p) => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.id)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const otherSelected = selected && !available.includes(selected);
  return `
    ${chips ? `<div class="chips" style="margin-bottom:10px">${chips}</div>` : ''}
    <select class="select" data-platform-select style="max-width:320px">
      <option value=""${otherSelected ? '' : ' selected'}>${chips ? 'Une autre console…' : 'Choisir la console…'}</option>
      ${others}
    </select>`;
}

/**
 * Ouvre la fenêtre d'ajout. `query` pré-remplit la recherche ; `pick` arrive déjà choisi (depuis une suggestion) ;
 * `target` : 'collection' ou 'wishlist'.
 */
export function openAdd({ query = '', pick = null, target = 'collection', platform = null } = {}) {
  if (!state.canEdit) { openLogin({ then: () => openAdd({ query, pick, target, platform }) }); return; }

  let chosen = pick;
  let dest = target;
  let selectedPlatform = platform ?? (pick?.platforms?.[0] ?? null);
  let status = 'backlog';
  let results = [];
  let ctrl = null;
  const cache = new Map();

  const { el, close } = openModal(`
    <h2>Ajouter un jeu</h2>
    <p class="modal-lead">Tape le nom d'un jeu (même rétro ou arcade) et choisis-le dans la liste.</p>
    <div class="field">
      <div class="combo">
        ${ICONS.search}
        <input class="input" id="add-q" placeholder="ex. Hollow Knight, Street Fighter II, Zelda…" autocomplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="add-suggest" value="${esc(query)}">
        <span class="spinner" id="add-spin" hidden></span>
      </div>
      <ul class="suggest" id="add-suggest" role="listbox" hidden></ul>
    </div>
    <div id="add-picked"></div>
    <div class="field">
      <span>Où le ranger ?</span>
      <div class="segmented" id="add-dest">
        <button type="button" data-dest="collection" style="--c:#8b5cf6">📦 Ma collection</button>
        <button type="button" data-dest="wishlist" style="--c:#f472b6">✨ Mes envies</button>
      </div>
    </div>
    <div id="add-collection">
      <div class="field"><span>Console</span><div id="add-platforms"></div></div>
      <div class="field">
        <span>Où en es-tu ?</span>
        <div class="segmented" id="add-status">
          ${['backlog', 'playing', 'finished', 'completed'].map((s) => `<button type="button" data-status="${s}" style="--c:${STATUS[s].color}">${STATUS[s].icon} ${STATUS[s].label}</button>`).join('')}
        </div>
      </div>
      <label class="chip" style="width:fit-content;margin-bottom:16px"><input type="checkbox" id="add-playlist" style="accent-color:#8b5cf6"> Ajouter à ma liste « à jouer »</label>
    </div>
    <p class="modal-warning" id="add-warning" hidden></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" data-close>Annuler</button>
      <button class="btn btn-primary" type="button" id="add-submit">Ajouter</button>
    </div>`);

  const input = $('#add-q', el);
  const list = $('#add-suggest', el);
  const warning = (text) => { $('#add-warning', el).textContent = text; $('#add-warning', el).hidden = !text; };

  const render = () => {
    $$('#add-dest button', el).forEach((b) => b.setAttribute('aria-pressed', b.dataset.dest === dest));
    $$('#add-status button', el).forEach((b) => b.setAttribute('aria-pressed', b.dataset.status === status));
    $('#add-collection', el).hidden = dest !== 'collection';
    $('#add-platforms', el).innerHTML = platformPicker(selectedPlatform, (chosen?.platforms ?? []).filter((p) => p !== 'Autre'));
    $('#add-picked', el).innerHTML = chosen ? `
      <div class="picked">
        ${safeUrl(chosen.cover) ? `<img src="${esc(chosen.cover)}" alt="">` : '<span class="suggest-cover">🎮</span>'}
        <div><strong>${esc(chosen.name)}</strong><small>${esc([chosen.year, chosen.platforms?.map((p) => platformMeta(p).short).slice(0, 5).join(', ')].filter(Boolean).join(' · '))}</small></div>
        <button class="btn btn-ghost btn-sm" type="button" data-unpick>Changer</button>
      </div>` : '';
    $('#add-submit', el).textContent = dest === 'wishlist' ? 'Ajouter à mes envies' : 'Ajouter à ma collection';
  };

  const box = listbox(input, list, (li) => pickResult(results[Number(li.dataset.index)]));

  function pickResult(r) {
    if (!r) return;
    chosen = r;
    input.value = r.name;
    box.close();
    if (!selectedPlatform || !r.platforms.includes(selectedPlatform)) selectedPlatform = r.platforms[0] ?? selectedPlatform;
    warning('');
    render();
  }

  async function suggest() {
    const q = input.value.trim();
    if (chosen || q.length < 2) { box.close(); return; }
    ctrl?.abort();
    let found = cache.get(norm(q));
    if (!found) {
      const mine = ctrl = new AbortController();
      $('#add-spin', el).hidden = false;
      try {
        found = await searchIgdb(q, mine.signal);
        cache.set(norm(q), found);
      } catch (err) {
        if (err.name !== 'AbortError') box.open('<li class="suggest-empty">Recherche indisponible pour le moment.</li>');
        return;
      } finally {
        if (ctrl === mine) $('#add-spin', el).hidden = true;
      }
    }
    if (input.value.trim() !== q || chosen || document.activeElement !== input) return;
    results = found;
    if (!found.length) { box.open(`<li class="suggest-empty">Aucun jeu trouvé pour « ${esc(q)} ».</li>`); return; }
    box.open(found.map((r, i) => {
      const owned = state.games.filter((g) => g.igdbId === r.igdbId).map((g) => platformMeta(g.platform).short);
      const wished = state.wishlist.some((w) => w.igdbId === r.igdbId);
      return `
        <li role="option" id="as-${i}" class="suggest-item" data-index="${i}" style="--i:${i}">
          ${safeUrl(r.cover) ? `<img class="suggest-cover" src="${esc(r.cover)}" alt="" loading="lazy">` : '<span class="suggest-cover">🎮</span>'}
          <span class="suggest-text"><strong>${highlight(r.name, q)}</strong><small>${esc([r.year, r.platforms.map((p) => platformMeta(p).short).slice(0, 4).join(', ')].filter(Boolean).join(' · '))}</small></span>
          ${owned.length ? `<span class="suggest-tag">Déjà sur ${esc(owned.join(', '))}</span>` : wished ? '<span class="suggest-tag">Dans tes envies</span>' : ''}
        </li>`;
    }).join(''));
  }

  let t = 0;
  input.addEventListener('input', () => {
    if (chosen && input.value !== chosen.name) { chosen = null; render(); }
    clearTimeout(t);
    t = setTimeout(suggest, 220);
  });
  input.addEventListener('focus', () => { if (!chosen && input.value.trim().length >= 2) suggest(); });
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-platform-select]') && e.target.value) { selectedPlatform = e.target.value; render(); }
  });

  el.addEventListener('click', (e) => {
    const d = e.target.closest('[data-dest]');
    if (d) { dest = d.dataset.dest; render(); return; }
    const s = e.target.closest('[data-status]');
    if (s) { status = s.dataset.status; render(); return; }
    const p = e.target.closest('[data-platform]');
    if (p) { selectedPlatform = p.dataset.platform; render(); return; }
    if (e.target.closest('[data-unpick]')) { chosen = null; input.select(); input.focus(); render(); suggest(); }
  });

  $('#add-submit', el).addEventListener('click', async () => {
    if (!chosen) {
      if (results.length && norm(results[0].name) === norm(input.value)) pickResult(results[0]);
      else { warning('Choisis le jeu dans la liste des propositions.'); input.focus(); suggest(); return; }
    }
    const btn = $('#add-submit', el);
    if (dest === 'wishlist') {
      close();
      await addWish(chosen);
      toast('✨', `${chosen.name} ajouté à tes envies`);
      return;
    }
    if (!selectedPlatform) { warning('Choisis la console.'); return; }
    if (state.games.some((g) => g.igdbId === chosen.igdbId && g.platform === selectedPlatform)) {
      warning(`${chosen.name} est déjà dans ta collection sur ${platformMeta(selectedPlatform).short}.`);
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span> Préparation de la carte…';
    try {
      const game = await addGame({ igdbId: chosen.igdbId, platform: selectedPlatform, status, playlist: $('#add-playlist', el).checked }, chosen);
      close();
      const r = btn.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top);
      toast('🎉', `${game.name} rejoint ta collection`, TEST ? ' (mode test : rien n\'est enregistré)' : ` Rangé dans ${platformMeta(game.platform).short}.`);
      location.hash = `#/jeu/${encodeURIComponent(game.id)}`;
    } catch (err) {
      warning(err.message);
      btn.disabled = false;
      render();
    }
  });

  if (!platform && !pick) selectedPlatform = null;
  render();
  setTimeout(() => { input.focus(); if (query && !pick) suggest(); }, 60);
}
