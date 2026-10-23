// Profil : ton profil de joueur (à partir de 10 jeux), ta meilleure main, tes badges,
// et les réglages (connexion, prénom, Steam, sauvegarde).

import { platformMeta } from '../../platforms.js';
import { state, TEST, logout, saveSettings, steamSync, steamLibrary, addGame } from '../state.js';
import { cardHtml, cardStats, attachHolo } from '../card.js';
import { bars, animateCharts } from '../charts.js';
import { playerProfile, PROFILE_MIN } from '../taste.js';
import { badges } from '../badges.js';
import { openLogin, requireEdit } from '../add.js';
import { sectionHead } from './common.js';
import { $, $$, esc, safeUrl, fmtDate, fmtHours, openModal, toast, confetti, ICONS } from '../util.js';

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
      <section class="panel section archetype" style="display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:22px;align-items:center;padding:clamp(18px,3vw,30px)">
        <span style="font-size:clamp(54px,8vw,84px);line-height:1;filter:drop-shadow(0 10px 30px rgba(139,92,246,.5))">${profile.archetype.emoji}</span>
        <div>
          <p class="kicker">Ton archétype</p>
          <h2 style="margin:0 0 8px;font:800 clamp(24px,3.4vw,36px)/1.1 var(--font-display)">${esc(profile.archetype.name)}</h2>
          <p class="muted" style="margin:0 0 14px;max-width:560px">${esc(profile.archetype.text)}</p>
          <div class="chips">${profile.traits.map((t) => `<span class="chip" title="${esc(t.text)}">${t.emoji} ${esc(t.label)}</span>`).join('') || '<span class="muted" style="font-size:13px">Joue, note et termine des jeux pour révéler tes traits.</span>'}</div>
        </div>
        <div class="stat" style="--c:#8b5cf6;min-width:130px;text-align:center"><span class="stat-value">${profile.score}</span><span class="stat-label">score de joueur</span></div>
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

    ${sectionHead('Réglages')}
    <section class="profile-grid">
      <div class="panel">
        <h3>Compte</h3>
        <div class="status-line"><span class="dot${state.canEdit ? ' is-on' : ''}"></span>${TEST ? 'Mode test : rien n\'est enregistré' : state.canEdit ? 'Connecté sur cet appareil' : 'Lecture seule (non connecté)'}</div>
        <label class="field"><span>Ton prénom ou pseudo</span>
          <div style="display:flex;gap:8px"><input class="input" id="name" maxlength="40" value="${esc(s.name ?? '')}" placeholder="Pour l'accueil"><button class="btn btn-ghost" type="button" id="save-name">OK</button></div></label>
        <div class="chips">
          ${state.canEdit && !TEST ? `<button class="btn btn-ghost btn-sm" type="button" id="logout">${ICONS.lock}Se déconnecter</button>` : ''}
          ${!state.canEdit ? `<button class="btn btn-primary btn-sm" type="button" id="login">${ICONS.lock}Se connecter</button>` : ''}
        </div>
      </div>

      <div class="panel">
        <h3 style="display:flex;align-items:center;gap:8px"><span style="width:20px;display:inline-grid">${ICONS.steam}</span>Steam</h3>
        <div class="status-line"><span class="dot${s.steamConnected ? ' is-on' : ''}"></span>${s.steamConnected
          ? `Profil connecté${s.steamSyncedAt ? ` · dernière synchro le ${esc(fmtDate(s.steamSyncedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}` : ''}`
          : 'Non connecté'}</div>
        <p class="source-note" style="margin:0 0 12px">Récupère ton temps de jeu et tes succès pour tes jeux PC. Ton profil Steam doit être public (détails des jeux compris).</p>
        <label class="field"><span>Lien de ton profil Steam</span>
          <div style="display:flex;gap:8px"><input class="input" id="steam" placeholder="steamcommunity.com/id/… ou ton SteamID"><button class="btn btn-ghost" type="button" id="save-steam">${s.steamConnected ? 'Changer' : 'Connecter'}</button></div></label>
        <div class="chips">
          <button class="btn btn-primary btn-sm" type="button" id="sync"${s.steamConnected ? '' : ' disabled'}>${ICONS.refresh}Synchroniser</button>
          <button class="btn btn-ghost btn-sm" type="button" id="import"${s.steamConnected ? '' : ' disabled'}>${ICONS.download}Importer ma bibliothèque</button>
          ${s.steamConnected ? '<button class="btn btn-ghost btn-sm" type="button" id="unsteam">Déconnecter</button>' : ''}
        </div>
        <div class="progress" id="sync-progress" hidden><span></span></div>
      </div>

      <div class="panel">
        <h3>Données</h3>
        <p class="muted" style="margin:0 0 14px;font-size:14px">${games.length} jeux · ${state.wishlist.length} envies · ${state.playlist.length} dans la liste « à jouer ».
          ${fmtHours(games.reduce((a, g) => a + (g.playtimeMinutes ?? 0), 0))} de jeu au total.</p>
        <div class="chips">
          <button class="btn btn-ghost btn-sm" type="button" id="export">${ICONS.download}Télécharger une sauvegarde</button>
          ${TEST ? '<a class="btn btn-ghost btn-sm" href="./">Quitter le mode test</a>' : '<a class="btn btn-ghost btn-sm" href="?test">Essayer le mode test</a>'}
        </div>
        <p class="source-note">Une copie de ta collection est aussi enregistrée chaque nuit sur GitHub.</p>
      </div>
    </section>`;

  animateCharts(view);
  attachHolo(view);

  view.addEventListener('click', async (e) => {
    const id = e.target.closest('button')?.id;
    if (!id) return;
    if (id === 'login') openLogin();
    if (id === 'logout') { logout(); toast('🔒', 'Déconnecté'); }
    if (id === 'save-name') requireEdit(async () => {
      await saveSettings({ name: $('#name', view).value });
      toast('👋', 'C\'est noté');
    });
    if (id === 'save-steam') requireEdit(async () => {
      const value = $('#steam', view).value.trim();
      if (!value) { $('#steam', view).focus(); return; }
      try {
        await saveSettings({ steam: value });
        toast('🎮', 'Profil Steam connecté', ' Lance une synchronisation pour récupérer ton temps de jeu.');
      } catch (err) { toast('⚠️', 'Profil Steam introuvable', ` ${err.message}`, 8000); }
    });
    if (id === 'unsteam') requireEdit(() => saveSettings({ steam: null }));
    if (id === 'sync') requireEdit(() => sync(view));
    if (id === 'import') requireEdit(() => importSteam());
    if (id === 'export') exportBackup();
  });
}

async function sync(view) {
  const btn = $('#sync', view);
  const bar = $('#sync-progress', view);
  btn.disabled = true;
  bar.hidden = false;
  try {
    const total = await steamSync((done, all) => bar.firstElementChild.style.setProperty('--p', `${all ? (done / all) * 100 : 100}%`));
    toast('🎮', 'Steam synchronisé', ` ${total} jeu${total > 1 ? 'x' : ''} PC mis à jour.`);
  } catch (err) {
    toast('⚠️', 'Synchronisation impossible', ` ${err.message}`, 8000);
    btn.disabled = false;
    bar.hidden = true;
  }
}

/** Liste des jeux de ta bibliothèque Steam absents de ta collection, à cocher puis importer. */
async function importSteam() {
  const { el, close } = openModal(`
    <h2>Importer depuis Steam</h2>
    <p class="modal-lead">Les jeux de ta bibliothèque qui ne sont pas encore dans ta collection. Ils seront rangés dans PC.</p>
    <div id="lib"><div class="shimmer" style="height:240px;border-radius:14px"></div></div>
    <p class="modal-warning" id="lib-warning" hidden></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" data-close>Annuler</button>
      <button class="btn btn-primary" type="button" id="lib-go" disabled>Importer</button>
    </div>`, { wide: true });

  let games = [];
  try {
    games = await steamLibrary();
  } catch (err) {
    $('#lib', el).innerHTML = `<p class="modal-warning">${esc(err.message)}</p>`;
    return;
  }
  if (!games.length) { $('#lib', el).innerHTML = '<p class="muted">Tous tes jeux Steam sont déjà dans ta collection 🎉</p>'; return; }

  $('#lib', el).innerHTML = `
    <div class="chips" style="margin-bottom:6px">
      <button class="chip" type="button" data-select="played">Tous ceux joués</button>
      <button class="chip" type="button" data-select="all">Tout</button>
      <button class="chip" type="button" data-select="none">Aucun</button>
    </div>
    <div class="steam-lib">${games.map((g) => `
      <label class="steam-row">
        <input type="checkbox" value="${g.appId}" style="accent-color:#8b5cf6">
        ${safeUrl(g.icon) ? `<img src="${esc(g.icon)}" alt="" loading="lazy">` : '<span></span>'}
        <span>${esc(g.name)}</span>
        <small>${g.playtimeMinutes ? fmtHours(g.playtimeMinutes) : 'jamais lancé'}</small>
      </label>`).join('')}</div>`;

  const go = $('#lib-go', el);
  const update = () => {
    const n = $$('.steam-lib input:checked', el).length;
    go.disabled = !n;
    go.textContent = n ? `Importer ${n} jeu${n > 1 ? 'x' : ''}` : 'Importer';
  };
  el.addEventListener('change', update);
  el.addEventListener('click', (e) => {
    const sel = e.target.closest('[data-select]')?.dataset.select;
    if (!sel) return;
    $$('.steam-lib input', el).forEach((input, i) => { input.checked = sel === 'all' || (sel === 'played' && games[i].playtimeMinutes > 0); });
    update();
  });

  go.addEventListener('click', async () => {
    const picked = $$('.steam-lib input:checked', el).map((input) => games.find((g) => g.appId === Number(input.value)));
    go.disabled = true;
    let ok = 0;
    const failed = [];
    for (const [i, g] of picked.entries()) {
      go.textContent = `Import ${i + 1}/${picked.length}…`;
      try {
        await addGame({ steamAppId: g.appId, name: g.name, platform: 'PC', status: g.playtimeMinutes ? 'playing' : 'backlog' });
        ok++;
      } catch (err) { if (err.status !== 409) failed.push(g.name); }
    }
    close();
    if (ok) {
      confetti();
      toast('🎮', `${ok} jeu${ok > 1 ? 'x' : ''} importé${ok > 1 ? 's' : ''}`, ' Synchronise Steam pour récupérer le temps de jeu et les succès.', 8000);
    }
    if (failed.length) toast('⚠️', 'Certains jeux n\'ont pas pu être ajoutés', ` ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`, 9000);
  });
}

function exportBackup() {
  const data = { exportedAt: new Date().toISOString(), games: state.games, wishlist: state.wishlist, playlist: state.playlist, settings: state.settings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `asobi-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
