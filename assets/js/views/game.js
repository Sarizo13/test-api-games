// Fiche d'un jeu : bandeau (zoom puis diaphragme sur la bande-annonce), grande carte, puissance détaillée,
// statut segmenté, notes (6 aspects + radar), progression, avis enregistré tout seul, résumé, captures, suggestions.

import { FAMILIES, PLATFORMS, platformMeta } from '../../platforms.js';
import { state, gameById, updateGame, removeGame, togglePlaylist, fetchDiscover, knownIgdbIds, onChange, TEST } from '../state.js';
import { cardHtml, cardStats, attachHolo, flashCard, tierRank, ratingAverage, STATUS, RATINGS, TIERS } from '../card.js';
import { radar, animateCharts } from '../charts.js';
import { ratingRow, paintRating, bindRatings } from '../rating.js';
import { createTrailer, hasTrailer, trailersAllowed } from '../trailer.js';
import { openLogin } from '../add.js';
import { consoleHref } from './consoles.js';
import { sectionHead, miniCover, bindStubs, emptyState } from './common.js';
import { $, esc, safeUrl, fmtDate, fmtHours, debounce, setAmbient, confetti, toast, segmented, setSegmented } from '../util.js';

const SOURCES = { steam: 'Steam', wikipedia: 'Wikipédia', deepl: 'traduction DeepL', igdb: 'IGDB (en anglais)' };
const PROVIDERS = { steam: 'Steam', playstation: 'PlayStation', xbox: 'Xbox', epicgames: 'Epic Games', nintendo: 'Nintendo' };
const STATUS_OPTIONS = Object.entries(STATUS).map(([k, s]) => ({ value: k, label: s.label, icon: s.icon, color: s.color }));
const fmt1 = (v) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

export function renderGame(view, id) {
  const g = gameById(decodeURIComponent(id));
  if (!g) {
    view.innerHTML = emptyState('?', 'Jeu introuvable', 'Ce jeu n\'est pas (ou plus) dans ta collection.', '<a class="btn btn--primary" href="#/consoles">Retour aux consoles</a>');
    return null;
  }

  const p = platformMeta(g.platform);
  const heroFull = safeUrl(g.images?.hero) || safeUrl(g.images?.screenshots?.[0]);
  const heroPreview = safeUrl(g.images?.heroThumb) || heroFull;
  const fallback = heroPreview ? '' : safeUrl(g.images?.gridThumb) || safeUrl(g.images?.cover);
  const withTrailer = hasTrailer(g) && trailersAllowed;
  const shots = (g.images?.screenshots ?? []).map(safeUrl).filter(Boolean).slice(0, 6);

  view.innerHTML = `
    <section class="banner${heroPreview ? '' : ' banner--fallback'}" aria-label="${esc(g.name)}">
      <div class="banner__cover"><div class="banner__zoom">
        ${heroPreview || fallback ? `<img class="banner__hero" src="${esc(heroPreview || fallback)}" alt="">` : ''}
        ${safeUrl(g.images?.logo) ? `<img class="banner__logo" src="${esc(g.images.logo)}" alt="">` : ''}
      </div></div>
      <div class="banner__tools">${withTrailer ? '<button class="btn" type="button" id="replay">↻ Rejouer l\'ouverture</button>' : ''}</div>
    </section>

    <section class="game">
      <aside class="game__side">
        <div class="game__card" id="big-card"></div>
        <div class="tile" id="power"></div>
      </aside>

      <div class="game__main">
        <div class="row"><a class="pill-console" href="${consoleHref(g.platform)}" id="console-pill" style="--pc:${p.color}">${esc(p.short)}</a></div>
        <h1 class="game__title">${esc(g.name)}</h1>
        <div class="game__meta">
          ${g.releaseDate ? `<span>${esc(fmtDate(g.releaseDate))}</span>` : ''}
          ${g.developers?.length ? `<span>${esc(g.developers.slice(0, 2).join(', '))}</span>` : ''}
          ${g.igdbRating ? `<span>★ <b>${g.igdbRating}</b>/100 sur IGDB</span>` : ''}
          ${g.timeToBeat?.normally ? `<span>~${Math.round(g.timeToBeat.normally)} h pour le finir</span>` : ''}
        </div>
        ${g.genres?.length ? `<div class="row">${g.genres.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}

        <div class="field">
          <span class="field__label">Statut</span>
          ${segmented('status', STATUS_OPTIONS, g.status, { label: 'Statut' })}
        </div>

        <div class="actions">
          <button class="btn" type="button" id="fav" aria-pressed="false">♥ Coup de cœur</button>
          <button class="btn" type="button" id="playlist"></button>
          <select class="select" id="move" style="width:auto;min-height:44px" aria-label="Changer de console">
            <option value="">⇄ Changer de console…</option>
            ${FAMILIES.map((f) => `<optgroup label="${esc(f.name)}">${PLATFORMS.filter((x) => x.family === f.id && x.id !== g.platform).map((x) => `<option value="${esc(x.id)}">${esc(x.id)}</option>`).join('')}</optgroup>`).join('')}
          </select>
          <button class="btn btn--danger" type="button" id="remove" style="margin-left:auto">Retirer</button>
        </div>

        <div class="game__blocks">
          <div>
            <div class="tile">
              <div class="tile-head"><h3 class="tile__title">Ma note</h3><span class="muted-2" style="font-size:12px">glisse, touche ou ← →</span></div>
              <div class="rating">${Object.entries(RATINGS).map(([k, label]) => ratingRow(k, label)).join('')}</div>
              <div id="radar" style="margin-top:18px"></div>
              <button class="btn btn--ghost" type="button" id="clear-ratings" style="margin-top:8px">Effacer mes notes</button>
            </div>
          </div>
          <div>
            <div class="tile" style="display:flex;flex-direction:column;gap:14px">
              <h3 class="tile__title">Progression</h3>
              <div class="inline-fields">
                <label class="field"><span class="field__label">Temps de jeu</span><span class="input-unit"><input class="input" type="number" min="0" step="0.5" id="hours" inputmode="decimal"><span>h</span></span></label>
                <label class="field"><span class="field__label">Trophées</span><span class="input-unit"><input class="input" type="number" min="0" max="100" step="1" id="trophies" inputmode="numeric"><span>%</span></span></label>
              </div>
              <div id="progress-source"></div>
              <div class="ttb" id="ttb"></div>
              <div class="inline-fields">
                <label class="field"><span class="field__label">Début</span><input class="input" type="date" id="started"></label>
                <label class="field"><span class="field__label">Fin</span><input class="input" type="date" id="finished"></label>
              </div>
            </div>
            <div class="tile" style="display:flex;flex-direction:column;gap:12px">
              <div class="tile-head" style="margin:0"><h3 class="tile__title">Mon avis</h3><span class="saved" id="saved"></span></div>
              <textarea class="input" id="review" placeholder="Ce que tu en as pensé, tes souvenirs, tes astuces…" maxlength="5000" aria-label="Mon avis"></textarea>
            </div>
          </div>
        </div>

        ${g.summary || shots.length ? `
          <div class="grid-2">
            ${g.summary ? `
              <div class="tile" style="display:flex;flex-direction:column;gap:12px">
                <h3 class="tile__title">Résumé</h3>
                <p class="summary">${esc(g.summary)}</p>
                ${SOURCES[g.summarySource] ? `<p class="note-line mono">Source : ${safeUrl(g.summaryUrl) ? `<a href="${esc(g.summaryUrl)}" target="_blank" rel="noopener">${SOURCES[g.summarySource]}</a>` : SOURCES[g.summarySource]}</p>` : ''}
                <div class="row">
                  ${safeUrl(g.igdbUrl) ? `<a class="btn btn--ghost" href="${esc(g.igdbUrl)}" target="_blank" rel="noopener">IGDB ↗</a>` : ''}
                  ${g.sgdbId ? `<a class="btn btn--ghost" href="https://www.steamgriddb.com/game/${Number(g.sgdbId)}" target="_blank" rel="noopener">SteamGridDB ↗</a>` : ''}
                  ${g.steamAppId ? `<a class="btn btn--ghost" href="https://store.steampowered.com/app/${Number(g.steamAppId)}" target="_blank" rel="noopener">Steam ↗</a>` : ''}
                </div>
              </div>` : ''}
            ${shots.length ? `
              <div class="tile" style="display:flex;flex-direction:column;gap:12px">
                <div class="tile-head" style="margin:0"><h3 class="tile__title">Captures</h3><span class="muted-2" style="font-size:12px">clique pour agrandir</span></div>
                <div class="shots">${shots.map((s) => `<button type="button" data-shot="${esc(s)}" aria-label="Agrandir la capture"><img src="${esc(s.replace('/t_1080p/', '/t_screenshot_med/'))}" alt="" loading="lazy"></button>`).join('')}</div>
              </div>` : ''}
          </div>` : ''}

        <div class="section" id="similar"></div>
      </div>
    </section>`;

  /* ----- Remplissage et mises à jour ----- */

  let shownTier = null;
  const refreshCard = () => {
    const s = cardStats(g);
    $('#big-card', view).innerHTML = cardHtml(g, { large: true });
    const card = $('#big-card .tcg', view);
    // Montée de rareté : éclair + notification
    if (shownTier && tierRank(s.tier) > tierRank(shownTier) && shownTier !== 'sealed') {
      flashCard(card);
      toast('◆', `Ta carte passe ${TIERS[s.tier].label} !`, `${g.name} · puissance ${s.power}`, 5000, { color: TIERS[s.tier].color });
    }
    shownTier = s.tier;
    const t = TIERS[s.tier];
    const r = ratingAverage(g);
    const ttb = g.timeToBeat?.normally;
    const row = (label, detail, value, color) => `
      <div class="power-row"><span>${label} <span class="muted-2">${detail}</span></span><b>${value == null ? '—' : Math.round(value)}</b>
        <span class="bar"><i data-v="${Math.round(value ?? 0)}%" style="background:${color}"></i></span></div>`;
    const bonus = (g.status === 'completed' ? 8 : g.status === 'finished' ? 4 : 0) + (g.favorite ? 4 : 0);
    const base = Math.round(((s.rating ?? 0) + (s.time ?? 0) + (s.trophies ?? 0)) / 3);
    $('#power', view).innerHTML = `
      <div class="tile-head"><h3 class="tile__title">Puissance</h3><span class="tier-tag" style="--tc:${t.color}">${esc(t.label)}</span></div>
      <div class="power-rows">
        ${row('Ta note', r == null ? '' : `${fmt1(r)}/10`, s.rating, 'var(--m-note)')}
        ${row('Temps de jeu', s.hours ? `${fmtHours(g.playtimeMinutes)}${ttb ? ` / ~${Math.round(ttb)} h` : ''}` : '', s.time, 'var(--m-time)')}
        ${row('Trophées', s.trophies != null ? `${Math.round(s.trophies)} %` : '', s.trophies, 'var(--m-troph)')}
      </div>
      <p class="note-line mono" style="margin-top:14px">${s.tier === 'sealed'
        ? 'Sous blister : clique sur la carte pour la déballer.'
        : `moyenne ${base}${g.status === 'completed' ? ' · 100 % +8' : g.status === 'finished' ? ' · terminé +4' : ''}${g.favorite ? ' · coup de cœur +4' : ''}${bonus ? ` = ${s.power}` : ''}`}</p>`;
    animateCharts($('#power', view));
  };

  // Pistes de notes et radar, pour les notes enregistrées ou un aperçu pendant le geste
  const showRatings = (ratings) => {
    for (const k of Object.keys(RATINGS)) paintRating($(`[data-rating="${k}"]`, view), $(`[data-out="${k}"]`, view), ratings[k] ?? null);
    $('#radar', view).innerHTML = radar(Object.entries(RATINGS).map(([k, label]) => ({ label: label.split(' ')[0], value: ratings[k] ?? null })));
  };

  const refreshControls = () => {
    setSegmented($('[data-seg="status"]', view), g.status);
    $('#fav', view).setAttribute('aria-pressed', String(Boolean(g.favorite)));
    const pos = state.playlist.indexOf(g.id);
    $('#playlist', view).textContent = pos >= 0 ? `≡ Dans « À jouer » · ${pos + 1}${pos ? 'e' : 'er'}` : '≡ À jouer ensuite';
    showRatings(g.ratings ?? {});
    const hoursInput = $('#hours', view);
    if (document.activeElement !== hoursInput) hoursInput.value = g.playtimeMinutes != null ? Math.round((g.playtimeMinutes / 60) * 10) / 10 : '';
    const tro = $('#trophies', view);
    if (document.activeElement !== tro) tro.value = g.achievements?.percent ?? '';
    const from = PROVIDERS[g.playtimeSource] ?? PROVIDERS[g.achievements?.source];
    const sources = [
      PROVIDERS[g.playtimeSource] && `temps de jeu`,
      PROVIDERS[g.achievements?.source] && (g.achievements.total ? `succès ${g.achievements.unlocked}/${g.achievements.total}` : 'succès'),
    ].filter(Boolean);
    $('#progress-source', view).innerHTML = from
      ? `<span class="sync-note">Synchronisé avec ${esc(from)} : ${esc(sources.join(' et '))}${g.lastPlayedAt ? ` · dernière partie le ${esc(fmtDate(g.lastPlayedAt))}` : ''}</span>` : '';
    const ttb = g.timeToBeat;
    const played = (g.playtimeMinutes ?? 0) / 60;
    if (ttb?.normally) {
      const max = Math.max(ttb.completely ?? ttb.normally * 1.5, played, ttb.normally) * 1.05;
      $('#ttb', view).innerHTML = `
        <div class="ttb__bar"><i data-v="${Math.min(100, (played / max) * 100)}%"></i>
          <b style="--x:${(ttb.normally / max) * 100}%" title="Durée moyenne"></b>
          ${ttb.completely ? `<b class="is-full" style="--x:${(ttb.completely / max) * 100}%" title="100 %"></b>` : ''}</div>
        <div class="ttb__legend"><span>toi : ${fmtHours(g.playtimeMinutes ?? 0)}</span><span>moyenne ~${Math.round(ttb.normally)} h${ttb.completely ? ` · 100 % ~${Math.round(ttb.completely)} h` : ''}</span></div>`;
      animateCharts($('#ttb', view));
    }
    $('#started', view).value = g.startedAt ?? '';
    $('#finished', view).value = g.finishedAt ?? '';
  };

  refreshCard();
  refreshControls();
  $('#review', view).value = g.review ?? '';
  $('#saved', view).textContent = g.review ? 'Enregistré ✓' : '';
  attachHolo(view);
  setAmbient(g.images?.gridThumb || g.images?.cover);

  // Image du bandeau en HD dès qu'elle est téléchargée
  if (heroFull && heroFull !== heroPreview) {
    const img = new Image();
    img.onload = () => { const hero = $('.banner__hero', view); if (hero) hero.src = heroFull; };
    img.src = heroFull;
  }

  /* ----- Modifications ----- */

  // Sans droit de modifier : on propose la connexion (et on remet l'affichage)
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
      setSegmented($('[data-seg="status"]', view), next);
      if (['finished', 'completed'].includes(next)) {
        confetti();
        toast(next === 'completed' ? '★' : '✓', `${g.name} ${next === 'completed' ? 'à 100 %' : 'terminé'} !`, next === 'completed' ? '+250 XP' : '+100 XP', 5000, { color: STATUS[next].color });
      }
      // Un jeu jamais joué : le blister se déchire avant que la carte ne change
      const card = $('#big-card .tcg', view);
      if (was === 'backlog' && card?.dataset.tier === 'sealed') {
        card.classList.add('is-tearing');
        setTimeout(() => save({ status: next }), 900);
      } else save({ status: next });
      return;
    }
    if (e.target.closest('#fav') && guard()) { save({ favorite: !g.favorite }); return; }
    if (e.target.closest('#playlist') && guard()) {
      const was = state.playlist.includes(g.id);
      await togglePlaylist(g.id);
      refreshControls();
      toast('≡', was ? 'Retiré de ta liste « À jouer »' : 'Ajouté à ta liste « À jouer »', '', 4000, { action: { label: 'Annuler', onClick: () => togglePlaylist(g.id).then(refreshControls) } });
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
      toast('✕', `${g.name} retiré de ta collection`, TEST ? 'Mode test.' : '');
      location.hash = state.games.some((x) => x.platform === g.platform) ? target : '#/consoles';
      return;
    }
    if (e.target.closest('#replay')) { startTrailer(true); return; }
    const shot = e.target.closest('[data-shot]');
    if (shot) {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.innerHTML = `<img src="${esc(shot.dataset.shot)}" alt="">`;
      box.addEventListener('click', () => box.remove());
      document.body.append(box);
    }
  });

  // Notes : aperçu immédiat (pistes, radar) pendant le geste, enregistrement quand on lâche
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
        const pill = $('#console-pill', view);
        const meta = platformMeta(g.platform);
        Object.assign(pill, { href: consoleHref(g.platform), textContent: meta.short });
        pill.style.setProperty('--pc', meta.color);
        e.target.value = '';
        if (g.platform === to) toast('⇄', `${g.name} rangé dans ${meta.short}`);
      });
    }
  });

  // Avis : « Enregistrement… » à la frappe, « Enregistré ✓ » 800 ms après la dernière touche
  const saveReview = debounce(async (value) => {
    await updateGame(g.id, { review: value });
    const saved = $('#saved', view);
    if (!saved) return;
    saved.textContent = 'Enregistré ✓';
    saved.classList.add('is-on');
  }, 800);
  $('#review', view).addEventListener('input', (e) => {
    if (!guard()) return;
    const saved = $('#saved', view);
    saved.textContent = 'Enregistrement…';
    saved.classList.remove('is-on');
    saveReview(e.target.value);
  });

  // Jeux similaires (IGDB)
  if (g.igdbId) {
    fetchDiscover([g.igdbId], knownIgdbIds()).then((list) => {
      const box = $('#similar', view);
      if (!box || !list.length) return;
      box.innerHTML = `${sectionHead('Si tu as aimé, essaie aussi', '<span class="note">+ ajoute à tes envies</span>')}<div class="covers">${list.slice(0, 12).map((s, i) => miniCover(s, { i, flag: s.genres?.[0] ?? '' })).join('')}</div>`;
    }).catch(() => {});
    bindStubs(view);
  }

  // Modification refusée par le serveur (valeurs remises en place) : on redessine
  const unsubscribe = onChange((e) => {
    if (e.detail.type === 'game' && e.detail.id === g.id) { refreshCard(); refreshControls(); }
  });

  // Bande-annonce : zoom sur l'image, puis la vidéo dessous, qui s'ouvre en diaphragme
  let trailer = null;
  function startTrailer(again = false) {
    if (!withTrailer) return;
    trailer?.stop();
    const banner = $('.banner', view);
    const zoom = $('.banner__zoom', view);
    if (again) {
      banner.classList.remove('is-opening');
      zoom.style.animation = 'none';
      void zoom.offsetWidth;
      zoom.style.animation = '';
    }
    trailer = createTrailer($('.banner__cover', view), g, { soundParent: $('.banner__tools', view) });
  }
  startTrailer();
  return () => { trailer?.stop(); unsubscribe(); };
}
