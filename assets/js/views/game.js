// Fiche d'un jeu : grande carte, statut, notes, temps de jeu, trophées, avis, captures, jeux similaires.

import { FAMILIES, PLATFORMS, platformMeta } from '../../platforms.js';
import { state, gameById, updateGame, removeGame, togglePlaylist, fetchDiscover, knownIgdbIds, onChange, TEST } from '../state.js';
import { cardHtml, cardStats, attachHolo, STATUS, RATINGS, TIERS } from '../card.js';
import { radar, animateCharts } from '../charts.js';
import { ratingBar, paintRating, bindRatings } from '../rating.js';
import { createTrailer, hasTrailer, trailersAllowed } from '../trailer.js';
import { openLogin } from '../add.js';
import { consoleHref } from './consoles.js';
import { sectionHead, miniCover, bindStubs, emptyState } from './common.js';
import { $, $$, esc, safeUrl, cssUrl, fmtDate, fmtHours, debounce, setAmbient, confetti, toast, ICONS } from '../util.js';

const SOURCES = { steam: 'Steam', wikipedia: 'Wikipédia', deepl: 'traduction DeepL', igdb: 'IGDB (en anglais)' };

export function renderGame(view, id) {
  const g = gameById(decodeURIComponent(id));
  if (!g) {
    view.innerHTML = emptyState('🔍', 'Jeu introuvable', 'Ce jeu n\'est pas (ou plus) dans ta collection.', '<a class="btn btn-ghost" href="#/consoles">Retour aux consoles</a>');
    return null;
  }

  const p = platformMeta(g.platform);
  const heroFull = g.images?.hero || g.images?.screenshots?.[0] || '';
  const heroPreview = g.images?.heroThumb || heroFull || g.images?.gridThumb || g.images?.cover;
  const withTrailer = hasTrailer(g) && trailersAllowed;
  const shots = (g.images?.screenshots ?? []).map(safeUrl).filter(Boolean).slice(0, 6);

  view.innerHTML = `
    <section class="game-hero${withTrailer ? ' has-trailer' : ''}">
      <div class="hero-bg" style="${heroPreview
        ? `background-image:${cssUrl(heroPreview)}${heroFull ? '' : ';filter:blur(26px) saturate(1.3);transform:scale(1.25)'}`
        : `background:radial-gradient(120% 120% at 100% 0%, ${p.color}88, transparent 60%), #0d0f17`}"></div>
      ${safeUrl(g.images?.logo) ? `<img class="hero-logo" src="${esc(g.images.logo)}" alt="">` : ''}
    </section>

    <section class="game-layout">
      <aside class="game-side">
        <div id="big-card"></div>
        <div class="panel" id="power"></div>
      </aside>

      <div class="game-main">
        <a class="badge" href="${consoleHref(g.platform)}" style="--c:${p.color}">${esc(p.id)}</a>
        <h1>${esc(g.name)}</h1>
        <div class="game-meta">
          ${g.releaseDate ? `<span>📅 ${esc(fmtDate(g.releaseDate))}</span>` : ''}
          ${g.developers?.length ? `<span>🏢 ${esc(g.developers.slice(0, 2).join(', '))}</span>` : ''}
          ${g.igdbRating ? `<span>★ ${g.igdbRating}/100 sur IGDB</span>` : ''}
          ${g.timeToBeat?.normally ? `<span>⏱ ~${Math.round(g.timeToBeat.normally)} h pour le finir</span>` : ''}
        </div>
        ${g.genres?.length ? `<div class="chips" style="margin-bottom:20px">${g.genres.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}

        <div class="field">
          <span>Statut</span>
          <div class="segmented" id="status">${Object.entries(STATUS).map(([k, s]) => `
            <button type="button" data-status="${k}" style="--c:${s.color}">${s.icon} ${s.label}</button>`).join('')}</div>
        </div>

        <div class="game-actions">
          <button class="icon-btn" type="button" id="fav" title="Coup de cœur" aria-label="Coup de cœur">${ICONS.heart}</button>
          <button class="btn btn-ghost" type="button" id="playlist"></button>
          <select class="select" id="move" style="width:auto;height:40px" aria-label="Changer de console">
            <option value="">${'⇄'} Changer de console…</option>
            ${FAMILIES.map((f) => `<optgroup label="${esc(f.name)}">${PLATFORMS.filter((x) => x.family === f.id && x.id !== g.platform).map((x) => `<option value="${esc(x.id)}">${esc(x.id)}</option>`).join('')}</optgroup>`).join('')}
          </select>
          <button class="btn btn-danger" type="button" id="remove">${ICONS.trash}Retirer</button>
        </div>

        <div class="blocks">
          <div class="panel">
            <h3>Ma note</h3>
            <div class="rating-grid">
              <div class="sliders">${Object.entries(RATINGS).map(([k, label]) => `
                <div class="slider-row"><span>${label}</span>${ratingBar(k, label)}<output data-out="${k}">—</output></div>`).join('')}
                <p class="source-note" style="margin:0">Touche ou fais glisser sur les segments · au clavier : flèches, Suppr pour effacer</p>
                <button class="btn btn-ghost btn-sm" type="button" id="clear-ratings" style="justify-self:start">Effacer mes notes</button>
              </div>
              <div id="radar"></div>
            </div>
          </div>

          <div class="panel">
            <h3>Progression</h3>
            <div class="inline-fields">
              <label class="field"><span>Temps de jeu <small>(heures)</small></span><input class="input" type="number" min="0" step="0.5" id="hours"></label>
              <label class="field"><span>Trophées <small>(%)</small></span><input class="input" type="number" min="0" max="100" step="1" id="trophies"></label>
            </div>
            <p class="source-note" id="progress-source"></p>
            <div class="ttb" id="ttb"></div>
            <div class="inline-fields" style="margin-top:16px">
              <label class="field"><span>Commencé le</span><input class="input" type="date" id="started"></label>
              <label class="field"><span>Terminé le</span><input class="input" type="date" id="finished"></label>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-bottom:18px">
          <h3 style="display:flex;justify-content:space-between">Mon avis <span class="saved" id="saved">Enregistré ✓</span></h3>
          <textarea class="textarea" id="review" placeholder="Ce que tu en as pensé, tes souvenirs, tes astuces…" maxlength="5000"></textarea>
        </div>

        ${g.summary ? `
          <div class="section">
            ${sectionHead('Résumé')}
            <p class="summary">${esc(g.summary)}</p>
            ${SOURCES[g.summarySource] ? `<p class="source-note">Résumé : ${safeUrl(g.summaryUrl) ? `<a href="${esc(g.summaryUrl)}" target="_blank" rel="noopener">${SOURCES[g.summarySource]}</a>` : SOURCES[g.summarySource]}</p>` : ''}
          </div>` : ''}

        ${shots.length ? `<div class="section">${sectionHead('Captures')}<div class="shots">${shots.map((s) => `<button type="button" data-shot="${esc(s)}"><img src="${esc(s.replace('/t_1080p/', '/t_screenshot_med/'))}" alt="" loading="lazy"></button>`).join('')}</div></div>` : ''}

        <div class="chips section">
          ${safeUrl(g.igdbUrl) ? `<a class="btn btn-ghost btn-sm" href="${esc(g.igdbUrl)}" target="_blank" rel="noopener">IGDB ↗</a>` : ''}
          ${g.sgdbId ? `<a class="btn btn-ghost btn-sm" href="https://www.steamgriddb.com/game/${g.sgdbId}" target="_blank" rel="noopener">SteamGridDB ↗</a>` : ''}
          ${g.steamAppId ? `<a class="btn btn-ghost btn-sm" href="https://store.steampowered.com/app/${g.steamAppId}" target="_blank" rel="noopener">Steam ↗</a>` : ''}
        </div>

        <div class="section" id="similar"></div>
      </div>
    </section>`;

  /* ----- Remplissage et mises à jour ----- */

  let cardShown = false;
  const refreshCard = () => {
    const s = cardStats(g);
    $('#big-card', view).innerHTML = cardHtml(g, { large: true });
    // L'animation d'entrée ne joue qu'à l'ouverture de la fiche, pas à chaque modification
    if (cardShown) $('#big-card .tcg', view).style.animation = 'none';
    cardShown = true;
    const t = TIERS[s.tier];
    const row = (icon, label, value, color) => `
      <div class="power-row"><span>${icon}</span><div><span style="font-size:12px;color:var(--muted)">${label}</span>
        <div class="progress"><span data-p="${value ?? 0}%" style="--c:${color}"></span></div></div><b>${value == null ? '—' : Math.round(value)}</b></div>`;
    $('#power', view).innerHTML = `
      <h3 style="display:flex;justify-content:space-between;align-items:center">Puissance <span class="badge" style="--c:${t.color}">${esc(t.label)}</span></h3>
      <div class="power-breakdown">
        ${row('🖋️', 'Ta note', s.rating, '#c084fc')}
        ${row('⏱', g.timeToBeat?.normally ? 'Temps de jeu (vs. durée moyenne)' : 'Temps de jeu', s.time, '#22d3ee')}
        ${row('🏆', 'Trophées', s.trophies, '#fbbf24')}
      </div>
      <p class="source-note">${s.tier === 'sealed' ? 'Encore sous blister : lance le jeu pour révéler sa carte.' : 'Moyenne des trois (ce qui manque compte 0) · terminé +4 · 100 % +8 · coup de cœur +4'}</p>`;
    animateCharts($('#power', view));
  };

  // Barres de notes et radar, pour les notes enregistrées ou un aperçu pendant le geste
  const showRatings = (ratings) => {
    for (const k of Object.keys(RATINGS)) paintRating($(`[data-rating="${k}"]`, view), $(`[data-out="${k}"]`, view), ratings[k] ?? null);
    $('#radar', view).innerHTML = radar(Object.entries(RATINGS).map(([k, label]) => ({ label: label.split(' ')[0], value: ratings[k] ?? null })));
  };

  const refreshControls = () => {
    $$('#status button', view).forEach((b) => b.setAttribute('aria-pressed', b.dataset.status === g.status));
    $('#fav', view).classList.toggle('is-on', Boolean(g.favorite));
    const queued = state.playlist.includes(g.id);
    $('#playlist', view).innerHTML = queued ? `${ICONS.check}Dans ma liste` : `${ICONS.list}À jouer ensuite`;
    showRatings(g.ratings ?? {});
    const hoursInput = $('#hours', view);
    if (document.activeElement !== hoursInput) hoursInput.value = g.playtimeMinutes != null ? Math.round((g.playtimeMinutes / 60) * 10) / 10 : '';
    const tro = $('#trophies', view);
    if (document.activeElement !== tro) tro.value = g.achievements?.percent ?? '';
    const sources = [
      g.playtimeSource === 'steam' && `Temps de jeu synchronisé avec Steam${g.lastPlayedAt ? ` (dernière partie le ${fmtDate(g.lastPlayedAt)})` : ''}`,
      g.achievements?.source === 'steam' && `succès Steam : ${g.achievements.unlocked}/${g.achievements.total}`,
    ].filter(Boolean);
    $('#progress-source', view).textContent = sources.join(' · ');
    const ttb = g.timeToBeat;
    const played = (g.playtimeMinutes ?? 0) / 60;
    if (ttb?.normally) {
      const max = Math.max(ttb.completely ?? ttb.normally * 1.5, played, ttb.normally) * 1.05;
      $('#ttb', view).innerHTML = `
        <span>${fmtHours(g.playtimeMinutes ?? 0)} joué${played ? 'es' : ''} · durée moyenne ${Math.round(ttb.normally)} h${ttb.completely ? ` · 100 % en ${Math.round(ttb.completely)} h` : ''}</span>
        <div class="ttb-bar"><span data-p="${Math.min(100, (played / max) * 100)}%"></span>
          <i style="--x:${(ttb.normally / max) * 100}%" title="Durée moyenne"></i>
          ${ttb.completely ? `<i style="--x:${(ttb.completely / max) * 100}%;background:#fbbf24" title="100 %"></i>` : ''}</div>`;
      animateCharts($('#ttb', view));
    }
    $('#started', view).value = g.startedAt ?? '';
    $('#finished', view).value = g.finishedAt ?? '';
  };

  refreshCard();
  refreshControls();
  $('#review', view).value = g.review ?? '';
  attachHolo(view);
  setAmbient(g.images?.gridThumb || g.images?.cover);

  // Image du bandeau en HD dès qu'elle est téléchargée
  if (heroFull && heroFull !== heroPreview) {
    const img = new Image();
    img.onload = () => { const bg = $('.hero-bg', view); if (bg) bg.style.backgroundImage = cssUrl(heroFull); };
    img.src = heroFull;
  }

  /* ----- Modifications ----- */

  // Sans connexion : on demande le mot de passe (la page se redessine une fois connecté)
  const guard = () => {
    if (state.canEdit) return true;
    openLogin();
    refreshControls();
    return false;
  };

  const save = async (patch) => {
    await updateGame(g.id, patch);
    refreshCard();
    refreshControls();
  };

  view.addEventListener('click', async (e) => {
    const status = e.target.closest('[data-status]');
    if (status && guard()) {
      const was = g.status;
      const next = status.dataset.status;
      if (next === was) return;
      if (was === 'backlog') $('.tcg', view)?.classList.add('is-unwrapping');
      if (['finished', 'completed'].includes(next)) {
        const r = status.getBoundingClientRect();
        confetti(r.left + r.width / 2, r.top);
      }
      // On laisse le blister s'arracher (0,9 s) avant de redessiner la carte
      setTimeout(() => save({ status: next }), was === 'backlog' ? 850 : 0);
      return;
    }
    if (e.target.closest('#fav') && guard()) { save({ favorite: !g.favorite }); return; }
    if (e.target.closest('#playlist') && guard()) {
      await togglePlaylist(g.id);
      refreshControls();
      toast('📋', state.playlist.includes(g.id) ? 'Ajouté à ta liste « à jouer »' : 'Retiré de ta liste « à jouer »');
      return;
    }
    if (e.target.closest('#clear-ratings') && guard()) {
      save({ ratings: Object.fromEntries(Object.keys(RATINGS).map((k) => [k, null])) });
      return;
    }
    if (e.target.closest('#remove') && guard()) {
      if (!confirm(`Retirer ${g.name} de ta collection ? Tes notes et ton avis seront perdus.`)) return;
      const target = consoleHref(g.platform);
      await removeGame(g.id);
      toast('🗑️', `${g.name} retiré de ta collection`, TEST ? ' (mode test)' : '');
      location.hash = state.games.some((x) => x.platform === g.platform) ? target : '#/consoles';
      return;
    }
    const shot = e.target.closest('[data-shot]');
    if (shot) {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.innerHTML = `<img src="${esc(shot.dataset.shot)}" alt="">`;
      box.addEventListener('click', () => box.remove());
      document.body.append(box);
    }
  });

  // Notes : aperçu immédiat pendant le geste, enregistrement quand on lâche
  bindRatings(view, {
    canEdit: guard,
    preview: (k, v) => showRatings({ ...g.ratings, [k]: v }),
    commit: (k, v) => { if ((g.ratings?.[k] ?? null) !== v) save({ ratings: { [k]: v } }); else showRatings(g.ratings ?? {}); },
    cancel: () => showRatings(g.ratings ?? {}),
  });
  view.addEventListener('change', (e) => {
    if (!state.canEdit && e.target.matches('input, select')) { guard(); return; }
    if (e.target.id === 'hours') save({ playtimeMinutes: e.target.value === '' ? null : Math.round(Number(e.target.value) * 60) });
    if (e.target.id === 'trophies') save({ achievements: e.target.value === '' ? null : { percent: Number(e.target.value) } });
    if (e.target.id === 'started') save({ startedAt: e.target.value || null });
    if (e.target.id === 'finished') save({ finishedAt: e.target.value || null });
    if (e.target.id === 'move' && e.target.value) {
      const to = e.target.value;
      save({ platform: to }).then(() => {
        const badge = $('.game-main > .badge', view);
        const meta = platformMeta(g.platform);
        Object.assign(badge, { href: consoleHref(g.platform), textContent: meta.id });
        badge.style.setProperty('--c', meta.color);
        e.target.value = '';
        if (g.platform === to) toast('⇄', `${g.name} rangé dans ${meta.short}`);
      });
    }
  });

  // Avis : enregistré automatiquement après une pause dans la frappe
  const saveReview = debounce(async (value) => {
    await updateGame(g.id, { review: value });
    const saved = $('#saved', view);
    saved?.classList.add('is-on');
    setTimeout(() => saved?.classList.remove('is-on'), 1600);
  }, 900);
  $('#review', view).addEventListener('input', (e) => { if (guard()) saveReview(e.target.value); });

  // Jeux similaires (IGDB)
  if (g.igdbId) {
    fetchDiscover([g.igdbId], knownIgdbIds()).then((list) => {
      const box = $('#similar', view);
      if (!box || !list.length) return;
      box.innerHTML = `${sectionHead('Si tu as aimé, essaie aussi')}<div class="scroller" style="--col:140px">${list.slice(0, 12).map((s, i) => miniCover(s, { i })).join('')}</div>`;
    }).catch(() => {});
    bindStubs(view);
  }

  // Modification refusée par le serveur (valeurs remises en place) : on redessine
  const unsubscribe = onChange((e) => {
    if (e.detail.type === 'game' && e.detail.id === g.id) { refreshCard(); refreshControls(); }
  });

  // Bande-annonce : zoom sur l'image, puis la vidéo
  const trailer = withTrailer ? createTrailer($('.hero-bg', view), g, { soundParent: $('.game-hero', view) }) : null;
  return () => { trailer?.stop(); unsubscribe(); };
}
