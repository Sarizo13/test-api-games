// Profil : niveau (anneau d'XP, rang, gains), archétype et goûts (à partir de 10 jeux), meilleure main,
// badges, et réglages (compte Discord, profil public, apparence, comptes de jeu, données).

import { platformMeta } from '../../platforms.js';
import { state, TEST, PROFILE, logout, saveSettings, deleteAccount } from '../state.js';
import { cardHtml, cardStats, attachHolo } from '../card.js';
import { bars, animateCharts } from '../charts.js';
import { playerProfile, PROFILE_MIN } from '../taste.js';
import { playerLevel, xpBreakdown, RANKS } from '../level.js';
import { badges } from '../badges.js';
import { THEMES, appearance, setAppearance } from '../appearance.js';
import { requireEdit } from '../add.js';
import { sectionHead } from './common.js';
import { $, esc, safeUrl, fmtHours, openModal, toast, setAmbient } from '../util.js';

export function renderProfile(view) {
  const games = state.games;
  const profile = playerProfile(games);
  const medals = badges(games);
  const lvl = playerLevel(games);
  const gains = xpBreakdown(games).filter((r) => r.xp);
  const hand = [...games].filter((g) => cardStats(g).tier !== 'sealed').sort((a, b) => cardStats(b).power - cardStats(a).power).slice(0, 5);
  const who = PROFILE ? state.owner : state.user;
  const name = state.settings.name || who?.displayName || (TEST ? 'Mode test' : 'Joueur');

  view.innerHTML = `
    <section class="tile player">
      <div class="level-ring" style="--xp:${lvl.pct}%">
        <div class="level-ring__avatar">${safeUrl(who?.avatarUrl) ? `<img src="${esc(who.avatarUrl)}" alt="">` : esc(name[0]?.toUpperCase() ?? '?')}</div>
        <div class="level-ring__badge">${lvl.level}</div>
      </div>
      <div class="player__text">
        <span class="eyebrow">Profil de joueur</span>
        <h1 class="player__name">${esc(name)}</h1>
        <span class="rank" style="--rc:${lvl.rank.color};align-self:flex-start">${esc(lvl.rank.name)}</span>
        <div class="xpbar"><i data-v="${lvl.pct}%"></i></div>
        <span class="player__xp">${lvl.xp.toLocaleString('fr-FR')} / ${lvl.need.toLocaleString('fr-FR')} XP · encore ${(lvl.need - lvl.xp).toLocaleString('fr-FR')} XP · ${lvl.total.toLocaleString('fr-FR')} XP en tout</span>
      </div>
      <div class="gains">
        <span class="eyebrow">Gains</span>
        ${gains.map((r) => `<div class="gains__row"><span>${esc(r.label)}</span><b>+${r.xp.toLocaleString('fr-FR')}</b></div>`).join('') || '<span class="muted">Ajoute ton premier jeu : +10 XP.</span>'}
      </div>
    </section>

    <section class="section">
      ${sectionHead('Rangs', '<span class="note">un rang tous les 10 niveaux</span>')}
      <div class="ranks">${RANKS.map((r) => `<span class="rank${lvl.level >= r.min ? '' : ' is-locked'}" style="--rc:${r.color}">${esc(r.name)} · ${r.min}</span>`).join('')}</div>
    </section>

    ${profile.locked ? `
      <section class="tile" style="display:flex;flex-direction:column;gap:12px;max-width:680px">
        <span class="eyebrow">Profil de joueur</span>
        <div class="row"><span style="font-size:24px">🔒</span><h2 class="h-section">Encore ${profile.missing} jeu${profile.missing > 1 ? 'x' : ''}</h2></div>
        <p class="muted" style="margin:0">Ton archétype, tes traits et « Pour toi » se débloquent à ${PROFILE_MIN} jeux. Tu en as ${profile.count}.</p>
        <div class="xpbar"><i data-v="${(profile.count / PROFILE_MIN) * 100}%"></i></div>
        <div class="row row--between muted-2 mono" style="font-size:12px"><span>${profile.count} / ${PROFILE_MIN} jeux</span><span>débloqué à ${PROFILE_MIN}</span></div>
        ${state.canEdit ? '<button class="btn btn--primary" type="button" data-action="add" style="align-self:flex-start">+ Ajouter un jeu</button>' : ''}
      </section>` : `
      <section class="tile archetype">
        <span class="archetype__emoji">${profile.archetype.emoji}</span>
        <div>
          <span class="eyebrow">Ton archétype</span>
          <h2>${esc(profile.archetype.name)}</h2>
          <p>${esc(profile.archetype.text)}</p>
          <div class="row">${profile.traits.map((t) => `<span class="tag" title="${esc(t.text)}">${t.emoji} ${esc(t.label)}</span>`).join('') || '<span class="muted-2" style="font-size:13px">Joue, note et termine des jeux pour révéler tes traits.</span>'}</div>
        </div>
      </section>

      <section class="charts">
        <div class="tile"><h3 class="tile__title">Genres</h3>${bars(profile.topGenres.map((x) => ({ label: x.key, value: x.pct, display: `${x.pct} %` })))}</div>
        <div class="tile"><h3 class="tile__title">Consoles</h3>${bars(profile.topPlatforms.map((x) => ({ label: platformMeta(x.key).short, value: x.pct, display: `${x.pct} %`, color: platformMeta(x.key).color })))}</div>
        <div class="tile"><h3 class="tile__title">Époques</h3>${bars(profile.topDecades.map((x) => ({ label: `Années ${x.key}`, value: x.pct, display: `${x.pct} %` })))}</div>
        <div class="tile"><h3 class="tile__title">Habitudes</h3>${bars([
          { label: 'Jeux terminés', value: Math.round(profile.stats.completionRate * 100), display: `${Math.round(profile.stats.completionRate * 100)} %`, color: 'var(--st-finished)' },
          { label: 'Jamais lancés', value: Math.round(profile.stats.backlogRate * 100), display: `${Math.round(profile.stats.backlogRate * 100)} %`, color: 'var(--st-backlog)' },
          { label: 'Jeux notés', value: Math.round(profile.stats.ratedRate * 100), display: `${Math.round(profile.stats.ratedRate * 100)} %`, color: 'var(--m-note)' },
          { label: 'Rétro', value: Math.round(profile.stats.retroRate * 100), display: `${Math.round(profile.stats.retroRate * 100)} %`, color: 'var(--st-completed)' },
        ], { max: 100 })}</div>
      </section>`}

    ${hand.length ? `
      <section class="section">
        ${sectionHead('Ta meilleure main', '<span class="note">tes 5 cartes les plus puissantes</span>')}
        <div class="grid-cards">${hand.map((g, i) => cardHtml(g, { i })).join('')}</div>
      </section>` : ''}

    <section class="section">
      ${sectionHead('Badges', `<span class="note">${medals.filter((m) => m.unlocked).length} / ${medals.length} · +75 XP chacun</span>`)}
      <div class="badges">
        ${medals.map((m) => `<div class="badge${m.unlocked ? '' : ' is-locked'}" title="${m.unlocked ? 'Obtenu' : 'À débloquer'}"><div class="badge__medal">${m.unlocked ? m.emoji : '?'}</div><div class="badge__name">${esc(m.name)}</div><small>${esc(m.text)}</small></div>`).join('')}
      </div>
    </section>

    ${state.canEdit || TEST ? settingsHtml(games) : ''}`;

  animateCharts(view);
  attachHolo(view);
  setAmbient(hand[0]?.images?.gridThumb ?? null);

  view.addEventListener('click', async (e) => {
    const theme = e.target.closest('[data-theme-pick]');
    if (theme) {
      setAppearance({ theme: theme.dataset.themePick });
      view.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-checked', String(b === theme)));
      return;
    }
    const id = e.target.closest('button')?.id;
    if (!id) return;
    if (id === 'logout') logout();
    if (id === 'save-name') requireEdit(async () => {
      await saveSettings({ name: $('#name', view).value });
      toast('✓', 'C\'est noté');
    });
    if (id === 'copy-link') {
      await navigator.clipboard?.writeText(publicUrl()).catch(() => {});
      toast('🔗', 'Lien copié', publicUrl());
    }
    if (id === 'export') exportBackup();
    if (id === 'delete-account') openDelete();
  });
  view.addEventListener('change', (e) => {
    if (e.target.id === 'fx') setAppearance({ fx: e.target.checked });
    if (e.target.id === 'ambient') { setAppearance({ ambient: e.target.checked }); setAmbient(hand[0]?.images?.gridThumb ?? null); }
    if (e.target.id !== 'public') return;
    requireEdit(async () => {
      await saveSettings({ profilePublic: e.target.checked });
      toast(e.target.checked ? '🌍' : '🔒', e.target.checked ? 'Profil public' : 'Profil privé',
        e.target.checked ? 'Tout le monde peut voir ta collection avec ton lien, et tes amis peuvent te comparer.' : 'Toi seul vois ta collection.');
    });
  });
}

const publicUrl = () => `${location.origin}/u/${state.user?.username ?? ''}`;

function settingsHtml(games) {
  const u = state.user;
  const s = state.settings;
  const a = appearance();
  return `
    <section class="section">
      ${sectionHead('Réglages')}
      <div class="settings">
        <div class="tile">
          <h3 class="tile__title">Compte</h3>
          ${TEST ? '<p>Mode test : rien n\'est enregistré.</p>' : `
            <div class="identity">
              ${safeUrl(u?.avatarUrl) ? `<img src="${esc(u.avatarUrl)}" alt="">` : `<span class="avatar">${esc((u?.displayName ?? '?')[0])}</span>`}
              <div><strong>${esc(u?.displayName ?? '')}</strong><small>@${esc(u?.username ?? '')} · connecté avec Discord</small></div>
            </div>`}
          <label class="field"><span class="field__label">Prénom ou pseudo affiché</span>
            <span class="row" style="flex-wrap:nowrap"><input class="input" id="name" maxlength="40" value="${esc(s.name ?? '')}" placeholder="Pour l'accueil"><button class="btn" type="button" id="save-name">OK</button></span></label>
          ${TEST ? '' : `
            <label class="check"><input type="checkbox" id="public"${u?.profilePublic ? ' checked' : ''}> Profil public : ma collection est visible avec mon lien</label>
            ${u?.profilePublic ? `<p class="note-line"><a href="/u/${esc(u.username)}" target="_blank" rel="noopener">${esc(publicUrl())}</a> · ton code ami : <b class="mono">${esc(u.username)}</b></p>` : '<p class="note-line">Rends ton profil public pour que tes amis puissent te comparer (duel).</p>'}
            <div class="actions">
              ${u?.profilePublic ? '<button class="btn btn--ghost" type="button" id="copy-link">Copier le lien</button>' : ''}
              <button class="btn btn--ghost" type="button" id="logout">Se déconnecter</button>
            </div>`}
        </div>

        <div class="tile">
          <h3 class="tile__title">Apparence</h3>
          <p>Le thème change le fond et la couleur principale. Il est gardé sur cet appareil.</p>
          <div class="themes" role="radiogroup" aria-label="Thème">
            ${THEMES.map((t) => `<button class="theme-swatch" type="button" role="radio" data-theme="${t.id}" data-theme-pick="${t.id}" aria-checked="${t.id === a.theme}"><i></i>${esc(t.name)}<small>${esc(t.text)}</small></button>`).join('')}
          </div>
          <label class="check"><input type="checkbox" id="fx"${a.fx ? ' checked' : ''}> Motif du thème (étoiles, grille, trame…)</label>
          <label class="check"><input type="checkbox" id="ambient"${a.ambient ? ' checked' : ''}> Fond d'ambiance : l'image floutée du jeu affiché</label>
        </div>

        <div class="tile">
          <h3 class="tile__title">Comptes de jeu</h3>
          <p>Steam, PlayStation, Xbox et Epic Games : importe ta bibliothèque, ton temps de jeu et tes succès. Discord retrouve la plupart de tes comptes. Les jeux Nintendo s'ajoutent à la main.</p>
          <div class="actions"><a class="btn btn--primary" href="#/comptes">Gérer mes comptes connectés</a><a class="btn" href="#/amis">Mes amis</a></div>
        </div>

        <div class="tile">
          <h3 class="tile__title">Données</h3>
          <p>${games.length} jeux · ${state.wishlist.length} envies · ${state.playlist.length} dans « À jouer » · ${fmtHours(games.reduce((acc, g) => acc + (g.playtimeMinutes ?? 0), 0))} de jeu au total.</p>
          <div class="actions">
            <button class="btn btn--ghost" type="button" id="export">Télécharger mes données</button>
            ${TEST ? '' : '<button class="btn btn--danger" type="button" id="delete-account">Supprimer mon compte</button>'}
          </div>
        </div>
      </div>
    </section>`;
}

/** Suppression définitive du compte : il faut retaper son pseudo. */
function openDelete() {
  const { el } = openModal(`
    <h2 class="modal__title">Supprimer mon compte</h2>
    <p class="modal__lead">Ta collection, tes notes, tes comptes connectés et leurs jetons seront effacés définitivement, et l'accès d'Asobi à Discord révoqué. Pense à télécharger tes données avant.</p>
    <label class="field"><span class="field__label">Tape <b>${esc(state.user.username)}</b> pour confirmer</span><input class="input" id="confirm" autocomplete="off"></label>
    <p class="warn warn--error" id="delete-error" hidden></p>
    <div class="modal__actions">
      <button class="btn btn--ghost" type="button" data-close>Annuler</button>
      <button class="btn btn--danger" type="button" id="delete-go" disabled>Supprimer définitivement</button>
    </div>`);
  const input = $('#confirm', el);
  const go = $('#delete-go', el);
  input.addEventListener('input', () => { go.disabled = input.value.trim() !== state.user.username; });
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      await deleteAccount(input.value.trim());
    } catch (err) {
      $('#delete-error', el).textContent = err.message;
      $('#delete-error', el).hidden = false;
      go.disabled = false;
    }
  });
  setTimeout(() => input.focus(), 60);
}

/** Mes données : export complet par le serveur (RGPD) ; en mode test, celles de la démo. */
function exportBackup() {
  if (!TEST) { location.href = '/api/me/export'; return; }
  const data = { exportedAt: new Date().toISOString(), games: state.games, wishlist: state.wishlist, playlist: state.playlist, settings: state.settings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `asobi-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
