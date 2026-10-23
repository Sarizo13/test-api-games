// Découvrir : la roulette parmi tes jeux jamais joués, tes cartes encore sous blister,
// et des suggestions IGDB « Pour toi » (d'après ton profil) et « Découvertes » (hors de tes habitudes).

import { platformMeta } from '../../platforms.js';
import { state, updateGame, fetchRecommend, fetchDiscover, knownIgdbIds } from '../state.js';
import { cardHtml, attachHolo } from '../card.js';
import { playerProfile, PROFILE_MIN } from '../taste.js';
import { requireEdit } from '../add.js';
import { sectionHead, emptyState, miniCover, bindStubs, thumb } from './common.js';
import { $, esc, reduceMotion, local, confetti, ICONS } from '../util.js';

const LENGTHS = {
  all: ['Toutes durées', () => true],
  short: ['Court (< 10 h)', (h) => h != null && h < 10],
  medium: ['Moyen (10–30 h)', (h) => h != null && h >= 10 && h <= 30],
  long: ['Long (30 h +)', (h) => h != null && h > 30],
};

export function renderDiscover(view) {
  const backlog = state.games.filter((g) => g.status === 'backlog');
  const profile = playerProfile(state.games);
  const consoles = [...new Set(backlog.map((g) => g.platform))];
  let length = local.get('roulette:length', 'all');
  let platform = local.get('roulette:platform', '');
  if (!LENGTHS[length]) length = 'all';
  if (platform && !consoles.includes(platform)) platform = '';

  view.innerHTML = `
    <div class="page-head">
      <div><p class="kicker">Découvrir</p><h1>À quoi je joue ?</h1>
      <p>Laisse le hasard choisir parmi tes jeux jamais lancés, ou trouve ton prochain coup de cœur.</p></div>
    </div>

    <section class="roulette">
      <div>
        <h2>La roulette 🎰</h2>
        <p>${backlog.length
          ? `${backlog.length} jeu${backlog.length > 1 ? 'x' : ''} jamais lancé${backlog.length > 1 ? 's' : ''} dans ta collection. Choisis une envie, la machine fait le reste.`
          : 'Aucun jeu jamais joué dans ta collection : la roulette n\'a rien à tirer.'}</p>
        ${backlog.length ? `
          <div class="chips" id="lengths" style="margin-bottom:12px">${Object.entries(LENGTHS).map(([k, [label]]) => `<button class="chip${k === length ? ' is-on' : ''}" type="button" data-length="${k}">${label}</button>`).join('')}</div>
          ${consoles.length > 1 ? `<select class="select" id="roulette-platform" style="max-width:280px;margin-bottom:18px" aria-label="Console">
            <option value="">Toutes les consoles</option>
            ${consoles.map((id) => `<option value="${esc(id)}"${id === platform ? ' selected' : ''}>${esc(platformMeta(id).id)}</option>`).join('')}
          </select>` : ''}
          <div class="chips" style="gap:10px">
            <button class="btn btn-primary" type="button" id="spin">${ICONS.dice}Lancer la roulette</button>
            <span class="muted" id="pool" style="align-self:center;font-size:13px"></span>
          </div>
          <div id="roulette-actions" class="chips" style="margin-top:16px" hidden></div>` : ''}
      </div>
      <div class="slot" id="slot">
        <div class="slot-reel" id="reel">${backlog.slice(0, 1).map((g) => thumb(g)).join('') || '<span class="ph"></span>'}</div>
        <div class="slot-result" id="slot-result" hidden></div>
      </div>
    </section>

    <section class="section" id="for-you"></section>
    <section class="section" id="explore"></section>

    ${backlog.length ? `
      ${sectionHead('Encore sous blister', `<span class="muted" style="font-size:13px">${backlog.length} carte${backlog.length > 1 ? 's' : ''} à révéler</span>`)}
      <div class="cards section">${[...backlog].sort((a, b) => (b.igdbRating ?? 0) - (a.igdbRating ?? 0)).map((g, i) => cardHtml(g, { i })).join('')}</div>` : ''}`;

  attachHolo(view);
  bindStubs(view);

  /* ----- Roulette ----- */

  const pool = () => backlog.filter((g) => (!platform || g.platform === platform) && LENGTHS[length][1](g.timeToBeat?.normally));
  const showPool = () => {
    const n = pool().length;
    const el = $('#pool', view);
    if (el) el.textContent = n ? `${n} jeu${n > 1 ? 'x' : ''} en jeu` : 'Aucun jeu ne correspond';
    const spin = $('#spin', view);
    if (spin) spin.disabled = !n;
  };
  showPool();

  let winner = null;
  let spinning = false;

  const spin = () => {
    const list = pool();
    if (!list.length || spinning) return;
    spinning = true;
    winner = list[Math.floor(Math.random() * list.length)];
    const reel = $('#reel', view);
    const result = $('#slot-result', view);
    result.hidden = true;
    $('#roulette-actions', view).hidden = true;

    // Une bande de jaquettes au hasard, le gagnant en dernier
    const strip = Array.from({ length: reduceMotion ? 0 : 18 }, () => list[Math.floor(Math.random() * list.length)]);
    reel.style.transition = 'none';
    reel.style.transform = 'none';
    reel.style.opacity = '1';
    reel.innerHTML = [...strip, winner].map((g) => thumb(g)).join('');

    const land = () => {
      reel.style.opacity = '0';
      result.innerHTML = cardHtml(winner);
      result.hidden = false;
      const actions = $('#roulette-actions', view);
      actions.innerHTML = `
        <button class="btn btn-primary" type="button" data-start="${esc(winner.id)}">${ICONS.play}Je m'y mets</button>
        <a class="btn btn-ghost" href="#/jeu/${encodeURIComponent(winner.id)}">Voir la fiche</a>
        <button class="btn btn-ghost" type="button" id="respin">${ICONS.refresh}Relancer</button>`;
      actions.hidden = false;
      spinning = false;
    };

    if (reduceMotion) { land(); return; }
    requestAnimationFrame(() => {
      const item = reel.firstElementChild;
      const step = item.getBoundingClientRect().height + parseFloat(getComputedStyle(reel).rowGap || 14);
      reel.style.transition = 'transform 3.2s cubic-bezier(.12, .7, .14, 1)';
      reel.style.transform = `translateY(${-step * strip.length}px)`;
      reel.addEventListener('transitionend', () => setTimeout(land, 250), { once: true });
    });
  };

  view.addEventListener('click', (e) => {
    const l = e.target.closest('[data-length]');
    if (l) {
      length = l.dataset.length;
      local.set('roulette:length', length);
      view.querySelectorAll('[data-length]').forEach((b) => b.classList.toggle('is-on', b === l));
      showPool();
      return;
    }
    if (e.target.closest('#spin, #respin')) { spin(); return; }
    const start = e.target.closest('[data-start]');
    if (start) {
      requireEdit(async () => {
        const id = start.dataset.start;
        $('#slot-result .tcg', view)?.classList.add('is-unwrapping');
        const r = start.getBoundingClientRect();
        confetti(r.left + r.width / 2, r.top);
        await updateGame(id, { status: 'playing' });
        setTimeout(() => { location.hash = `#/jeu/${encodeURIComponent(id)}`; }, 700);
      });
    }
  });
  $('#roulette-platform', view)?.addEventListener('change', (e) => {
    platform = e.target.value;
    local.set('roulette:platform', platform);
    showPool();
  });

  /* ----- Suggestions IGDB ----- */

  const known = knownIgdbIds();
  const forYou = $('#for-you', view);
  const explore = $('#explore', view);
  const loading = (title) => `${sectionHead(title)}<div class="shimmer" style="height:250px;border-radius:14px"></div>`;
  const row = (list, flag) => `<div class="scroller" style="--col:140px">${list.map((s, i) => miniCover(s, { i, flag: flag(s) })).join('')}</div>`;
  const failed = (title) => `${sectionHead(title)}<p class="muted">Suggestions indisponibles pour le moment.</p>`;

  if (profile.locked) {
    forYou.innerHTML = `
      ${sectionHead('Pour toi')}
      <div class="panel" style="display:grid;gap:12px">
        <strong>🔒 Débloqué à ${PROFILE_MIN} jeux</strong>
        <span class="muted">Encore ${profile.missing} jeu${profile.missing > 1 ? 'x' : ''} dans ta collection et Asobi te proposera des jeux taillés pour tes goûts.</span>
        <div class="progress"><span style="--p:${(profile.count / PROFILE_MIN) * 100}%"></span></div>
      </div>`;
    explore.innerHTML = loading('Les incontournables');
    fetchRecommend([], 'explore', known)
      .then((list) => { explore.innerHTML = list.length ? `${sectionHead('Les incontournables', '<span class="muted" style="font-size:13px">les mieux notés sur IGDB</span>')}${row(list, (s) => s.igdbRating ? `★ ${s.igdbRating}` : '')}` : ''; })
      .catch(() => { explore.innerHTML = failed('Les incontournables'); });
    return null;
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
      ? `${sectionHead('Pour toi', `<span class="muted" style="font-size:13px">d'après ton profil : ${esc(genres.join(', '))}</span>`)}${row(mixed.slice(0, 20), (s) => s.why)}`
      : `${sectionHead('Pour toi')}${emptyState('🧭', 'Rien de neuf', 'Tu as déjà tout ce qui te correspond… impressionnant.')}`;
  });

  explore.innerHTML = loading('Découvertes');
  fetchRecommend(genres, 'explore', known)
    .then((list) => {
      explore.innerHTML = list.length
        ? `${sectionHead('Découvertes', '<span class="muted" style="font-size:13px">des pépites hors de tes genres habituels</span>')}${row(list, (s) => s.genres[0] ?? '')}`
        : '';
    })
    .catch(() => { explore.innerHTML = failed('Découvertes'); });

  return null;
}
