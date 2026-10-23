// Accueil : bonjour, statistiques, suggestion du jour, parties en cours, actualité, graphiques, badges.

import { PLATFORMS, platformMeta } from '../../platforms.js';
import { state, fetchToday, updateGame } from '../state.js';
import { cardHtml, cardStats, attachHolo, ratingAverage, STATUS, TIERS, gameLine } from '../card.js';
import { donut, bars, animateCharts } from '../charts.js';
import { playerProfile, PROFILE_MIN } from '../taste.js';
import { badges } from '../badges.js';
import { requireEdit } from '../add.js';
import { sectionHead, emptyState, miniCover, bindStubs, thumb } from './common.js';
import { $, esc, safeUrl, cssUrl, fmtDate, fmtHours, countUp, avg, sum, setAmbient, confetti, countdown } from '../util.js';

/** Un jeu jamais joué, différent chaque jour (le même toute la journée). */
export function pickOfTheDay(games) {
  const backlog = games.filter((g) => g.status === 'backlog');
  if (!backlog.length) return null;
  const day = Math.floor(Date.now() / 86400000);
  // Les jeux de la liste « à jouer » et les mieux notés par IGDB ont plus de chances d'être tirés
  const weighted = backlog.flatMap((g) => Array(1 + (state.playlist.includes(g.id) ? 2 : 0) + ((g.igdbRating ?? 0) > 85 ? 1 : 0)).fill(g));
  return weighted[(day * 2654435761) % weighted.length];
}

export function renderHome(view) {
  const games = state.games;
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const name = state.settings.name;
  const consoles = new Set(games.map((g) => g.platform));

  const played = games.filter((g) => g.status !== 'backlog');
  const done = games.filter((g) => ['finished', 'completed'].includes(g.status));
  const hours = sum(games.map((g) => g.playtimeMinutes ?? 0)) / 60;
  const ratings = games.map(ratingAverage).filter((r) => r != null);
  const trophies = games.map((g) => g.achievements?.percent).filter((v) => v != null);
  const backlogHours = sum(games.filter((g) => g.status === 'backlog').map((g) => g.timeToBeat?.normally ?? 0));

  const spotlight = pickOfTheDay(games);
  const playing = games.filter((g) => g.status === 'playing')
    .sort((a, b) => (b.lastPlayedAt ?? b.startedAt ?? '').localeCompare(a.lastPlayedAt ?? a.startedAt ?? ''));
  const next = state.playlist.map((id) => games.find((g) => g.id === id)).filter((g) => g && g.status !== 'playing').slice(0, 3);
  const profile = playerProfile(games);
  const medals = badges(games);

  view.innerHTML = `
    <section class="hello">
      <div>
        <p class="kicker">${esc(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
        <h1>${greet}${name ? `, <span>${esc(name)}</span>` : ''}</h1>
        <p>${games.length
          ? `${games.length} jeu${games.length > 1 ? 'x' : ''} sur ${consoles.size} console${consoles.size > 1 ? 's' : ''}, ${played.length} déjà lancé${played.length > 1 ? 's' : ''}.`
          : 'Ta collection est vide pour l\'instant : ajoute ton premier jeu pour commencer.'}</p>
      </div>
      <div class="hello-actions">
        <button class="btn btn-primary" type="button" data-action="add">${'＋'} Ajouter un jeu</button>
      </div>
    </section>

    ${games.length ? `
    <section class="stats">
      ${[
        { label: 'jeux', value: games.length, c: '#8b5cf6' },
        { label: 'consoles', value: consoles.size, c: '#22d3ee' },
        { label: 'heures de jeu', value: Math.round(hours), c: '#f472b6' },
        { label: 'terminés', value: done.length, sub: played.length ? `${Math.round((done.length / played.length) * 100)} % des jeux lancés` : '', c: '#34d399' },
        { label: 'note moyenne', value: ratings.length ? avg(ratings) : 0, decimals: 1, suffix: '/10', c: '#fbbf24', sub: `${ratings.length} jeu${ratings.length > 1 ? 'x' : ''} noté${ratings.length > 1 ? 's' : ''}` },
        { label: 'pile de la honte', value: Math.round(backlogHours), suffix: ' h', c: '#fb7185', sub: 'pour finir tes jeux jamais lancés' },
        trophies.length && { label: 'trophées (moyenne)', value: avg(trophies), suffix: ' %', c: '#a3e635' },
      ].filter(Boolean).map((s, i) => `
        <div class="stat" style="--i:${i};--c:${s.c}">
          <span class="stat-value" data-count="${s.value}" data-decimals="${s.decimals ?? 0}" data-suffix="${esc(s.suffix ?? '')}">0</span>
          <span class="stat-label">${s.label}</span>
          ${s.sub ? `<span class="stat-sub">${esc(s.sub)}</span>` : ''}
        </div>`).join('')}
    </section>` : ''}

    <section class="home-grid">
      <div>
        ${sectionHead('Suggestion du jour', '<a href="#/decouvrir">Découvrir →</a>')}
        ${spotlight ? `
          <div class="spotlight">
            <div class="spotlight-bg" style="background-image:${cssUrl(spotlight.images?.heroThumb || spotlight.images?.hero)}"></div>
            <div class="cards" style="--card:100%">${cardHtml(spotlight)}</div>
            <div>
              <p class="kicker">Jamais joué · tiré au sort pour aujourd'hui</p>
              <h3>${esc(spotlight.name)}</h3>
              <div class="meta"><span class="badge" style="--c:${platformMeta(spotlight.platform).color}">${esc(platformMeta(spotlight.platform).short)}</span>
                ${spotlight.timeToBeat?.normally ? `<span>⏱ ~${Math.round(spotlight.timeToBeat.normally)} h pour le finir</span>` : ''}
                ${spotlight.igdbRating ? `<span>★ ${spotlight.igdbRating}/100 sur IGDB</span>` : ''}</div>
              <p>${esc(spotlight.summary ?? '')}</p>
              <div class="actions">
                <button class="btn btn-primary" type="button" data-start="${esc(spotlight.id)}">${'▶'} Je m'y mets</button>
                <a class="btn btn-ghost" href="#/jeu/${encodeURIComponent(spotlight.id)}">Voir la fiche</a>
              </div>
            </div>
          </div>`
        : emptyState(games.length ? '🏆' : '🕹️', games.length ? 'Aucun jeu jamais joué' : 'Rien à suggérer… pour l\'instant',
          games.length ? 'Tu as lancé tous les jeux de ta collection. Respect.' : 'Ajoute des jeux à ta collection : chaque jour, l\'un de ceux auxquels tu n\'as jamais joué sera mis en avant ici.',
          games.length ? '' : '<button class="btn btn-primary" type="button" data-action="add">Ajouter un jeu</button>')}
      </div>
      <div>
        ${sectionHead('En cours', '<a href="#/a-jouer">Ma liste →</a>')}
        <div class="now-list">
          ${[...playing.slice(0, 4), ...next.slice(0, Math.max(0, 4 - playing.length))].map((g, i) => {
            const s = cardStats(g);
            const ttb = g.timeToBeat?.normally;
            const pct = ttb && g.playtimeMinutes ? Math.min(100, Math.round((g.playtimeMinutes / 60 / ttb) * 100)) : null;
            return `
              <a class="now-item" href="#/jeu/${encodeURIComponent(g.id)}" style="--i:${i}">
                ${thumb(g)}
                <div>
                  <strong>${esc(g.name)}</strong>
                  <small>${g.status === 'playing' ? `${STATUS.playing.icon} En cours · ${fmtHours(g.playtimeMinutes)}` : '📋 Prochain dans ta liste'} · ${esc(platformMeta(g.platform).short)}</small>
                  ${pct != null ? `<div class="progress" title="${pct} % de la durée moyenne"><span data-p="${pct}%" style="--c:${TIERS[s.tier].color}"></span></div>` : ''}
                </div>
                <span class="badge" style="--c:${TIERS[s.tier].color}">${s.tier === 'sealed' ? '?' : s.power}</span>
              </a>`;
          }).join('') || emptyState('🎯', 'Rien en cours', 'Lance un jeu de ta collection ou ajoute-en à ta liste « à jouer ».')}
        </div>
      </div>
    </section>

    ${sectionHead('Aujourd\'hui dans le jeu vidéo', '<span class="muted" style="font-size:12px">Données IGDB</span>')}
    <section class="news" id="news">
      <div class="panel"><h3>Sorties récentes</h3><div class="scroller shimmer" style="height:240px;border-radius:14px"></div></div>
      <div class="panel"><h3>À venir</h3><div class="shimmer" style="height:240px;border-radius:14px"></div></div>
      <div class="panel"><h3>Ce jour-là</h3><div class="shimmer" style="height:240px;border-radius:14px"></div></div>
    </section>

    ${games.length ? `
      ${sectionHead('Ta collection en chiffres')}
      <section class="charts">
        <div class="panel"><h3>Par statut</h3>${donut(Object.entries(STATUS).map(([k, s]) => ({ label: s.label, value: games.filter((g) => g.status === k).length, color: s.color })), { center: String(games.length), sub: 'jeux' })}</div>
        <div class="panel"><h3>Par console</h3>${bars(PLATFORMS.filter((p) => consoles.has(p.id)).map((p) => ({ label: p.short, value: games.filter((g) => g.platform === p.id).length, color: p.color })).sort((a, b) => b.value - a.value).slice(0, 7))}</div>
        <div class="panel"><h3>Genres préférés</h3>${genreBars(games)}</div>
        <div class="panel"><h3>Raretés de tes cartes</h3>${bars(Object.entries(TIERS).map(([k, t]) => ({ label: t.label, value: games.filter((g) => cardStats(g).tier === k).length, color: t.color })).filter((x) => x.value))}</div>
      </section>` : ''}

    ${sectionHead('Ton profil de joueur', '<a href="#/profil">Voir le profil →</a>')}
    <section class="section">
      ${profile.locked ? `
        <div class="panel" style="display:grid;gap:12px">
          <strong>🔒 Profil débloqué à ${PROFILE_MIN} jeux</strong>
          <span class="muted">Encore ${profile.missing} jeu${profile.missing > 1 ? 'x' : ''} et Asobi saura quel genre de joueur tu es, avec des suggestions « Pour toi ».</span>
          <div class="progress"><span data-p="${(profile.count / PROFILE_MIN) * 100}%"></span></div>
        </div>` : `
        <a class="panel" href="#/profil" style="display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center">
          <span style="font-size:52px">${profile.archetype.emoji}</span>
          <span><span class="kicker">Ton archétype</span><br><strong style="font:700 22px var(--font-display)">${esc(profile.archetype.name)}</strong><br>
          <span class="muted">${profile.topGenres.slice(0, 3).map((g) => `${esc(g.key)} ${g.pct} %`).join(' · ')}</span></span>
        </a>`}
    </section>

    ${games.length ? `
      ${sectionHead('Badges', `<span class="muted" style="font-size:13px">${medals.filter((m) => m.unlocked).length} / ${medals.length}</span>`)}
      <section class="badges section">
        ${medals.filter((m) => m.unlocked).slice(-6).map((m) => `<div class="medal"><span class="medal-icon">${m.emoji}</span><strong>${esc(m.name)}</strong><small>${esc(m.text)}</small></div>`).join('')
          || '<p class="muted">Aucun badge pour l\'instant.</p>'}
      </section>` : ''}`;

  view.querySelectorAll('[data-count]').forEach((el) => countUp(el, Number(el.dataset.count), { decimals: Number(el.dataset.decimals), suffix: el.dataset.suffix }));
  animateCharts(view);
  attachHolo(view);
  bindStubs(view);
  if (spotlight) setAmbient(spotlight.images?.gridThumb || spotlight.images?.cover);

  view.addEventListener('click', (e) => {
    const start = e.target.closest('[data-start]');
    if (!start) return;
    requireEdit(async () => {
      const card = view.querySelector(`.tcg[data-id="${CSS.escape(start.dataset.start)}"]`);
      card?.classList.add('is-unwrapping'); // le blister s'arrache
      const r = start.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top);
      await updateGame(start.dataset.start, { status: 'playing' });
      setTimeout(() => { location.hash = `#/jeu/${encodeURIComponent(start.dataset.start)}`; }, 700);
    });
  });

  fetchToday().then((feed) => renderNews(view, feed)).catch(() => {
    const news = $('#news', view);
    if (news) news.innerHTML = '<p class="muted">L\'actualité IGDB est indisponible pour le moment.</p>';
  });
}

function genreBars(games) {
  const counts = new Map();
  for (const g of games) for (const genre of g.genres ?? []) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  const colors = ['#8b5cf6', '#22d3ee', '#f472b6', '#fbbf24', '#34d399', '#fb7185'];
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return top.length ? bars(top.map(([label, value], i) => ({ label, value, color: colors[i] }))) : '<p class="muted">Pas encore de genres.</p>';
}

function renderNews(view, feed) {
  const news = $('#news', view);
  if (!news) return;
  // Jeux de ta collection sortis un jour comme aujourd'hui
  const md = new Date().toISOString().slice(5, 10);
  const birthdays = state.games.filter((g) => g.releaseDate?.slice(5, 10) === md);
  news.innerHTML = `
    <div class="panel">
      <h3>Sorties récentes</h3>
      <div class="scroller" style="--col:128px">${feed.recent.map((s, i) => miniCover(s, { i, flag: fmtDate(s.releaseDate, { day: 'numeric', month: 'short' }) })).join('') || '<p class="muted">Rien de marquant cette semaine.</p>'}</div>
    </div>
    <div class="panel">
      <h3>À venir</h3>
      <div class="upcoming">${feed.upcoming.slice(0, 6).map((s) => {
        const d = new Date(`${s.releaseDate}T00:00:00`);
        return `
          <div class="up-item mini-cover" data-stub="${s.igdbId}" style="display:grid">
            <div class="up-date"><div><b>${d.getDate()}</b><br><small>${esc(d.toLocaleDateString('fr-FR', { month: 'short' }))}</small></div></div>
            ${safeUrl(s.cover) ? `<img src="${esc(s.cover)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
            <div><strong>${esc(s.name)}</strong><small>${esc(countdown(s.releaseDate))} · ${esc(s.platforms.slice(0, 3).map((p) => platformMeta(p).short).join(', '))}</small></div>
          </div>`;
      }).join('') || '<p class="muted">Aucune grosse sortie annoncée.</p>'}</div>
    </div>
    <div class="panel">
      <h3>Ce jour-là</h3>
      <div class="timeline">
        ${birthdays.map((g) => `
          <a class="tl-item" href="#/jeu/${encodeURIComponent(g.id)}">${thumb(g)}<div><b>🎂 ${new Date().getFullYear() - Number(g.releaseDate.slice(0, 4))} ans · dans ta collection</b><strong>${esc(g.name)}</strong></div></a>`).join('')}
        ${feed.onThisDay.map((s) => `
          <div class="tl-item mini-cover" data-stub="${s.igdbId}" style="display:grid">${safeUrl(s.cover) ? `<img src="${esc(s.cover)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
            <div><b>Il y a ${s.yearsAgo} an${s.yearsAgo > 1 ? 's' : ''}</b><strong>${esc(s.name)}</strong></div></div>`).join('')
          || (birthdays.length ? '' : '<p class="muted">Rien de notable à cette date.</p>')}
      </div>
    </div>`;
  // Les stubs des listes « À venir » et « Ce jour-là » passent aussi par miniCover pour être cliquables
  feed.upcoming.concat(feed.onThisDay).forEach((s) => miniCover(s));
}
