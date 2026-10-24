// Amis et duel. Un ami = le pseudo (ou le lien /u/<pseudo>) d'un autre utilisateur d'Asobi au profil public :
// sa collection se lit en lecture seule. Compatibilité = recouvrement des genres (70 %) + jeux en commun (30 %).
// Duel : chiffres face à face, cartes en commun (♛ sur la plus puissante), envies communes, « il les a, pas toi », genres.

import { platformMeta } from '../../platforms.js';
import { state, get, saveSettings, onChange } from '../state.js';
import { cardHtml, cardStats, ratingAverage, attachHolo } from '../card.js';
import { playerLevel } from '../level.js';
import { playerProfile } from '../taste.js';
import { badges } from '../badges.js';
import { requireEdit } from '../add.js';
import { pageHead, sectionHead, emptyState, thumb, miniCover, bindStubs } from './common.js';
import { $, esc, safeUrl, cssUrl, fmtHours, daysUntil, fmtDate, toast, sum, avg } from '../util.js';

/* ---------- Données des amis (profils publics, gardés une minute) ---------- */

const cache = new Map();
async function friendData(name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const data = await get(`/users/${encodeURIComponent(name)}`).catch((err) => ({ error: err.status === 404 ? 'private' : 'down', message: err.message }));
  cache.set(name, { at: Date.now(), data });
  return data;
}

/** « https://asobi.sarizo.fr/u/kaito », « /u/kaito » ou « kaito » → « kaito ». */
export function friendName(input) {
  const raw = String(input ?? '').trim();
  const fromUrl = raw.match(/\/u\/([\w.]{1,32})\/?(?:[#?].*)?$/)?.[1];
  const name = (fromUrl ?? raw).toLowerCase();
  return /^[a-z0-9_.]{1,32}$/.test(name) ? name : null;
}

/* ---------- Comparaisons ---------- */

function genreShares(games) {
  const counts = new Map();
  for (const g of games) for (const genre of g.genres ?? []) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  const total = sum([...counts.values()]) || 1;
  return new Map([...counts].map(([k, v]) => [k, v / total]));
}

export function compatibility(mine, theirs) {
  if (!mine.length || !theirs.length) return 0;
  const a = genreShares(mine);
  const b = genreShares(theirs);
  const overlap = sum([...a.keys()].map((k) => Math.min(a.get(k), b.get(k) ?? 0)));
  const ids = new Set(mine.map((g) => g.igdbId).filter(Boolean));
  const common = new Set(theirs.map((g) => g.igdbId).filter((id) => id && ids.has(id))).size;
  const shared = Math.min(1, (common / Math.max(1, Math.min(mine.length, theirs.length))) * 2);
  return Math.round((overlap * 0.7 + shared * 0.3) * 100);
}

const commonIds = (mine, theirs) => {
  const ids = new Set(mine.map((g) => g.igdbId).filter(Boolean));
  return [...new Set(theirs.map((g) => g.igdbId).filter((id) => id && ids.has(id)))];
};
const mythics = (games) => games.filter((g) => ['mythic', 'perfect'].includes(cardStats(g).tier)).length;
const nameOf = (data, fallback) => data.settings?.name || data.user?.displayName || fallback;

function avatarRing(user, label, lvl) {
  const initial = esc((label[0] ?? '?').toUpperCase());
  return `<span class="avatar-ring" style="--xp:${lvl.pct}%;--rc:${lvl.rank.color}"><span>${safeUrl(user?.avatarUrl) ? `<img src="${esc(user.avatarUrl)}" alt="">` : initial}</span><em>Niv. ${lvl.level}</em></span>`;
}

const ago = (iso) => {
  const days = -daysUntil(String(iso).slice(0, 10));
  if (days <= 0) return 'aujourd\'hui';
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} j`;
  return `le ${fmtDate(iso, { day: 'numeric', month: 'short' })}`;
};

/* ---------- Liste des amis ---------- */

export function renderFriends(view) {
  const me = state.user;
  const friends = state.settings.friends ?? [];
  view.innerHTML = `
    ${pageHead('Social', 'Mes amis', '', 'Compare vos cartes, vos envies et vos goûts.', `
      <div class="field" style="width:min(460px,100%)">
        <span class="field__label">Ajouter un ami</span>
        <form class="add-friend" id="add-friend"><input class="input" id="friend-input" placeholder="Lien de son Asobi ou code ami" autocomplete="off" aria-label="Lien ou code ami"><button class="btn btn--primary" type="submit">Ajouter</button></form>
        <span class="field__hint">${me?.profilePublic
          ? `Ton code ami : <b class="mono">${esc(me.username)}</b> · <button class="btn--link accent" type="button" id="copy-code" style="background:none;border:0;padding:0;cursor:pointer;font:inherit">copier le lien</button>`
          : 'Ton profil est privé : tes amis ne peuvent pas te comparer. <a class="accent" href="#/profil">Le rendre public</a>'}</span>
      </div>`)}
    ${friends.length ? `
      <div class="grid-3" id="friends">${friends.map(() => '<div class="skeleton" style="height:340px;border-radius:24px"></div>').join('')}</div>
      <section class="section">${sectionHead('Activité de tes amis')}<div class="activity" id="activity"><div class="skeleton" style="height:60px"></div></div></section>`
    : emptyState('👥', 'Pas encore d\'amis', 'Ajoute un ami avec le lien de son Asobi (ou son code ami) : vous pourrez comparer vos collections. Son profil doit être public.')}`;

  const draw = async () => {
    const list = await Promise.all(friends.map(async (name) => ({ name, data: await friendData(name) })));
    const box = $('#friends', view);
    if (!box) return;
    box.innerHTML = list.map(({ name, data }) => friendCard(name, data)).join('');
    const events = list.filter(({ data }) => !data.error).flatMap(({ name, data }) => activityOf(name, data));
    $('#activity', view).innerHTML = events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((ev) => `
      <a class="activity__row" href="#/amis/${encodeURIComponent(ev.name)}">
        <span class="mini-avatar" style="--rc:${ev.color}">${safeUrl(ev.avatar) ? `<img src="${esc(ev.avatar)}" alt="">` : esc(ev.who[0]?.toUpperCase() ?? '?')}</span>
        <span><b>${esc(ev.who)}</b> ${esc(ev.text)} <b>${esc(ev.game)}</b><small>${esc(ago(ev.date))}</small></span>
        ${safeUrl(ev.cover) ? `<img class="thumb--sm" src="${esc(ev.cover)}" alt="" loading="lazy">` : '<span></span>'}
      </a>`).join('') || '<p class="muted">Rien de neuf chez tes amis pour l\'instant.</p>';
  };
  if (friends.length) draw();

  view.addEventListener('submit', (e) => {
    if (e.target.id !== 'add-friend') return;
    e.preventDefault();
    requireEdit(async () => {
      const input = $('#friend-input', view);
      const name = friendName(input.value);
      if (!name) { input.setAttribute('aria-invalid', 'true'); toast('!', 'Lien ou code ami invalide', 'Colle le lien de son Asobi (…/u/pseudo) ou son pseudo.'); return; }
      if (name === me?.username) { toast('🙃', 'C\'est toi !', 'Ajoute plutôt le lien d\'un ami.'); return; }
      if (friends.includes(name)) { toast('✓', 'Déjà dans tes amis'); return; }
      cache.delete(name);
      const data = await friendData(name);
      if (data.error) {
        input.setAttribute('aria-invalid', 'true');
        toast('🔒', 'Profil introuvable ou privé', `Demande à ${name} de rendre son profil public (Profil › Réglages).`, 8000);
        return;
      }
      await saveSettings({ friends: [...friends, name] });
      toast('👥', `${nameOf(data, name)} ajouté à tes amis`, 'Compare vos collections avec « Comparer ».');
    });
  });
  view.addEventListener('input', (e) => e.target.removeAttribute?.('aria-invalid'));
  view.addEventListener('click', async (e) => {
    if (e.target.closest('#copy-code')) {
      const url = `${location.origin}/u/${me.username}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast('🔗', 'Lien copié', url);
      return;
    }
    const un = e.target.closest('[data-unfriend]');
    if (un) {
      const name = un.dataset.unfriend;
      requireEdit(async () => {
        await saveSettings({ friends: friends.filter((f) => f !== name) });
        toast('↺', `${name} retiré de tes amis`, '', 5000, { action: { label: 'Annuler', onClick: () => saveSettings({ friends }) } });
      });
    }
  });
  return null;
}

function friendCard(name, data) {
  if (data.error) {
    return `
      <article class="friend friend--private">
        <span style="font-size:28px">🔒</span>
        <strong class="tile__title">${esc(name)}</strong>
        <p class="muted" style="margin:0;font-size:13px">${data.error === 'private' ? 'Profil privé ou introuvable. Demande-lui de le rendre public.' : 'Profil indisponible pour le moment.'}</p>
        <button class="btn btn--ghost" type="button" data-unfriend="${esc(name)}">Retirer</button>
      </article>`;
  }
  const games = data.games ?? [];
  const label = nameOf(data, name);
  const lvl = playerLevel(games);
  const profile = playerProfile(games);
  const best = [...games].sort((a, b) => cardStats(b).power - cardStats(a).power)[0];
  const playing = games.filter((g) => g.status === 'playing').sort((a, b) => (b.lastPlayedAt ?? b.startedAt ?? '').localeCompare(a.lastPlayedAt ?? a.startedAt ?? ''))[0];
  const compat = compatibility(state.games, games);
  return `
    <article class="friend">
      <div class="friend__banner" style="background-image:${cssUrl(best?.images?.heroThumb || best?.images?.hero || best?.images?.gridThumb)}"></div>
      <div class="friend__body">
        <div class="friend__who">${avatarRing(data.user, label, lvl)}<div><strong>${esc(label)}</strong><small style="--rc:${lvl.rank.color}">${esc(lvl.rank.name)}${profile.locked ? '' : ` · ${esc(profile.archetype.name)}`}</small></div></div>
        ${playing ? `<div class="friend__playing">${thumb(playing, 'thumb--sm')}<div><small>Joue à</small><b>${esc(playing.name)}</b></div></div>` : ''}
        <div class="friend__stats">
          <div><b>${games.length}</b><small>jeux</small></div>
          <div><b>${mythics(games)}</b><small>mythiques</small></div>
          <div><b>${commonIds(state.games, games).length}</b><small>en commun</small></div>
        </div>
        <div class="hbars__row"><span>Goûts communs<em>${compat} %</em></span><div class="bar"><i style="--v:${compat}%"></i></div></div>
        <div class="actions">
          <a class="btn btn--primary" href="#/amis/${encodeURIComponent(name)}" style="flex:1">⚔ Comparer</a>
          <a class="btn" href="/u/${encodeURIComponent(name)}" target="_blank" rel="noopener" style="flex:1">Son profil</a>
          <button class="btn btn--icon btn--ghost" type="button" data-unfriend="${esc(name)}" aria-label="Retirer ${esc(label)} de mes amis">✕</button>
        </div>
      </div>
    </article>`;
}

function activityOf(name, data) {
  const who = nameOf(data, name);
  const color = playerLevel(data.games ?? []).rank.color;
  const base = { name, who, color, avatar: data.user?.avatarUrl };
  const cover = (g) => g.images?.gridThumb || g.images?.cover || g.cover;
  return [
    ...(data.games ?? []).filter((g) => g.finishedAt).map((g) => ({ ...base, date: g.finishedAt, game: g.name, cover: cover(g), text: g.status === 'completed' ? 'a terminé à 100 %' : 'a terminé' })),
    ...(data.games ?? []).filter((g) => g.addedAt).map((g) => ({ ...base, date: g.addedAt, game: g.name, cover: cover(g), text: 'a ajouté à sa collection' })),
    ...(data.wishlist ?? []).filter((w) => w.addedAt).map((w) => ({ ...base, date: w.addedAt, game: w.name, cover: w.cover, text: 'a ajouté à ses envies' })),
  ];
}

/* ---------- Duel ---------- */

export function renderDuel(view, rawName) {
  const name = friendName(rawName);
  const friends = state.settings.friends ?? [];
  view.innerHTML = `<div class="skeleton" style="height:200px;border-radius:30px"></div><div class="grid-2"><div class="skeleton" style="height:320px"></div><div class="skeleton" style="height:320px"></div></div>`;
  let alive = true;

  const draw = async () => {
    const data = name ? await friendData(name) : { error: 'private' };
    if (!alive) return;
    if (data.error) {
      view.innerHTML = emptyState('🔒', 'Profil introuvable ou privé', 'Ce joueur n\'existe pas, ou son profil n\'est pas public.', '<a class="btn btn--primary" href="#/amis">Retour à mes amis</a>');
      return;
    }
    const mine = state.games;
    const theirs = data.games ?? [];
    const label = nameOf(data, name);
    const myName = state.settings.name || state.user?.displayName || 'Toi';
    const myLvl = playerLevel(mine);
    const theirLvl = playerLevel(theirs);
    const myProfile = playerProfile(mine);
    const theirProfile = playerProfile(theirs);
    const compat = compatibility(mine, theirs);

    // Face à face
    const hours = (gs) => Math.round(sum(gs.map((g) => g.playtimeMinutes ?? 0)) / 60);
    const done = (gs) => gs.filter((g) => ['finished', 'completed'].includes(g.status)).length;
    const mean = (gs) => { const r = gs.map(ratingAverage).filter((v) => v != null); return r.length ? avg(r) : 0; };
    const rows = [
      ['Jeux', mine.length, theirs.length],
      ['Heures de jeu', hours(mine), hours(theirs)],
      ['Terminés', done(mine), done(theirs)],
      ['Note moyenne', mean(mine), mean(theirs), 1],
      ['Cartes mythiques', mythics(mine), mythics(theirs)],
      ['Badges', badges(mine).filter((b) => b.unlocked).length, badges(theirs).filter((b) => b.unlocked).length],
    ];
    const fmtN = (v, d) => v.toLocaleString('fr-FR', { minimumFractionDigits: d ?? 0, maximumFractionDigits: d ?? 0 });

    // Cartes en commun : la plus puissante de chaque paire porte la couronne
    const pairs = commonIds(mine, theirs).map((id) => {
      const a = mine.filter((g) => g.igdbId === id).sort((x, y) => cardStats(y).power - cardStats(x).power)[0];
      const b = theirs.filter((g) => g.igdbId === id).sort((x, y) => cardStats(y).power - cardStats(x).power)[0];
      return { a, b, pa: cardStats(a).power, pb: cardStats(b).power };
    }).sort((x, y) => (y.pa + y.pb) - (x.pa + x.pb)).slice(0, 6);
    const caption = (g, who) => `${who} · ${g.playtimeMinutes ? fmtHours(g.playtimeMinutes) : 'pas joué'}${g.status === 'completed' ? ' · 100 %' : ''}`;

    // Envies communes, et ses meilleurs jeux absents de ta collection
    const myWish = new Map(state.wishlist.map((w) => [w.igdbId, w]));
    const wishes = (data.wishlist ?? []).filter((w) => myWish.has(w.igdbId))
      .sort((a, b) => (daysUntil(a.releaseDate) ?? 9e9) - (daysUntil(b.releaseDate) ?? 9e9));
    const owned = new Set(mine.map((g) => g.igdbId));
    const theirBest = theirs.filter((g) => g.igdbId && !owned.has(g.igdbId) && !myWish.has(g.igdbId))
      .sort((a, b) => cardStats(b).power - cardStats(a).power).slice(0, 8)
      .map((g) => ({ igdbId: g.igdbId, name: g.name, cover: g.images?.gridThumb || g.images?.cover, year: g.releaseDate?.slice(0, 4), platforms: [g.platform], genres: g.genres ?? [], power: cardStats(g).power }));

    // Genres comparés
    const ga = genreShares(mine);
    const gb = genreShares(theirs);
    const genres = [...new Set([...ga.keys(), ...gb.keys()])].sort((x, y) => (ga.get(y) ?? 0) + (gb.get(y) ?? 0) - (ga.get(x) ?? 0) - (gb.get(x) ?? 0)).slice(0, 7);
    const top = Math.max(0.01, ...genres.flatMap((k) => [ga.get(k) ?? 0, gb.get(k) ?? 0]));

    view.innerHTML = `
      <section class="duel" style="--rc:${theirLvl.rank.color}">
        <div class="duel__side">${avatarRing(state.user, myName, myLvl)}<div><span class="eyebrow">Toi</span><strong>${esc(myName)}</strong><small>${esc(myLvl.rank.name)}${myProfile.locked ? '' : ` · ${esc(myProfile.archetype.name)}`}</small></div></div>
        <div class="duel__vs"><div class="match-ring" style="--v:${compat}%"><div><b>${compat} %</b><small>goûts communs</small></div></div>VS</div>
        <div class="duel__side duel__side--right">${avatarRing(data.user, label, theirLvl)}<div><span class="eyebrow" style="color:var(--rc)">Ami</span><strong>${esc(label)}</strong><small>${esc(theirLvl.rank.name)}${theirProfile.locked ? '' : ` · ${esc(theirProfile.archetype.name)}`}</small></div></div>
      </section>

      ${friends.length > 1 ? `<div class="row" role="tablist" aria-label="Amis">${friends.map((f) => `<a class="chip" role="tab" href="#/amis/${encodeURIComponent(f)}" aria-selected="${f === name}">${esc(f)}</a>`).join('')}</div>` : ''}

      <div class="duel-grid">
        <div class="tile" style="--rc:${theirLvl.rank.color}">
          <div class="tile-head"><h3 class="tile__title">Face à face</h3><span class="muted-2 mono" style="font-size:12px">${rows.filter(([, a, b]) => a > b).length} – ${rows.filter(([, a, b]) => b > a).length}</span></div>
          <div class="h2h">${rows.map(([lab, a, b, d]) => {
            const max = Math.max(a, b, 0.0001);
            return `<div class="h2h__row">
              <span class="${a > b ? 'is-win' : ''}">${fmtN(a, d)}</span>
              <span class="bar bar--rev"><i style="--v:${(a / max) * 100}%"></i></span>
              <span>${lab}</span>
              <span class="bar bar--rc"><i style="--v:${(b / max) * 100}%"></i></span>
              <span class="${b > a ? 'is-win' : ''}" style="${b > a ? 'color:var(--rc)' : ''}">${fmtN(b, d)}</span>
            </div>`;
          }).join('')}</div>
        </div>
        <div class="tile">
          <div class="tile-head"><h3 class="tile__title">Vos cartes en commun</h3><span class="muted-2" style="font-size:12px">la plus puissante gagne ♛</span></div>
          ${pairs.length ? `<div class="pairs">${pairs.map(({ a, b, pa, pb }) => `
            <div class="pair">
              <div class="pair__cell">${pa >= pb ? '<span class="crown" aria-label="Gagnant">♛</span>' : ''}${cardHtml(a, { mini: true })}<span>${esc(caption(a, 'toi'))}</span></div>
              <span class="pair__vs">VS</span>
              <div class="pair__cell">${pb > pa ? '<span class="crown" aria-label="Gagnant">♛</span>' : ''}${cardHtml(b, { mini: true, foreign: true, href: `/u/${encodeURIComponent(name)}#/jeu/${encodeURIComponent(b.id)}` })}<span>${esc(caption(b, label))}</span></div>
            </div>`).join('')}</div>` : '<p class="muted">Aucun jeu en commun pour l\'instant.</p>'}
        </div>
      </div>

      <div class="grid-2">
        <div class="tile" style="display:flex;flex-direction:column;gap:14px">
          <div class="tile-head" style="margin:0"><h3 class="tile__title">Envies en commun</h3><span class="muted-2" style="font-size:12px">vous les attendez tous les deux</span></div>
          ${wishes.length ? wishes.slice(0, 5).map((w) => {
            const d = daysUntil(w.releaseDate);
            return `<div class="countdown">
              ${safeUrl(w.cover) ? `<img class="thumb" src="${esc(w.cover)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
              <div style="flex:1;min-width:0"><strong>${esc(w.name)}</strong><br><small>${esc([w.platforms?.slice(0, 3).map((p) => platformMeta(p).short).join(', '), w.releaseDate && fmtDate(w.releaseDate)].filter(Boolean).join(' · '))}</small></div>
              <span class="countdown__days${d != null && d > 0 ? '' : ' is-out'}">${d != null && d > 0 ? `J-${d}` : 'Dispo'}</span>
              <span class="tag">Jouer ensemble ?</span>
            </div>`;
          }).join('') : '<p class="muted">Aucune envie en commun.</p>'}
          ${theirBest.length ? `${sectionHead(`${esc(label)} les a, pas toi`)}<div class="covers">${theirBest.map((s, i) => miniCover(s, { i, flag: `${s.power}`, sub: [s.year, platformMeta(s.platforms[0]).short].filter(Boolean).join(' · ') })).join('')}</div>` : ''}
        </div>
        <div class="tile" style="--rc:${theirLvl.rank.color}">
          <div class="tile-head"><h3 class="tile__title">Vos genres</h3><span class="legend-dots"><span><i style="--c:var(--acc)"></i>toi</span><span><i style="--c:var(--rc)"></i>${esc(label)}</span></span></div>
          ${genres.length ? `<div class="genre-duel">${genres.map((k) => `
            <div class="genre-duel__row"><span>${esc(k)}</span><div>
              <span class="bar"><i style="--v:${((ga.get(k) ?? 0) / top) * 100}%"></i></span>
              <span class="bar bar--rc"><i style="--v:${((gb.get(k) ?? 0) / top) * 100}%"></i></span>
            </div></div>`).join('')}</div>` : '<p class="muted">Pas encore de genres à comparer.</p>'}
        </div>
      </div>`;
    attachHolo(view);
  };

  draw();
  bindStubs(view);
  const unsubscribe = onChange((e) => { if (['wishlist', 'games', 'settings'].includes(e.detail.type)) draw(); });
  return () => { alive = false; unsubscribe(); };
}
