// Découvrir : la roulette (machine à sous) parmi tes jeux jamais joués, tes cartes encore sous blister,
// et des suggestions IGDB « Pour toi » (d'après ton profil) et « Découvertes » (hors de tes habitudes).

import { platformMeta } from '../../platforms.js';
import { state, updateGame, fetchRecommend, fetchDiscover, knownIgdbIds } from '../state.js';
import { cardHtml, attachHolo, cardArt } from '../card.js';
import { playerProfile, PROFILE_MIN } from '../taste.js';
import { requireEdit } from '../add.js';
import { pageHead, sectionHead, emptyState, miniCover, bindStubs, cardGrid } from './common.js';
import { $, esc, reduceMotion, local } from '../util.js';

const LENGTHS = {
  all: ['Toutes durées', () => true],
  short: ['Court (< 10 h)', (h) => h != null && h < 10],
  medium: ['Moyen (10–30 h)', (h) => h != null && h >= 10 && h <= 30],
  long: ['Long (30 h +)', (h) => h != null && h > 30],
};
const LOOPS = 6; // tours complets du rouleau avant de s'arrêter
const STRIP_MAX = 16; // jaquettes différentes sur le rouleau

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export function renderDiscover(view) {
  const backlog = state.games.filter((g) => g.status === 'backlog');
  const profile = playerProfile(state.games);
  const consoles = [...new Set(backlog.map((g) => g.platform))];
  let length = local.get('roulette:length', 'all');
  let platform = local.get('roulette:platform', '');
  if (!LENGTHS[length]) length = 'all';
  if (platform && !consoles.includes(platform)) platform = '';

  const bulbs = '<i></i>'.repeat(22);
  view.innerHTML = `
    ${pageHead('Découvrir', 'À quoi je joue ?', '', 'Laisse le hasard choisir parmi tes jeux jamais lancés, ou trouve ton prochain coup de cœur.')}

    <section class="roulette" id="roulette">
      <div class="roulette__bulbs roulette__bulbs--top" aria-hidden="true">${bulbs}</div>
      <div class="roulette__bulbs roulette__bulbs--bottom" aria-hidden="true">${bulbs}</div>
      <div class="roulette__panel">
        <h2 class="h-section">La roulette</h2>
        <p id="pool"></p>
        ${backlog.length ? `
          <div class="roulette__group"><span>Durée</span><div class="row" role="radiogroup" aria-label="Durée">${Object.entries(LENGTHS).map(([k, [label]]) => `<button class="chip" type="button" role="radio" data-length="${k}" aria-checked="${k === length}">${label}</button>`).join('')}</div></div>
          ${consoles.length > 1 ? `<div class="roulette__group"><span>Console</span><div class="row" role="radiogroup" aria-label="Console">
            <button class="chip" type="button" role="radio" data-platform="" aria-checked="${!platform}">Toutes</button>
            ${consoles.map((id) => `<button class="chip" type="button" role="radio" data-platform="${esc(id)}" aria-checked="${id === platform}">${esc(platformMeta(id).short)}</button>`).join('')}
          </div></div>` : ''}
          <button class="btn btn--arcade" type="button" id="spin">▶ Lancer la roulette</button>` : '<p>Aucun jeu jamais joué dans ta collection : la roulette n\'a rien à tirer.</p>'}
      </div>
      <div class="roulette__reel" id="reel">
        <span class="roulette__arrow roulette__arrow--top" aria-hidden="true">▼</span>
        <div class="roulette__strip" id="strip"></div>
        <div class="roulette__frame" aria-hidden="true"></div>
        <span class="roulette__arrow roulette__arrow--bottom" aria-hidden="true">▲</span>
      </div>
    </section>

    <section class="section" id="for-you"></section>
    <section class="section" id="explore"></section>
    ${backlog.length ? `
      <section class="section">
        ${sectionHead('Encore sous blister', `<span class="note">${backlog.length} carte${backlog.length > 1 ? 's' : ''} · clique une carte pour la déballer</span>`)}
        <div id="sealed"></div>
      </section>` : ''}`;

  const stopGrid = backlog.length ? cardGrid($('#sealed', view), [...backlog].sort((a, b) => (b.igdbRating ?? 0) - (a.igdbRating ?? 0))) : null;
  attachHolo(view);
  bindStubs(view);

  /* ----- Roulette ----- */

  const machine = $('#roulette', view);
  const reel = $('#reel', view);
  const strip = $('#strip', view);
  const pool = () => backlog.filter((g) => (!platform || g.platform === platform) && LENGTHS[length][1](g.timeToBeat?.normally));
  let items = [];
  let index = 0; // jaquette actuellement sous le cadre
  let spinning = false;

  const step = () => {
    const img = strip.firstElementChild;
    return img ? img.getBoundingClientRect().width + parseFloat(getComputedStyle(strip).columnGap || 12) : 162;
  };
  const xFor = (i) => reel.clientWidth / 2 - (strip.firstElementChild?.getBoundingClientRect().width ?? 150) / 2 - i * step();
  const place = (i) => { strip.style.setProperty('--x', `${xFor(i)}px`); };

  const fill = () => {
    const list = pool();
    const n = list.length;
    $('#pool', view).textContent = backlog.length ? (n ? `${n} jeu${n > 1 ? 'x' : ''} jamais lancé${n > 1 ? 's' : ''} en jeu.` : 'Aucun jeu ne correspond à ces filtres.') : '';
    const spin = $('#spin', view);
    if (spin) spin.disabled = !n;
    items = shuffle(list).slice(0, STRIP_MAX);
    const loops = items.length ? LOOPS + 2 : 0;
    strip.innerHTML = Array.from({ length: loops }, () => items.map((g) => `<img src="${esc(cardArt(g))}" alt="" loading="lazy" data-title="${esc(g.name)}">`).join('')).join('');
    index = 0;
    machine.classList.remove('is-spinning');
    requestAnimationFrame(() => place(index));
  };
  fill();

  const showResult = (winner) => {
    reel.querySelector('.roulette__result')?.remove();
    reel.insertAdjacentHTML('beforeend', `
      <div class="roulette__result" role="status">
        ${cardHtml(winner)}
        <div class="actions">
          <span class="eyebrow">La roulette a choisi</span>
          <button class="btn btn--primary" type="button" data-start="${esc(winner.id)}" data-edit>▶ Je m'y mets</button>
          <a class="btn" href="#/jeu/${encodeURIComponent(winner.id)}">Voir la fiche</a>
          <button class="btn btn--ghost" type="button" id="respin">↻ Relancer</button>
        </div>
      </div>`);
  };

  const spin = () => {
    if (spinning || !items.length) return;
    reel.querySelector('.roulette__result')?.remove();
    const target = Math.floor(Math.random() * items.length);
    const winner = items[target];
    if (reduceMotion) { index = target; place(index); showResult(winner); return; }
    spinning = true;
    // On repart de la même jaquette dans le premier tour, puis 6 tours + l'écart jusqu'au gagnant
    machine.classList.remove('is-spinning');
    index %= items.length;
    place(index);
    void strip.offsetWidth;
    machine.classList.add('is-spinning');
    index = LOOPS * items.length + target;
    place(index);
    const done = () => {
      spinning = false;
      machine.classList.remove('is-spinning');
      index = target;
      place(index);
      showResult(winner);
    };
    let finished = false;
    strip.addEventListener('transitionend', () => { if (!finished) { finished = true; done(); } }, { once: true });
    setTimeout(() => { if (!finished) { finished = true; done(); } }, 3900);
  };

  view.addEventListener('click', (e) => {
    const l = e.target.closest('[data-length]');
    if (l && !spinning) {
      length = l.dataset.length;
      local.set('roulette:length', length);
      view.querySelectorAll('[data-length]').forEach((b) => b.setAttribute('aria-checked', String(b === l)));
      reel.querySelector('.roulette__result')?.remove();
      fill();
      return;
    }
    const pf = e.target.closest('[data-platform]');
    if (pf && !spinning) {
      platform = pf.dataset.platform;
      local.set('roulette:platform', platform);
      view.querySelectorAll('[data-platform]').forEach((b) => b.setAttribute('aria-checked', String(b === pf)));
      reel.querySelector('.roulette__result')?.remove();
      fill();
      return;
    }
    if (e.target.closest('#spin, #respin')) { spin(); return; }
    const start = e.target.closest('[data-start]');
    if (start) {
      const card = reel.querySelector('.roulette__result .tcg');
      if (card?.dataset.tier === 'sealed') { card.click(); return; } // déballage (voir main.js)
      requireEdit(async () => {
        await updateGame(start.dataset.start, { status: 'playing' });
        location.hash = `#/jeu/${encodeURIComponent(start.dataset.start)}`;
      });
    }
  });
  const onResize = () => { if (!spinning) place(index); };
  addEventListener('resize', onResize);

  /* ----- Suggestions IGDB ----- */

  const known = knownIgdbIds();
  const forYou = $('#for-you', view);
  const explore = $('#explore', view);
  const loading = (title) => `${sectionHead(title)}<div class="covers">${Array.from({ length: 6 }, () => '<div class="skeleton" style="aspect-ratio:3/4"></div>').join('')}</div>`;
  const row = (list, flag, accent = () => false) => `<div class="covers">${list.map((s, i) => miniCover(s, { i, flag: flag(s), accent: accent(s) })).join('')}</div>`;
  const failed = (title) => `${sectionHead(title)}<p class="muted">Suggestions indisponibles pour le moment.</p>`;

  if (profile.locked) {
    forYou.innerHTML = `
      ${sectionHead('Pour toi')}
      <div class="tile" style="display:flex;flex-direction:column;gap:12px;max-width:640px">
        <div class="row"><span style="font-size:22px">🔒</span><strong class="tile__title">Encore ${profile.missing} jeu${profile.missing > 1 ? 'x' : ''}</strong></div>
        <span class="muted">À ${PROFILE_MIN} jeux, Asobi te proposera des jeux taillés pour tes goûts. En attendant, voici les incontournables.</span>
        <div class="xpbar"><i style="--v:${(profile.count / PROFILE_MIN) * 100}%"></i></div>
      </div>`;
    explore.innerHTML = loading('Les incontournables');
    fetchRecommend([], 'explore', known)
      .then((list) => { explore.innerHTML = list.length ? `${sectionHead('Les incontournables', '<span class="note">les mieux notés sur IGDB</span>')}${row(list, (s) => (s.igdbRating ? `★ ${s.igdbRating}` : ''))}` : ''; })
      .catch(() => { explore.innerHTML = failed('Les incontournables'); });
    return () => { removeEventListener('resize', onResize); stopGrid?.(); };
  }

  const genres = profile.favoriteGenres;
  forYou.innerHTML = loading('Pour toi');
  Promise.allSettled([fetchRecommend(genres, 'match', known), fetchDiscover(profile.seeds, known)]).then(([rec, sim]) => {
    if (rec.status === 'rejected' && sim.status === 'rejected') { forYou.innerHTML = failed('Pour toi'); return; }
    // On alterne : un jeu « proche de tes favoris », un jeu « de ton genre préféré »
    const a = sim.status === 'fulfilled' ? sim.value.map((s) => ({ ...s, why: 'Proche de tes favoris' })) : [];
    const b = rec.status === 'fulfilled' ? rec.value.map((s) => ({ ...s, why: s.genres.find((x) => genres.includes(x)) ?? genres[0] })) : [];
    const seen = new Set();
    const mixed = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      for (const s of [a[i], b[i]]) if (s && !seen.has(s.igdbId)) { seen.add(s.igdbId); mixed.push(s); }
    }
    forYou.innerHTML = mixed.length
      ? `${sectionHead('Pour toi', `<span class="note">d'après ton profil : ${esc(genres.join(', '))}</span>`)}${row(mixed.slice(0, 20), (s) => s.why, (s) => s.why === 'Proche de tes favoris')}`
      : `${sectionHead('Pour toi')}${emptyState('🧭', 'Rien de neuf', 'Tu as déjà tout ce qui te correspond… impressionnant.')}`;
  });

  explore.innerHTML = loading('Découvertes');
  fetchRecommend(genres, 'explore', known)
    .then((list) => {
      explore.innerHTML = list.length
        ? `${sectionHead('Découvertes', '<span class="note">des pépites hors de tes genres habituels</span>')}${row(list, (s) => s.genres[0] ?? '')}`
        : '';
    })
    .catch(() => { explore.innerHTML = failed('Découvertes'); });

  return () => { removeEventListener('resize', onResize); stopGrid?.(); };
}
