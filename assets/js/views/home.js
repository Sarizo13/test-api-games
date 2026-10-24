// Accueil : bonjour + niveau, 7 chiffres animés, suggestion du jour (carte sous blister), en cours,
// actualité IGDB, graphiques, profil de joueur et badges.

import { PLATFORMS, platformMeta } from '../../platforms.js';
import { state, fetchToday, updateGame } from '../state.js';
import { requireEdit } from '../add.js';
import { cardHtml, cardStats, attachHolo, ratingAverage, STATUS, TIERS } from '../card.js';
import { statusDonut, bars, animateCharts } from '../charts.js';
import { playerProfile, PROFILE_MIN } from '../taste.js';
import { playerLevel } from '../level.js';
import { badges } from '../badges.js';
import { sectionHead, emptyState, miniCover, rememberStub, bindStubs, thumb } from './common.js';
import { $, esc, safeUrl, cssUrl, fmtDate, fmtHours, countUp, avg, sum, setAmbient, countdown } from '../util.js';

/** Un jeu jamais joué, différent chaque jour (le même toute la journée). */
export function pickOfTheDay(games) {
  const backlog = games.filter((g) => g.status === 'backlog');
  if (!backlog.length) return null;
  const day = Math.floor(Date.now() / 86400000);
  // Les jeux de la liste « à jouer » et les mieux notés par IGDB ont plus de chances d'être tirés
  const weighted = backlog.flatMap((g) => Array(1 + (state.playlist.includes(g.id) ? 2 : 0) + ((g.igdbRating ?? 0) > 85 ? 1 : 0)).fill(g));
  return weighted[(day * 2654435761) % weighted.length];
}

const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export function renderHome(view) {
  const games = state.games;
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const name = state.settings.name;
  const consoles = new Set(games.map((g) => g.platform));
  const lvl = playerLevel(games);

  const played = games.filter((g) => g.status !== 'backlog');
  const done = games.filter((g) => ['finished', 'completed'].includes(g.status));
  const hours = sum(games.map((g) => g.playtimeMinutes ?? 0)) / 60;
  const ratings = games.map(ratingAverage).filter((r) => r != null);
  const trophies = games.map((g) => g.achievements?.percent).filter((v) => v != null);
  const backlogHours = sum(games.filter((g) => g.status === 'backlog').map((g) => g.timeToBeat?.normally ?? 0));

  const spotlight = pickOfTheDay(games);
  const playing = games.filter((g) => g.status === 'playing')
    .sort((a, b) => (b.lastPlayedAt ?? b.startedAt ?? '').localeCompare(a.lastPlayedAt ?? a.startedAt ?? ''));
  const next = state.playlist.map((id) => games.find((g) => g.id === id)).filter((g) => g && g.status !== 'playing');
  const now = [...playing.slice(0, 4), ...next.slice(0, Math.max(0, 4 - playing.length))];
  const profile = playerProfile(games);
  const medals = badges(games);
  const short = [...consoles].map((p) => platformMeta(p).short).slice(0, 3).join(', ');

  view.innerHTML = `
    <section class="hello">
      <div>
        <span class="eyebrow">${esc(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase()))}</span>
        <h1 class="h-hero">${greet}${name ? `, <span class="accent">${esc(name)}</span>` : ''}</h1>
        <p>${games.length
          ? `${plural(games.length, 'jeu', 'jeux')} sur ${plural(consoles.size, 'console')}, ${played.length} déjà lancé${played.length > 1 ? 's' : ''}.`
          : 'Ta collection est vide pour l\'instant : ajoute ton premier jeu, il deviendra ta première carte.'}</p>
      </div>
      <a class="xp-chip" href="#/profil" title="Ton niveau de joueur">
        <b>Niv. ${lvl.level}</b><span class="xpbar"><i style="--v:${lvl.pct}%"></i></span><span>${lvl.xp}/${lvl.need} XP</span>
      </a>
    </section>

    ${games.length ? `
    <section class="stats">
      ${[
        { label: 'jeux', value: games.length, sub: 'dans ta collection' },
        { label: 'consoles', value: consoles.size, sub: short },
        { label: 'heures de jeu', value: Math.round(hours), sub: 'au total' },
        { label: 'terminés', value: done.length, sub: played.length ? `${Math.round((done.length / played.length) * 100)} % des jeux lancés` : '' },
        { label: 'note moyenne', value: ratings.length ? avg(ratings) : 0, decimals: 1, suffix: '/10', sub: plural(ratings.length, 'jeu noté', 'jeux notés') },
        { label: 'pile de la honte', value: Math.round(backlogHours), suffix: ' h', sub: 'pour finir les jamais lancés' },
        { label: 'trophées', value: trophies.length ? avg(trophies) : 0, suffix: ' %', sub: 'en moyenne' },
      ].map((s, i) => `
        <div class="stat" style="--i:${i}">
          <span class="stat__value" data-count="${s.value}" data-decimals="${s.decimals ?? 0}" data-suffix="${esc(s.suffix ?? '')}">0</span>
          <span class="stat__label">${s.label}</span>
          ${s.sub ? `<span class="stat__sub">${esc(s.sub)}</span>` : ''}
        </div>`).join('')}
    </section>` : ''}

    <section class="home-grid">
      <div class="section">
        ${sectionHead('Suggestion du jour', '<a href="#/decouvrir">Découvrir →</a>')}
        ${spotlight ? `
          <div class="spotlight">
            <div class="spotlight__bg" style="background-image:${cssUrl(spotlight.images?.heroThumb || spotlight.images?.hero || spotlight.images?.gridThumb)}"></div>
            ${cardHtml(spotlight)}
            <div class="spotlight__text">
              <span class="eyebrow">Jamais joué · tiré au sort</span>
              <h3 class="spotlight__name">${esc(spotlight.name)}</h3>
              <div class="row">
                <span class="pill-console" style="--pc:${platformMeta(spotlight.platform).color}">${esc(platformMeta(spotlight.platform).short)}${spotlight.releaseDate ? ` · ${spotlight.releaseDate.slice(0, 4)}` : ''}</span>
                ${spotlight.timeToBeat?.normally ? `<span class="tag">~${Math.round(spotlight.timeToBeat.normally)} h</span>` : ''}
                ${spotlight.igdbRating ? `<span class="tag">★ ${spotlight.igdbRating} IGDB</span>` : ''}
              </div>
              ${spotlight.summary ? `<p>${esc(spotlight.summary)}</p>` : ''}
              <div class="actions">
                <button class="btn btn--primary" type="button" data-start="${esc(spotlight.id)}" data-edit>▶ Je m'y mets</button>
                <a class="btn" href="#/jeu/${encodeURIComponent(spotlight.id)}">Voir la fiche</a>
              </div>
            </div>
          </div>`
        : emptyState(games.length ? '🏆' : '🃏', games.length ? 'Aucun jeu jamais joué' : 'Ta collection est vide',
          games.length ? 'Tu as lancé tous les jeux de ta collection. Respect.' : 'Ajoute ton premier jeu : il deviendra ta première carte, sous blister.',
          games.length ? '' : '<button class="btn btn--primary" type="button" data-action="add" data-edit>+ Ajouter un jeu</button><a class="btn" href="#/comptes">Importer mes jeux</a>')}
      </div>
      <div class="section">
        ${sectionHead('En cours', '<a href="#/a-jouer">Ma liste →</a>')}
        <div class="now-list">
          ${now.map((g) => {
            const s = cardStats(g);
            const ttb = g.timeToBeat?.normally;
            const pct = ttb && g.playtimeMinutes ? Math.min(100, Math.round((g.playtimeMinutes / 60 / ttb) * 100)) : null;
            return `
              <a class="now" href="#/jeu/${encodeURIComponent(g.id)}">
                ${thumb(g)}
                <span class="now__text">
                  <strong>${esc(g.name)}</strong>
                  <small>${g.status === 'playing'
                    ? `<span class="status" data-s="playing">${STATUS.playing.icon} En cours</span> · ${esc(platformMeta(g.platform).short)} · ${fmtHours(g.playtimeMinutes)}${ttb ? ` sur ~${Math.round(ttb)} h` : ''}`
                    : `≡ Prochain dans ta liste · ${esc(platformMeta(g.platform).short)}`}</small>
                  ${pct != null ? `<span class="bar"><i data-v="${pct}%"></i></span>` : ''}
                </span>
                <span class="power-dot" style="--power:${s.tier === 'sealed' ? 0 : s.power}%;--tc:${TIERS[s.tier].color}"><b>${s.tier === 'sealed' ? '?' : s.power}</b></span>
              </a>`;
          }).join('') || emptyState('▶', 'Rien en cours', 'Lance un jeu de ta collection ou ajoute-en à ta liste « À jouer ».')}
        </div>
      </div>
    </section>

    <section class="section">
      ${sectionHead('Aujourd\'hui dans le jeu vidéo', '<span class="note">données IGDB</span>')}
      <div class="news" id="news">
        ${['Sorties récentes', 'À venir', 'Ce jour-là'].map((t) => `<div class="tile"><h3 class="tile__title">${t}</h3><div class="skeleton" style="height:220px"></div></div>`).join('')}
      </div>
    </section>

    ${games.length ? `
      <section class="section">
        ${sectionHead('Ta collection en chiffres')}
        <div class="charts">
          <div class="tile"><h3 class="tile__title">Par statut</h3>${statusDonut(Object.fromEntries(Object.keys(STATUS).map((k) => [k, games.filter((g) => g.status === k).length])))}</div>
          <div class="tile"><h3 class="tile__title">Par console</h3>${bars(PLATFORMS.filter((p) => consoles.has(p.id)).map((p) => ({ label: p.short, value: games.filter((g) => g.platform === p.id).length, color: p.color })).sort((a, b) => b.value - a.value).slice(0, 7))}</div>
          <div class="tile"><h3 class="tile__title">Genres préférés</h3>${genreBars(games)}</div>
          <div class="tile"><h3 class="tile__title">Raretés</h3>${bars(Object.entries(TIERS).map(([k, t]) => ({ label: t.label, value: games.filter((g) => cardStats(g).tier === k).length, color: t.color })).filter((x) => x.value))}</div>
        </div>
      </section>` : ''}

    <section class="section">
      ${sectionHead('Ton profil de joueur', '<a href="#/profil">Voir le profil →</a>')}
      ${profile.locked ? `
        <div class="tile" style="display:flex;flex-direction:column;gap:12px">
          <div class="row"><span style="font-size:22px">🔒</span><strong class="tile__title">Encore ${plural(profile.missing, 'jeu', 'jeux')}</strong></div>
          <span class="muted">Ton archétype, tes traits et « Pour toi » se débloquent à ${PROFILE_MIN} jeux.</span>
          <div class="xpbar"><i style="--v:${(profile.count / PROFILE_MIN) * 100}%"></i></div>
          <span class="muted-2 mono" style="font-size:12px">${profile.count} / ${PROFILE_MIN} jeux</span>
        </div>` : `
        <a class="tile archetype" href="#/profil">
          <span class="archetype__emoji">${profile.archetype.emoji}</span>
          <span><span class="eyebrow">Ton archétype</span><h2>${esc(profile.archetype.name)}</h2>
          <span class="muted">${profile.topGenres.slice(0, 3).map((g) => `${esc(g.key)} ${g.pct} %`).join(' · ')}</span></span>
        </a>`}
    </section>

    ${games.length ? `
      <section class="section">
        ${sectionHead('Badges', `<span class="note">${medals.filter((m) => m.unlocked).length} / ${medals.length}</span>`)}
        <div class="badges">
          ${medals.filter((m) => m.unlocked).slice(-6).map((m) => `<div class="badge"><div class="badge__medal">${m.emoji}</div><div class="badge__name">${esc(m.name)}</div><small>${esc(m.text)}</small></div>`).join('')
            || '<p class="muted">Aucun badge pour l\'instant : ajoute, joue et termine des jeux.</p>'}
        </div>
      </section>` : ''}`;

  view.querySelectorAll('[data-count]').forEach((el) => countUp(el, Number(el.dataset.count), { decimals: Number(el.dataset.decimals), suffix: el.dataset.suffix }));
  animateCharts(view);
  attachHolo(view);
  bindStubs(view);
  if (spotlight) setAmbient(spotlight.images?.gridThumb || spotlight.images?.cover);
  else setAmbient(null);

  // « Je m'y mets » : la carte du jour se déballe (même geste qu'un clic sur la carte sous blister)
  view.addEventListener('click', (e) => {
    const start = e.target.closest('[data-start]');
    if (!start) return;
    const card = view.querySelector(`.tcg[data-id="${CSS.escape(start.dataset.start)}"]`);
    if (card?.dataset.tier === 'sealed') { card.click(); return; }
    requireEdit(async () => {
      await updateGame(start.dataset.start, { status: 'playing' });
      location.hash = `#/jeu/${encodeURIComponent(start.dataset.start)}`;
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
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return top.length ? bars(top.map(([label, value]) => ({ label, value }))) : '<p class="muted">Pas encore de genres.</p>';
}

function renderNews(view, feed) {
  const news = $('#news', view);
  if (!news) return;
  // Jeux de ta collection sortis un jour comme aujourd'hui
  const md = new Date().toISOString().slice(5, 10);
  const birthdays = state.games.filter((g) => g.releaseDate?.slice(5, 10) === md);
  [...feed.upcoming, ...feed.onThisDay].forEach(rememberStub);
  const row = (s, date, title, sub) => `
    <div class="upcoming__row" data-stub="${s.igdbId}" title="${esc(s.name)}">
      <span class="upcoming__date">${date}</span>
      ${safeUrl(s.cover) ? `<img class="thumb--sm" src="${esc(s.cover)}" alt="" loading="lazy">` : '<span class="thumb--sm"></span>'}
      <span style="min-width:0"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span>
    </div>`;
  news.innerHTML = `
    <div class="tile">
      <h3 class="tile__title">Sorties récentes</h3>
      <div class="covers">${feed.recent.map((s, i) => miniCover(s, { i, flag: fmtDate(s.releaseDate, { day: 'numeric', month: 'short' }) })).join('') || '<p class="muted">Rien de marquant cette semaine.</p>'}</div>
    </div>
    <div class="tile">
      <h3 class="tile__title">À venir</h3>
      <div class="upcoming">${feed.upcoming.slice(0, 6).map((s) => {
        const d = new Date(`${s.releaseDate}T00:00:00`);
        return row(s, `${d.getDate()}<small>${esc(d.toLocaleDateString('fr-FR', { month: 'short' }))}</small>`, s.name, `${countdown(s.releaseDate)} · ${s.platforms.slice(0, 3).map((p) => platformMeta(p).short).join(', ')}`);
      }).join('') || '<p class="muted">Aucune grosse sortie annoncée.</p>'}</div>
    </div>
    <div class="tile">
      <h3 class="tile__title">Ce jour-là</h3>
      <div class="upcoming">
        ${birthdays.map((g) => `
          <a class="upcoming__row" href="#/jeu/${encodeURIComponent(g.id)}">
            <span class="upcoming__date">🎂</span>${thumb(g, 'thumb--sm')}
            <span style="min-width:0"><strong>${esc(g.name)}</strong><small>${new Date().getFullYear() - Number(g.releaseDate.slice(0, 4))} ans · dans ta collection</small></span>
          </a>`).join('')}
        ${feed.onThisDay.map((s) => row(s, `${s.yearsAgo}<small>an${s.yearsAgo > 1 ? 's' : ''}</small>`, s.name, `sorti il y a ${s.yearsAgo} an${s.yearsAgo > 1 ? 's' : ''}`)).join('')
          || (birthdays.length ? '' : '<p class="muted">Rien de notable à cette date.</p>')}
      </div>
    </div>`;
}
