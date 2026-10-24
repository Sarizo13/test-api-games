// Comptes connectés : Discord (identité et découverte des comptes), Steam (import, temps de jeu, succès),
// et les autres plateformes, affichées telles qu'elles sont : détectées, sans import possible quand leur API est fermée.

import {
  state, TEST, fetchAccounts, discoverAccounts, enableAccount, accountLibrary, runAccountJob, setAutoSync,
  disconnectAccount, matchGame, searchIgdb, login,
} from '../state.js';
import { providerLogo } from '../brands.js';
import { openAdd } from '../add.js';
import { sectionHead, emptyState, thumb } from './common.js';
import { $, $$, esc, safeUrl, fmtDate, fmtHours, highlight, listbox, openModal, toast, confetti, ICONS } from '../util.js';

const STATUS = {
  detected: { label: 'Détecté', color: '#22d3ee' },
  authorization_required: { label: 'Vérification nécessaire', color: '#fbbf24' },
  connected: { label: 'Prêt à importer', color: '#34d399' },
  syncing: { label: 'Synchronisation…', color: '#8b5cf6' },
  synced: { label: 'Synchronisé', color: '#34d399' },
  error: { label: 'Erreur', color: '#fb7185' },
  unsupported: { label: 'Import indisponible', color: '#94a3b8' },
};
const CAPS = [['library', 'Bibliothèque'], ['playtime', 'Temps de jeu'], ['achievements', 'Succès'], ['sync', 'Synchro auto']];
// Plateformes montrées même sans compte détecté (les autres n'apparaissent que si Discord en a trouvé un)
const ALWAYS = ['steam', 'playstation', 'xbox', 'epicgames', 'nintendo'];

const when = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function renderAccounts(view) {
  if (TEST) {
    view.innerHTML = emptyState('🧪', 'Indisponible en mode test', 'Connecte-toi avec Discord pour relier tes comptes de jeu.', '<a class="btn btn-ghost" href="/">Quitter le mode test</a>');
    return null;
  }
  view.innerHTML = `
    <div class="page-head">
      <div><p class="kicker">Réglages</p><h1>Comptes connectés</h1>
      <p>Discord sert à retrouver tes comptes de jeu. Aujourd'hui, seul Steam ouvre ses données (bibliothèque, temps de jeu, succès) ; les autres plateformes sont reconnues, et tu ajoutes leurs jeux à la main.</p></div>
      <button class="btn btn-primary btn-discord" type="button" id="discover">${providerLogo('discord', 'btn-logo')}Découvrir mes comptes avec Discord</button>
    </div>
    <div id="accounts"><div class="shimmer" style="height:320px;border-radius:22px"></div></div>`;

  let data = null;
  let alive = true;
  const draw = () => {
    if (!alive) return;
    const box = $('#accounts', view);
    const discord = data.accounts.find((a) => a.provider === 'discord');
    const providers = data.providers.filter((p) => p.kind !== 'identity');
    const cards = providers.flatMap((p) => {
      const list = data.accounts.filter((a) => a.provider === p.id);
      if (list.length) return list.map((a) => accountCard(p, a));
      return ALWAYS.includes(p.id) ? [placeholderCard(p)] : [];
    });
    const unmatched = state.games.filter((g) => g.matchStatus === 'unmatched');
    box.innerHTML = `
      ${identityCard(discord)}
      ${sectionHead('Plateformes de jeu')}
      <div class="accounts-grid section">${cards.join('')}</div>
      ${unmatched.length ? `
        ${sectionHead('Jeux à associer', `<span class="muted" style="font-size:13px">${unmatched.length} importé${unmatched.length > 1 ? 's' : ''} sans fiche IGDB sûre</span>`)}
        <p class="muted" style="margin:-6px 0 14px;font-size:14px">Asobi ne fusionne jamais deux jeux sur une simple ressemblance de titre. Choisis la bonne fiche pour ces jeux.</p>
        <div class="grid-auto section" style="--min:260px">${unmatched.map((g, i) => `
          <div class="now-item" style="--i:${i}">${thumb(g)}<div><strong>${esc(g.name)}</strong><small>${esc(g.platform)}${g.playtimeMinutes ? ` · ${fmtHours(g.playtimeMinutes)}` : ''}</small></div>
            <button class="btn btn-ghost btn-sm" type="button" data-match="${esc(g.id)}">Associer</button></div>`).join('')}</div>` : ''}
      <p class="source-note">Les jetons d'accès restent sur le serveur, chiffrés ; ils ne passent jamais par ton navigateur. Déconnecter un compte efface ses jetons et ses données brutes, pas les jeux de ta collection.</p>`;
  };

  const refresh = async (promise) => {
    try {
      data = await promise;
      draw();
    } catch (err) {
      if (err.code === 'discord_reauth') {
        toast('🔑', 'Reconnexion à Discord nécessaire', ` ${err.message}`, 8000);
        data ??= await fetchAccounts().catch(() => null);
        if (data) draw();
        return;
      }
      if (!data) $('#accounts', view).innerHTML = emptyState('📡', 'Comptes indisponibles', esc(err.message));
      else toast('⚠️', 'Action impossible', ` ${err.message}`, 8000);
    }
  };
  refresh(fetchAccounts());

  const progressOf = (id) => $(`[data-account="${id}"] .progress`, view);
  const busy = (button, on) => { if (button) { button.disabled = on; button.classList.toggle('is-busy', on); } };

  view.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.closest('[data-account]')?.dataset.account;

    if (btn.id === 'discover') {
      busy(btn, true);
      await refresh(discoverAccounts().then((d) => { toast('🔍', 'Comptes Discord relus'); return d; }));
      busy(btn, false);
      return;
    }
    if (btn.dataset.reauth !== undefined) { login('#/comptes'); return; }
    if (btn.dataset.manual) { openAdd({ platform: btn.dataset.manual }); return; }
    if (btn.dataset.match) { openMatch(btn.dataset.match, draw); return; }

    if (btn.dataset.enable !== undefined) {
      busy(btn, true);
      await refresh(enableAccount(id).then((d) => { toast('✅', 'Import Steam activé', ' Tu peux maintenant importer tes jeux.'); return d; }));
      busy(btn, false);
      return;
    }
    if (btn.dataset.sync !== undefined) {
      busy(btn, true);
      const bar = progressOf(id);
      bar.hidden = false;
      try {
        const job = await runAccountJob(id, 'sync', undefined, (j) => bar.firstElementChild.style.setProperty('--p', `${j.total ? (j.progress / j.total) * 100 : 8}%`));
        toast('🎮', 'Synchronisation terminée', ` ${job.stats.playtimeUpdated} temps de jeu et ${job.stats.achievementsUpdated} succès mis à jour.`);
      } catch (err) {
        toast('⚠️', 'Synchronisation impossible', ` ${err.message}`, 9000);
      }
      await refresh(fetchAccounts());
      return;
    }
    if (btn.dataset.import !== undefined) { openLibrary(id, () => refresh(fetchAccounts())); return; }
    if (btn.dataset.disconnect !== undefined) {
      const account = data.accounts.find((a) => String(a.id) === id);
      const label = account.provider === 'discord'
        ? 'Révoquer l\'accès d\'Asobi à tes connexions Discord ? Tu resteras connecté, mais Asobi ne pourra plus retrouver tes comptes.'
        : 'Déconnecter ce compte ? Ses jetons et ses données brutes seront effacés ; les jeux déjà dans ta collection restent.';
      if (!confirm(label)) return;
      await refresh(disconnectAccount(id).then((d) => { toast('🔌', 'Compte déconnecté'); return d; }));
    }
  });

  view.addEventListener('change', (e) => {
    if (!e.target.matches('[data-autosync]')) return;
    const id = e.target.closest('[data-account]').dataset.account;
    refresh(setAutoSync(id, e.target.checked));
  });

  return () => { alive = false; };
}

/* ---------- Cartes ---------- */

function identityCard(account) {
  const u = state.user;
  const ok = account?.status === 'connected';
  return `
    <section class="panel section identity-card" data-account="${account?.id ?? ''}">
      ${safeUrl(u?.avatarUrl) ? `<img class="avatar" src="${esc(u.avatarUrl)}" alt="">` : `<span class="avatar">${providerLogo('discord')}</span>`}
      <div>
        <p class="kicker">Connecté avec Discord</p>
        <strong class="identity-name">${esc(u?.displayName ?? u?.username ?? '')}</strong>
        <div class="status-line"><span class="dot${ok ? ' is-on' : ''}"></span>${ok
          ? `Accès aux connexions actif${account.lastSyncAt ? ` · relues le ${esc(when(account.lastSyncAt))}` : ''}`
          : esc(account?.message ?? 'Accès aux connexions à rétablir')}</div>
      </div>
      <div class="chips">
        ${ok ? '<button class="btn btn-ghost btn-sm" type="button" data-disconnect>Révoquer l\'accès</button>' : '<button class="btn btn-primary btn-sm" type="button" data-reauth>Reconnecter Discord</button>'}
      </div>
    </section>`;
}

function caps(provider) {
  return `<div class="caps">${CAPS.map(([k, label]) => `<span class="cap${provider.capabilities[k] ? ' is-on' : ''}">${provider.capabilities[k] ? '✓' : '✕'} ${label}</span>`).join('')}</div>`;
}

function cardShell(provider, inner, { account } = {}) {
  const s = account ? STATUS[account.status] ?? STATUS.detected : null;
  return `
    <article class="panel provider-card" ${account ? `data-account="${account.id}"` : ''}>
      <header class="provider-head">
        <span class="provider-icon">${providerLogo(provider.id)}</span>
        <div><strong>${esc(provider.name)}</strong><small>${provider.official ? 'API officielle' : 'Pas d\'API ouverte aux sites tiers'}</small></div>
        ${s ? `<span class="badge" style="--c:${s.color}">${s.label}</span>` : ''}
      </header>
      ${inner}
    </article>`;
}

function accountCard(provider, a) {
  const steamLike = provider.capabilities.library;
  const ready = ['connected', 'synced'].includes(a.status) || (a.status === 'error' && a.lastSyncAt);
  const configured = provider.enabled;
  let actions = '';
  if (steamLike && !configured) {
    actions = '<p class="modal-warning" style="margin:0">Import pas encore configuré sur ce serveur (clé STEAM_API_KEY manquante).</p>';
  } else if (steamLike) {
    actions = [
      !a.verified && '<a class="btn btn-primary btn-sm" href="/api/accounts/steam/openid/start">Vérifier avec Steam</a>',
      a.verified && !ready && `<button class="btn btn-primary btn-sm" type="button" data-enable>${ICONS.check}Activer l'import</button>`,
      a.verified && ready && `<button class="btn btn-primary btn-sm" type="button" data-import>${ICONS.download}Importer des jeux</button>`,
      a.verified && ready && `<button class="btn btn-ghost btn-sm" type="button" data-sync>${ICONS.refresh}Synchroniser</button>`,
      '<button class="btn btn-ghost btn-sm" type="button" data-disconnect>Déconnecter</button>',
    ].filter(Boolean).join('');
  } else {
    actions = [
      provider.manualImport?.length && `<button class="btn btn-ghost btn-sm" type="button" data-manual="${esc(provider.manualImport[0])}">${ICONS.plus}Ajouter un jeu à la main</button>`,
      '<button class="btn btn-ghost btn-sm" type="button" data-disconnect>Retirer</button>',
    ].filter(Boolean).join('');
  }
  const facts = [
    a.gamesCount ? `${a.gamesCount} jeu${a.gamesCount > 1 ? 'x' : ''} sur le compte` : null,
    a.lastSyncAt && steamLike ? `dernière synchro le ${when(a.lastSyncAt)}` : null,
    a.lastJob?.status === 'error' ? `dernier essai : ${a.lastJob.error}` : null,
  ].filter(Boolean);
  return cardShell(provider, `
    <div class="provider-account">
      <span>${esc(a.username ?? a.externalId)}</span>
      ${a.verified ? '<span class="verified" title="Propriété vérifiée">✓ vérifié</span>' : '<span class="unverified">non vérifié</span>'}
      ${a.detectedVia === 'discord' ? '<small>trouvé via Discord</small>' : ''}
    </div>
    ${facts.length ? `<p class="provider-facts">${facts.map(esc).join(' · ')}</p>` : ''}
    ${caps(provider)}
    <p class="source-note">${esc(a.message ?? provider.limitations ?? '')}</p>
    ${steamLike && ready ? `<label class="toggle"><input type="checkbox" data-autosync${a.autoSync ? ' checked' : ''}> Synchroniser automatiquement toutes les 12 h</label>` : ''}
    <div class="progress" hidden><span></span></div>
    <div class="chips">${actions}</div>`, { account: a });
}

function placeholderCard(provider) {
  const steamLike = provider.capabilities.library;
  const action = steamLike
    ? (provider.enabled
      ? '<a class="btn btn-primary btn-sm" href="/api/accounts/steam/openid/start">Relier mon compte Steam</a>'
      : '<p class="modal-warning" style="margin:0">Import pas encore configuré sur ce serveur.</p>')
    : provider.manualImport?.length ? `<button class="btn btn-ghost btn-sm" type="button" data-manual="${esc(provider.manualImport[0])}">${ICONS.plus}Ajouter un jeu à la main</button>` : '';
  const hint = steamLike
    ? 'Aucun compte Steam trouvé dans tes connexions Discord. Relie-le directement : Steam confirmera qu\'il est à toi.'
    : provider.id === 'nintendo' ? provider.limitations : `Aucun compte ${provider.name} dans tes connexions Discord. ${provider.limitations ?? ''}`;
  return cardShell(provider, `
    ${caps(provider)}
    <p class="source-note">${esc(hint)}</p>
    <div class="chips">${action}</div>`);
}

/* ---------- Import : choix des jeux de la bibliothèque ---------- */

async function openLibrary(accountId, onDone) {
  const { el, close } = openModal(`
    <h2>Importer depuis Steam</h2>
    <p class="modal-lead">Les jeux de ta bibliothèque qui ne sont pas encore dans ta collection. Ils seront rangés dans PC, avec leur temps de jeu et leurs succès.</p>
    <div id="lib"><div class="shimmer" style="height:240px;border-radius:14px"></div></div>
    <div class="progress" id="lib-progress" hidden><span></span></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" data-close>Fermer</button>
      <button class="btn btn-primary" type="button" id="lib-go" disabled>Importer</button>
    </div>`, { wide: true });

  let games = [];
  try {
    games = await accountLibrary(accountId);
  } catch (err) {
    $('#lib', el).innerHTML = `<p class="modal-warning">${esc(err.message)}</p>`;
    return;
  }
  if (!games.length) { $('#lib', el).innerHTML = '<p class="muted">Tous tes jeux Steam sont déjà dans ta collection 🎉</p>'; return; }

  $('#lib', el).innerHTML = `
    <div class="chips" style="margin-bottom:6px">
      <button class="chip" type="button" data-select="played">Tous ceux joués</button>
      <button class="chip" type="button" data-select="all">Tout (${games.length})</button>
      <button class="chip" type="button" data-select="none">Aucun</button>
    </div>
    <div class="steam-lib">${games.map((g) => `
      <label class="steam-row">
        <input type="checkbox" value="${esc(g.id)}" style="accent-color:#8b5cf6">
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
    const ids = $$('.steam-lib input:checked', el).map((input) => input.value);
    go.disabled = true;
    const bar = $('#lib-progress', el);
    bar.hidden = false;
    try {
      const job = await runAccountJob(accountId, 'import', { ids }, (j) => {
        bar.firstElementChild.style.setProperty('--p', `${j.total ? (j.progress / j.total) * 100 : 5}%`);
        go.textContent = j.total ? `Import ${j.progress}/${j.total}…` : 'Préparation…';
      });
      close();
      const s = job.stats;
      confetti();
      toast('🎮', `${s.added + s.unmatched} jeu${s.added + s.unmatched > 1 ? 'x' : ''} importé${s.added + s.unmatched > 1 ? 's' : ''}`,
        `${s.linked ? ` ${s.linked} relié${s.linked > 1 ? 's' : ''} à des jeux déjà présents.` : ''}${s.unmatched ? ` ${s.unmatched} à associer à la main.` : ''}${s.failed ? ` ${s.failed} en échec.` : ''}`, 9000);
    } catch (err) {
      toast('⚠️', 'Import interrompu', ` ${err.message}`, 9000);
      go.disabled = false;
    }
    onDone?.();
  });
}

/* ---------- Association manuelle d'un jeu importé ---------- */

function openMatch(gameId, onDone) {
  const game = state.games.find((g) => g.id === gameId);
  const { el, close } = openModal(`
    <h2>Associer « ${esc(game?.name ?? '')} »</h2>
    <p class="modal-lead">Choisis la fiche IGDB qui correspond vraiment à ce jeu. Tes notes, ton statut et ton temps de jeu sont conservés.</p>
    <div class="field">
      <div class="combo">${ICONS.search}<input class="input" id="match-q" value="${esc(game?.name ?? '')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="match-suggest"></div>
      <ul class="suggest" id="match-suggest" role="listbox" hidden></ul>
    </div>`);
  const input = $('#match-q', el);
  const list = $('#match-suggest', el);
  let results = [];
  const box = listbox(input, list, async (li) => {
    const pick = results[Number(li.dataset.index)];
    try {
      await matchGame(gameId, pick.igdbId);
      close();
      toast('🔗', `${pick.name} associé`);
      onDone?.();
    } catch (err) {
      toast('⚠️', 'Association impossible', ` ${err.message}`, 8000);
    }
  });
  let timer = 0;
  const suggest = async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.close(); return; }
    try { results = await searchIgdb(q); } catch { results = []; }
    if (input.value.trim() !== q) return;
    box.open(results.length ? results.map((r, i) => `
      <li role="option" id="ms-${i}" class="suggest-item" data-index="${i}">
        ${safeUrl(r.cover) ? `<img class="suggest-cover" src="${esc(r.cover)}" alt="" loading="lazy">` : '<span class="suggest-cover">🎮</span>'}
        <span class="suggest-text"><strong>${highlight(r.name, q)}</strong><small>${esc([r.year, r.platforms.slice(0, 4).join(', ')].filter(Boolean).join(' · '))}</small></span>
      </li>`).join('') : `<li class="suggest-empty">Aucun jeu trouvé pour « ${esc(q)} ».</li>`);
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(suggest, 220); });
  setTimeout(() => { input.focus(); input.select(); suggest(); }, 60);
}
