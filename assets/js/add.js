// Fenêtre d'ajout : propositions IGDB pendant la frappe, puis rangement (collection ou envies, console, statut).
// Aussi : fenêtre de connexion (avec Discord), proposée dès qu'une modification demande d'être connecté.

import { PLATFORMS, FAMILIES, platformMeta } from '../platforms.js';
import { STATUS } from './card.js';
import { state, TEST, PROFILE, addGame, addWish, searchIgdb, login } from './state.js';
import { providerLogo } from './brands.js';
import { $, esc, norm, safeUrl, highlight, listbox, openModal, toast, confetti, segmented, setSegmented, ICONS } from './util.js';

/* ---------- Connexion ---------- */

export function openLogin() {
  if (PROFILE) {
    toast('🔒', 'Lecture seule', `C'est la collection de ${state.owner?.displayName ?? PROFILE}. Connecte-toi sur Asobi pour la tienne.`);
    return;
  }
  const { el } = openModal(`
    <h2 class="modal__title">Connexion</h2>
    <p class="modal__lead">Asobi utilise ton compte Discord : aucun mot de passe à créer. Ta collection reste privée tant que tu ne la partages pas.</p>
    ${state.discordConfigured ? '' : '<p class="warn">La connexion Discord n\'est pas encore configurée sur ce serveur.</p>'}
    <p class="note-line">Asobi lit seulement ton pseudo, ton avatar et la liste des comptes de jeu reliés à Discord (Steam, Xbox, PlayStation…), pour te proposer de les importer.</p>
    <div class="modal__actions">
      <button class="btn btn--ghost" type="button" data-close>Annuler</button>
      <button class="btn btn--discord" type="button" id="discord-login"${state.discordConfigured ? '' : ' disabled'}>${providerLogo('discord', 'btn-logo')}Se connecter avec Discord</button>
    </div>`);
  $('#discord-login', el).addEventListener('click', () => login());
}

/** Exécute `fn` si l'on peut modifier, sinon propose de se connecter. */
export function requireEdit(fn) {
  if (state.canEdit) fn();
  else openLogin();
}

/* ---------- Ajout d'un jeu ---------- */

/** Les consoles où le jeu existe en pastilles, toutes les autres dans une liste déroulante classée par famille. */
export function platformPicker(selected, available = []) {
  const chips = available.map((id) => platformMeta(id)).map((p) => `
    <button type="button" class="chip" aria-pressed="${p.id === selected}" data-platform="${esc(p.id)}" style="--c:${p.color}">
      <span class="dot"></span>${esc(p.short)}
    </button>`).join('');
  const others = FAMILIES.map((f) => {
    const list = PLATFORMS.filter((p) => p.family === f.id && !available.includes(p.id));
    return list.length ? `<optgroup label="${esc(f.name)}">${list.map((p) => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.id)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const otherSelected = selected && !available.includes(selected);
  return `
    <div class="row">
      ${chips}
      <select class="select" data-platform-select style="width:auto;min-height:40px" aria-label="Autre console">
        <option value=""${otherSelected ? '' : ' selected'}>${chips ? 'Autre console…' : 'Choisir la console…'}</option>
        ${others}
      </select>
    </div>`;
}

const DESTS = [
  { value: 'collection', label: 'Ma collection', icon: '▦', color: 'var(--acc)' },
  { value: 'wishlist', label: 'Mes envies', icon: '✦', color: 'var(--tier-mythic)' },
];
const ADD_STATUSES = ['backlog', 'playing', 'finished', 'completed'].map((k) => ({ value: k, label: STATUS[k].short, icon: STATUS[k].icon, color: STATUS[k].color }));

/**
 * Ouvre la fenêtre d'ajout. `query` pré-remplit la recherche ; `pick` arrive déjà choisi (depuis une suggestion) ;
 * `target` : 'collection' ou 'wishlist' ; `platform` : console déjà choisie.
 */
export function openAdd({ query = '', pick = null, target = 'collection', platform = null } = {}) {
  if (!state.canEdit) { openLogin(); return; }
  let chosen = pick;
  let dest = target;
  let selectedPlatform = platform ?? (pick?.platforms?.[0] ?? null);
  let status = 'backlog';
  let results = [];
  let ctrl = null;
  const cache = new Map();

  const { el, close } = openModal(`
    <h2 class="modal__title">Ajouter un jeu</h2>
    <p class="modal__lead">Même rétro ou arcade : tape son nom et choisis-le.</p>
    <div class="search">
      <span class="search__icon" aria-hidden="true">⌕</span>
      <input class="input" id="add-q" placeholder="ex. Hollow Knight, Street Fighter II, Zelda…" autocomplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="add-suggest" aria-label="Rechercher sur IGDB" value="${esc(query)}">
      <span class="spinner" id="add-spin" hidden></span>
      <ul class="suggest" id="add-suggest" role="listbox" hidden></ul>
    </div>
    <div id="add-picked"></div>
    <div class="field"><span class="field__label">Où le ranger ?</span>${segmented('dest', DESTS, dest, { label: 'Où le ranger' })}</div>
    <div id="add-collection" style="display:flex;flex-direction:column;gap:16px">
      <div class="field"><span class="field__label">Console</span><div id="add-platforms"></div></div>
      <div class="field"><span class="field__label">Où en es-tu ?</span>${segmented('status', ADD_STATUSES, status, { label: 'Statut' })}</div>
      <label class="check"><input type="checkbox" id="add-playlist"> Ajouter à ma liste « À jouer »</label>
    </div>
    <p class="warn warn--error" id="add-warning" hidden></p>
    <div class="modal__actions">
      <button class="btn btn--ghost" type="button" data-close>Annuler</button>
      <button class="btn btn--primary" type="button" id="add-submit">Ajouter</button>
    </div>`);

  const input = $('#add-q', el);
  const list = $('#add-suggest', el);
  const warning = (text) => { $('#add-warning', el).textContent = text; $('#add-warning', el).hidden = !text; };

  const render = () => {
    setSegmented($('[data-seg="dest"]', el), dest);
    setSegmented($('[data-seg="status"]', el), status);
    $('#add-collection', el).style.display = dest === 'collection' ? 'flex' : 'none';
    $('#add-platforms', el).innerHTML = platformPicker(selectedPlatform, (chosen?.platforms ?? []).filter((p) => p !== 'Autre'));
    $('#add-picked', el).innerHTML = chosen ? `
      <div class="picked">
        ${safeUrl(chosen.cover) ? `<img src="${esc(chosen.cover)}" alt="">` : '<span class="thumb"></span>'}
        <div><strong>${esc(chosen.name)}</strong><small>${esc([chosen.year, chosen.platforms?.map((p) => platformMeta(p).short).slice(0, 5).join(', ')].filter(Boolean).join(' · '))}</small></div>
        <button class="btn btn--ghost" type="button" data-unpick>Changer</button>
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
        if (err.name !== 'AbortError') box.open('<li class="suggest__empty">Recherche indisponible pour le moment.</li>');
        return;
      } finally {
        if (ctrl === mine) $('#add-spin', el).hidden = true;
      }
    }
    if (input.value.trim() !== q || chosen || document.activeElement !== input) return;
    results = found;
    if (!found.length) { box.open(`<li class="suggest__empty">Aucun jeu trouvé pour « ${esc(q)} ».</li>`); return; }
    box.open(found.map((r, i) => {
      const ownedOn = state.games.filter((g) => g.igdbId === r.igdbId).map((g) => platformMeta(g.platform).short);
      const wished = state.wishlist.some((w) => w.igdbId === r.igdbId);
      return `
        <li role="option" id="as-${i}" class="suggest__item" data-index="${i}" aria-selected="false">
          ${safeUrl(r.cover) ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : `<span class="suggest__ph">${ICONS.search}</span>`}
          <span class="suggest__text"><strong>${highlight(r.name, q)}</strong><small>${esc([r.year, r.platforms.map((p) => platformMeta(p).short).slice(0, 4).join(', ')].filter(Boolean).join(' · '))}</small></span>
          ${ownedOn.length ? `<span class="suggest__tag">✓ Déjà sur ${esc(ownedOn.join(', '))}</span>` : wished ? '<span class="suggest__tag">✦ Dans tes envies</span>' : ''}
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
      else { warning('Choisis le jeu dans la liste des propositions.'); input.setAttribute('aria-invalid', 'true'); input.focus(); suggest(); return; }
    }
    const btn = $('#add-submit', el);
    if (dest === 'wishlist') {
      close();
      await addWish(chosen);
      toast('✦', `${chosen.name} ajouté à tes envies`);
      return;
    }
    if (!selectedPlatform) { warning('Choisis la console.'); return; }
    if (state.games.some((g) => g.igdbId === chosen.igdbId && g.platform === selectedPlatform)) {
      warning(`${chosen.name} est déjà dans ta collection sur ${platformMeta(selectedPlatform).short}.`);
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Préparation de la carte…';
    try {
      const game = await addGame({ igdbId: chosen.igdbId, platform: selectedPlatform, status, playlist: $('#add-playlist', el).checked }, chosen);
      close();
      confetti();
      toast('+', `${game.name} ajouté à ta collection`, TEST ? 'Mode test : rien n\'est enregistré.' : `Carte sous blister · rangé dans ${platformMeta(game.platform).short} · +10 XP`);
      location.hash = `#/jeu/${encodeURIComponent(game.id)}`;
    } catch (err) {
      warning(err.message);
      btn.disabled = false;
      render();
    }
  });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));

  if (!platform && !pick) selectedPlatform = null;
  render();
  setTimeout(() => { input.focus(); if (query && !pick) suggest(); }, 60);
}
