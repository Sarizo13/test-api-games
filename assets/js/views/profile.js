// Profil : ton profil de joueur (à partir de 10 jeux), ta meilleure main, tes badges,
// et les réglages (compte Discord, profil public, comptes de jeu, données).

import { platformMeta } from '../../platforms.js';
import { state, TEST, logout, saveSettings, deleteAccount } from '../state.js';
import { cardHtml, cardStats, attachHolo } from '../card.js';
import { bars, animateCharts } from '../charts.js';
import { playerProfile, PROFILE_MIN } from '../taste.js';
import { badges } from '../badges.js';
import { requireEdit } from '../add.js';
import { sectionHead } from './common.js';
import { $, esc, safeUrl, fmtHours, openModal, toast, ICONS } from '../util.js';

const COLORS = ['#8b5cf6', '#22d3ee', '#f472b6', '#fbbf24', '#34d399', '#fb7185'];

export function renderProfile(view) {
  const games = state.games;
  const profile = playerProfile(games);
  const medals = badges(games);
  const hand = [...games].filter((g) => cardStats(g).tier !== 'sealed').sort((a, b) => cardStats(b).power - cardStats(a).power).slice(0, 5);
  const s = state.settings;

  view.innerHTML = `
    <div class="page-head">
      <div><p class="kicker">Profil</p><h1>${s.name ? esc(s.name) : 'Ton profil de joueur'}</h1>
      <p>Tes goûts, déduits de ta collection : chaque jeu compte selon tes notes, tes coups de cœur, ce que tu as fini et ton temps de jeu.</p></div>
    </div>

    ${profile.locked ? `
      <div class="panel section" style="display:grid;gap:12px;max-width:640px">
        <strong style="font:700 20px var(--font-display)">🔒 Profil débloqué à ${PROFILE_MIN} jeux</strong>
        <span class="muted">Tu as ${profile.count} jeu${profile.count > 1 ? 'x' : ''}. Encore ${profile.missing} et Asobi dessinera ton profil : ton archétype, tes genres, tes époques, et des suggestions « Pour toi ».</span>
        <div class="progress"><span data-p="${(profile.count / PROFILE_MIN) * 100}%"></span></div>
        <button class="btn btn-primary" type="button" data-action="add" style="justify-self:start">${ICONS.plus}Ajouter un jeu</button>
      </div>` : `
      <section class="panel section archetype">
        <span class="archetype-emoji">${profile.archetype.emoji}</span>
        <div class="archetype-text">
          <p class="kicker">Ton archétype</p>
          <h2>${esc(profile.archetype.name)}</h2>
          <p class="muted">${esc(profile.archetype.text)}</p>
          <div class="chips">${profile.traits.map((t) => `<span class="chip" title="${esc(t.text)}">${t.emoji} ${esc(t.label)}</span>`).join('') || '<span class="muted" style="font-size:13px">Joue, note et termine des jeux pour révéler tes traits.</span>'}</div>
        </div>
        <div class="stat archetype-score" style="--c:#8b5cf6"><span class="stat-value">${profile.score}</span><span class="stat-label">score de joueur</span></div>
      </section>

      <section class="charts section">
        <div class="panel"><h3>Genres</h3>${bars(profile.topGenres.map((x, i) => ({ label: x.key, value: x.pct, display: `${x.pct} %`, color: COLORS[i % COLORS.length] })))}</div>
        <div class="panel"><h3>Consoles</h3>${bars(profile.topPlatforms.map((x) => ({ label: platformMeta(x.key).short, value: x.pct, display: `${x.pct} %`, color: platformMeta(x.key).color })))}</div>
        <div class="panel"><h3>Époques</h3>${bars(profile.topDecades.map((x, i) => ({ label: `Années ${x.key}`, value: x.pct, display: `${x.pct} %`, color: COLORS[(i + 2) % COLORS.length] })))}</div>
        <div class="panel"><h3>Habitudes</h3>${bars([
          { label: 'Jeux terminés', value: Math.round(profile.stats.completionRate * 100), display: `${Math.round(profile.stats.completionRate * 100)} %`, color: '#34d399' },
          { label: 'Jamais lancés', value: Math.round(profile.stats.backlogRate * 100), display: `${Math.round(profile.stats.backlogRate * 100)} %`, color: '#94a3b8' },
          { label: 'Jeux notés', value: Math.round(profile.stats.ratedRate * 100), display: `${Math.round(profile.stats.ratedRate * 100)} %`, color: '#c084fc' },
          { label: 'Rétro', value: Math.round(profile.stats.retroRate * 100), display: `${Math.round(profile.stats.retroRate * 100)} %`, color: '#f59e0b' },
        ], { max: 100 })}</div>
      </section>`}

    ${hand.length ? `
      ${sectionHead('Ta meilleure main', '<span class="muted" style="font-size:13px">tes 5 cartes les plus puissantes</span>')}
      <div class="cards section" style="--card:150px">${hand.map((g, i) => cardHtml(g, { i })).join('')}</div>` : ''}

    ${sectionHead('Badges', `<span class="muted" style="font-size:13px">${medals.filter((m) => m.unlocked).length} / ${medals.length}</span>`)}
    <section class="badges section">
      ${medals.map((m) => `<div class="medal${m.unlocked ? '' : ' is-locked'}" title="${m.unlocked ? 'Obtenu' : 'À débloquer'}"><span class="medal-icon">${m.emoji}</span><strong>${esc(m.name)}</strong><small>${esc(m.text)}</small></div>`).join('')}
    </section>

    ${state.canEdit ? settingsHtml(games) : ''}`;

  animateCharts(view);
  attachHolo(view);

  view.addEventListener('click', async (e) => {
    const id = e.target.closest('button')?.id;
    if (!id) return;
    if (id === 'logout') logout();
    if (id === 'save-name') requireEdit(async () => {
      await saveSettings({ name: $('#name', view).value });
      toast('👋', 'C\'est noté');
    });
    if (id === 'copy-link') {
      await navigator.clipboard?.writeText(publicUrl()).catch(() => {});
      toast('🔗', 'Lien copié', ` ${publicUrl()}`);
    }
    if (id === 'export') exportBackup();
    if (id === 'delete-account') openDelete();
  });
  view.addEventListener('change', (e) => {
    if (e.target.id !== 'public') return;
    requireEdit(async () => {
      await saveSettings({ profilePublic: e.target.checked });
      toast(e.target.checked ? '🌍' : '🔒', e.target.checked ? 'Profil public' : 'Profil privé',
        e.target.checked ? ' Tout le monde peut voir ta collection avec ton lien.' : ' Toi seul vois ta collection.');
    });
  });
}

const publicUrl = () => `${location.origin}/u/${state.user?.username ?? ''}`;

function settingsHtml(games) {
  const u = state.user;
  const s = state.settings;
  return `
    ${sectionHead('Réglages')}
    <section class="profile-grid">
      <div class="panel">
        <h3>Compte</h3>
        ${TEST ? '<div class="status-line"><span class="dot"></span>Mode test : rien n\'est enregistré</div>' : `
          <div class="identity-mini">
            ${safeUrl(u?.avatarUrl) ? `<img class="avatar" src="${esc(u.avatarUrl)}" alt="">` : ''}
            <div><strong>${esc(u?.displayName ?? '')}</strong><small>@${esc(u?.username ?? '')} · connecté avec Discord</small></div>
          </div>`}
        <label class="field"><span>Prénom ou pseudo affiché</span>
          <div style="display:flex;gap:8px"><input class="input" id="name" maxlength="40" value="${esc(s.name ?? '')}" placeholder="Pour l'accueil"><button class="btn btn-ghost" type="button" id="save-name">OK</button></div></label>
        ${TEST ? '' : `
          <label class="toggle"><input type="checkbox" id="public"${u?.profilePublic ? ' checked' : ''}> Profil public : ma collection est visible par toute personne qui a le lien</label>
          ${u?.profilePublic ? `<p class="source-note" style="margin:6px 0 12px"><a href="/u/${esc(u.username)}" target="_blank" rel="noopener">${esc(publicUrl())}</a></p>` : ''}
          <div class="chips">
            ${u?.profilePublic ? `<button class="btn btn-ghost btn-sm" type="button" id="copy-link">${ICONS.edit}Copier le lien</button>` : ''}
            <button class="btn btn-ghost btn-sm" type="button" id="logout">${ICONS.lock}Se déconnecter</button>
          </div>`}
      </div>

      <div class="panel">
        <h3>Comptes de jeu</h3>
        <p class="muted" style="margin:0 0 14px;font-size:14px">Steam, Xbox, PlayStation, Epic… retrouvés grâce à Discord. Steam importe ta bibliothèque, ton temps de jeu et tes succès.</p>
        <div class="chips"><a class="btn btn-primary btn-sm" href="#/comptes">${ICONS.refresh}Gérer mes comptes connectés</a></div>
      </div>

      <div class="panel">
        <h3>Données</h3>
        <p class="muted" style="margin:0 0 14px;font-size:14px">${games.length} jeux · ${state.wishlist.length} envies · ${state.playlist.length} dans la liste « à jouer ».
          ${fmtHours(games.reduce((a, g) => a + (g.playtimeMinutes ?? 0), 0))} de jeu au total.</p>
        <div class="chips">
          <button class="btn btn-ghost btn-sm" type="button" id="export">${ICONS.download}Télécharger mes données</button>
          ${TEST ? '' : '<button class="btn btn-danger btn-sm" type="button" id="delete-account">Supprimer mon compte</button>'}
        </div>
        <p class="source-note">Ta collection est sauvegardée chaque nuit sur le serveur d'Asobi.</p>
      </div>
    </section>`;
}

/** Suppression définitive du compte : il faut retaper son pseudo. */
function openDelete() {
  const { el } = openModal(`
    <h2>Supprimer mon compte</h2>
    <p class="modal-lead">Ta collection, tes notes, tes comptes connectés et leurs jetons seront effacés définitivement, et l'accès d'Asobi à Discord révoqué. Pense à télécharger tes données avant.</p>
    <label class="field"><span>Tape <b>${esc(state.user.username)}</b> pour confirmer</span><input class="input" id="confirm" autocomplete="off"></label>
    <p class="modal-warning" id="delete-error" hidden></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" data-close>Annuler</button>
      <button class="btn btn-danger" type="button" id="delete-go" disabled>Supprimer définitivement</button>
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
  const a = Object.assign(document.createElement('a'), { href: url, download: `asobi-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
