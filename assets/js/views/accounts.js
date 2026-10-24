// Comptes connectés : Discord (identité et découverte des comptes), Steam (API officielle), les connecteurs
// non officiels PlayStation, Xbox (via Discord) et Epic (code collé), et Nintendo (ajout manuel), affichés tels qu'ils sont.

import {
  state, TEST, fetchAccounts, discoverAccounts, enableAccount, accountLibrary, runAccountJob, setAutoSync,
  disconnectAccount, matchGame, searchIgdb, login, linkStart, linkFinish,
} from '../state.js';
import { platformMeta } from '../../platforms.js';
import { providerLogo } from '../brands.js';
import { openAdd } from '../add.js';
import { pageHead, sectionHead, emptyState, thumb } from './common.js';
import { $, $$, esc, safeUrl, fmtDate, fmtHours, highlight, listbox, openModal, toast, confetti } from '../util.js';

const STATUS = {
  detected: { label: 'Détecté', color: 'var(--st-playing)' },
  authorization_required: { label: 'À relier', color: 'var(--st-completed)' },
  connected: { label: 'Prêt à importer', color: 'var(--st-finished)' },
  syncing: { label: 'Synchronisation…', color: 'var(--tier-epic)', busy: true },
  synced: { label: 'Synchronisé', color: 'var(--st-finished)' },
  error: { label: 'Erreur', color: 'var(--st-dropped)' },
  unsupported: { label: 'Import indisponible', color: 'var(--st-backlog)' },
};
const CAPS = [['library', 'Bibliothèque'], ['playtime', 'Temps de jeu'], ['achievements', 'Succès'], ['sync', 'Synchro auto']];
// Plateformes montrées même sans compte (les autres n'apparaissent que si Discord en a trouvé un)
const ALWAYS = ['steam', 'playstation', 'xbox', 'epicgames', 'nintendo'];
// Clé à mettre dans .env pour activer un connecteur côté serveur
const SERVER_KEY = { steam: 'STEAM_API_KEY', playstation: 'PSN_NPSSO', xbox: 'OPENXBL_API_KEY' };

const when = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ready = (a) => ['connected', 'synced'].includes(a.status) || (a.status === 'error' && a.lastSyncAt);

export function renderAccounts(view) {
  view.innerHTML = `
    ${pageHead('Réglages', 'Comptes', 'connectés', 'Discord retrouve tes comptes de jeu. Steam passe par son API officielle ; PlayStation, Xbox et Epic par des connecteurs non officiels, signalés comme tels ; les jeux Nintendo s\'ajoutent à la main. Tes jetons restent chiffrés sur le serveur.',
      `<button class="btn btn--discord" type="button" id="discover">${providerLogo('discord', 'btn-logo')}Découvrir mes comptes avec Discord</button>`)}
    <div id="accounts" class="section"><div class="skeleton" style="height:110px"></div><div class="providers">${'<div class="skeleton" style="height:260px"></div>'.repeat(3)}</div></div>`;

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
      <div class="providers">${cards.join('')}</div>
      ${unmatched.length ? `
        <div class="section" style="margin-top:12px">
          ${sectionHead('Jeux à associer', `<span class="note">${unmatched.length} importé${unmatched.length > 1 ? 's' : ''} sans fiche IGDB sûre</span>`)}
          <p class="muted" style="margin:0">Asobi ne fusionne jamais deux jeux sur une simple ressemblance de titre. Choisis la bonne fiche pour ces jeux.</p>
          <div class="pick-list">${unmatched.map((g) => `
            <div class="pick">${thumb(g, 'thumb--sm')}<div style="min-width:0"><strong>${esc(g.name)}</strong><small>${esc(platformMeta(g.platform).short)}${g.playtimeMinutes ? ` · ${fmtHours(g.playtimeMinutes)}` : ''}</small></div>
              <button class="btn" type="button" data-match="${esc(g.id)}">Associer</button></div>`).join('')}</div>
        </div>` : ''}
      <p class="note-line">Les jetons d'accès restent sur le serveur, chiffrés ; ils ne passent jamais par ton navigateur. Déconnecter un compte efface ses jetons et ses données brutes, pas les jeux de ta collection.</p>`;
  };

  const refresh = async (promise) => {
    try {
      data = await promise;
      draw();
    } catch (err) {
      if (err.code === 'discord_reauth') {
        toast('🔑', 'Reconnexion à Discord nécessaire', err.message, 8000);
        data ??= await fetchAccounts().catch(() => null);
        if (data) draw();
        return;
      }
      if (!data) $('#accounts', view).innerHTML = emptyState('📡', 'Comptes indisponibles', esc(err.message));
      else toast('!', 'Action impossible', err.message, 8000, { color: 'var(--st-dropped)' });
    }
  };
  if (TEST) { $('#accounts', view).innerHTML = emptyState('🔒', 'Indisponible en mode test', 'Connecte-toi avec Discord pour relier tes comptes de jeu.'); return null; }
  refresh(fetchAccounts());

  const barOf = (id) => $(`[data-account="${id}"] .job-bar`, view);
  const busy = (button, on) => { if (button) button.disabled = on; };
  const providerOf = (id) => data.providers.find((p) => p.id === id);

  view.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.closest('[data-account]')?.dataset.account;
    const account = data?.accounts.find((a) => String(a.id) === id);

    if (btn.id === 'discover') {
      busy(btn, true);
      await refresh(discoverAccounts().then((d) => { toast('↻', 'Comptes Discord relus'); return d; }));
      busy(btn, false);
      return;
    }
    if (btn.dataset.reauth !== undefined) { login('#/comptes'); return; }
    if (btn.dataset.manual) { openAdd({ platform: btn.dataset.manual }); return; }
    if (btn.dataset.match) { openMatch(btn.dataset.match, draw); return; }
    if (btn.dataset.link) { openLink(providerOf(btn.dataset.link), (d) => { data = d; draw(); }); return; }

    if (btn.dataset.enable !== undefined) {
      busy(btn, true);
      const name = providerOf(account.provider)?.name ?? 'la plateforme';
      await refresh(enableAccount(id).then((d) => { toast('✓', `Import ${name} activé`, 'Tu peux maintenant importer tes jeux.'); return d; }));
      busy(btn, false);
      return;
    }
    if (btn.dataset.sync !== undefined) {
      busy(btn, true);
      const bar = barOf(id);
      bar.hidden = false;
      try {
        const job = await runAccountJob(id, 'sync', undefined, (j) => bar.firstElementChild.style.setProperty('--v', `${j.total ? (j.progress / j.total) * 100 : 8}%`));
        toast('↻', 'Synchronisation terminée', `${job.stats.playtimeUpdated} temps de jeu et ${job.stats.achievementsUpdated} succès mis à jour.`, 6000, { color: 'var(--st-finished)' });
      } catch (err) {
        toast('!', 'Synchronisation impossible', err.message, 9000, { color: 'var(--st-dropped)' });
      }
      await refresh(fetchAccounts());
      return;
    }
    if (btn.dataset.import !== undefined) { openLibrary(providerOf(account.provider), id, () => refresh(fetchAccounts())); return; }
    if (btn.dataset.disconnect !== undefined) {
      const label = account.provider === 'discord'
        ? 'Révoquer l\'accès d\'Asobi à tes connexions Discord ? Tu resteras connecté, mais Asobi ne pourra plus retrouver tes comptes.'
        : 'Déconnecter ce compte ? Ses jetons et ses données brutes seront effacés ; les jeux déjà dans ta collection restent.';
      if (!confirm(label)) return;
      await refresh(disconnectAccount(id).then((d) => { toast('⏏', 'Compte déconnecté'); return d; }));
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
    <section class="tile provider" data-account="${account?.id ?? ''}">
      <div class="provider__head">
        <span class="provider__icon" style="background:#5865f2;color:#fff">${providerLogo('discord')}</span>
        <div><strong>Discord</strong><small>Identité · ${esc(u?.displayName ?? u?.username ?? '')}</small></div>
        <span class="state-tag" style="--c:${ok ? 'var(--st-finished)' : 'var(--st-completed)'}">${ok ? 'Accès actif' : 'À rétablir'}</span>
      </div>
      <p>${ok ? `Asobi relit tes connexions Discord pour retrouver tes comptes de jeu${account.lastSyncAt ? ` · relues le ${esc(when(account.lastSyncAt))}` : ''}.` : esc(account?.message ?? 'Accès aux connexions à rétablir.')}</p>
      <div class="actions">${ok ? '<button class="btn btn--ghost" type="button" data-disconnect>Révoquer l\'accès</button>' : '<button class="btn btn--primary" type="button" data-reauth>Reconnecter Discord</button>'}</div>
    </section>`;
}

const caps = (provider) => `<div class="caps">${CAPS.map(([k, label]) => `<span class="cap${provider.capabilities[k] ? ' is-on' : ''}">${provider.capabilities[k] ? '✓' : '✕'} ${label}</span>`).join('')}</div>`;

function cardShell(provider, inner, { account } = {}) {
  const s = account ? STATUS[account.status] ?? STATUS.detected : null;
  return `
    <article class="tile provider" ${account ? `data-account="${account.id}"` : ''}>
      <header class="provider__head">
        <span class="provider__icon">${providerLogo(provider.id)}</span>
        <div><strong>${esc(provider.name)}</strong><small>${provider.official ? 'API officielle' : provider.experimental ? 'Connecteur non officiel' : 'Détection seulement'}</small></div>
        ${s ? `<span class="state-tag${s.busy ? ' is-busy' : ''}" style="--c:${s.color}">${s.label}</span>` : provider.experimental ? '<span class="xp-tag">Expérimental</span>' : ''}
      </header>
      ${inner}
    </article>`;
}

/** Boutons d'un compte selon la plateforme et son état. */
function accountActions(provider, a) {
  const off = provider.capabilities.library && !provider.enabled;
  if (off) return `<p class="warn">Pas encore configuré sur ce serveur${SERVER_KEY[provider.id] ? ` (clé ${SERVER_KEY[provider.id]} manquante)` : ''}.</p>`;
  if (!provider.capabilities.library) {
    return [
      provider.manualImport?.length && `<button class="btn" type="button" data-manual="${esc(provider.manualImport[0])}">+ Ajouter un jeu à la main</button>`,
      '<button class="btn btn--ghost" type="button" data-disconnect>Retirer</button>',
    ].filter(Boolean).join('');
  }
  const linkable = Boolean(provider.link);
  const needsLink = linkable && a.status === 'authorization_required';
  return [
    provider.id === 'steam' && !a.verified && '<a class="btn btn--primary" href="/api/accounts/steam/openid/start">Vérifier avec Steam</a>',
    needsLink && `<button class="btn btn--primary" type="button" data-link="${esc(provider.id)}">Connecter ${esc(provider.name)}</button>`,
    a.verified && !needsLink && !ready(a) && `<button class="btn btn--primary" type="button" data-enable>${a.status === 'error' ? '↻ Réessayer' : '✓ Activer l\'import'}</button>`,
    a.verified && ready(a) && '<button class="btn btn--primary" type="button" data-import>↓ Importer des jeux</button>',
    a.verified && ready(a) && provider.capabilities.sync && '<button class="btn" type="button" data-sync>↻ Synchroniser</button>',
    linkable && !needsLink && ready(a) && `<button class="btn btn--ghost" type="button" data-link="${esc(provider.id)}">Reconnecter</button>`,
    '<button class="btn btn--ghost" type="button" data-disconnect>Déconnecter</button>',
  ].filter(Boolean).join('');
}

function accountCard(provider, a) {
  const facts = [
    a.gamesCount ? `${a.gamesCount} jeu${a.gamesCount > 1 ? 'x' : ''} sur le compte` : null,
    a.lastSyncAt && provider.capabilities.sync ? `dernière synchro le ${when(a.lastSyncAt)}` : null,
    a.lastJob?.status === 'error' ? `dernier essai : ${a.lastJob.error}` : null,
  ].filter(Boolean);
  const via = { discord: 'trouvé via Discord', openid: 'vérifié avec Steam', login: `relié sur ${provider.name}` }[a.detectedVia] ?? '';
  return cardShell(provider, `
    <div class="provider__account">
      <span>${esc(a.username ?? a.externalId)}</span>
      ${a.verified ? '<span class="verified">✓ vérifié</span>' : '<span class="unverified">non vérifié</span>'}
      ${via ? `<small>${esc(via)}</small>` : ''}
    </div>
    ${facts.length ? `<p class="provider__facts">${facts.map(esc).join(' · ')}</p>` : ''}
    ${caps(provider)}
    <p>${esc(provider.capabilities.library ? a.message ?? provider.limitations ?? '' : provider.limitations ?? '')}</p>
    ${provider.capabilities.sync && ready(a) ? `<label class="check"><input type="checkbox" data-autosync${a.autoSync ? ' checked' : ''}> Synchroniser automatiquement toutes les 12 h</label>` : ''}
    <div class="bar job-bar" hidden><i style="--v:5%"></i></div>
    <div class="actions">${accountActions(provider, a)}</div>`, { account: a });
}

function placeholderCard(provider) {
  let action = '';
  let hint = provider.limitations ?? '';
  if (provider.capabilities.library && !provider.enabled) {
    action = `<p class="warn">Pas encore configuré sur ce serveur${SERVER_KEY[provider.id] ? ` (clé ${SERVER_KEY[provider.id]} manquante)` : ''}.</p>`;
  } else if (provider.id === 'steam') {
    action = '<a class="btn btn--primary" href="/api/accounts/steam/openid/start">Relier mon compte Steam</a>';
    hint = 'Aucun compte Steam dans tes connexions Discord. Relie-le directement : Steam confirmera qu\'il est à toi.';
  } else if (provider.link) {
    action = `<button class="btn btn--primary" type="button" data-link="${esc(provider.id)}">Connecter ${esc(provider.name)}</button>`;
  } else if (provider.capabilities.library) {
    hint = `Aucun compte ${provider.name} dans tes connexions Discord. Relie-le dans Discord (Paramètres → Connexions), puis « Découvrir mes comptes ». ${provider.limitations ?? ''}`;
  }
  const manual = provider.manualImport?.length ? `<button class="btn btn--ghost" type="button" data-manual="${esc(provider.manualImport[0])}">+ À la main</button>` : '';
  return cardShell(provider, `
    ${caps(provider)}
    <p>${esc(hint)}</p>
    <div class="actions">${action}${manual}</div>`);
}

/* ---------- Liaison directe : Epic (code collé) ---------- */

const LINK_STEPS = {
  epicgames: {
    open: 'Ouvrir epicgames.com ↗',
    steps: [
      'Ouvre la page de connexion Epic et connecte-toi avec ton compte.',
      'La page affiche un petit texte qui contient <code>"authorizationCode"</code> suivi de 32 caractères.',
      'Copie ce code (ou tout le texte) et colle-le ci-dessous.',
    ],
    placeholder: 'Code Epic (32 caractères) ou tout le texte affiché',
    note: 'Connecteur non officiel, comme les lanceurs libres Legendary et Heroic. Le code ne sert qu\'une fois et expire en quelques minutes ; Asobi ne voit jamais ton mot de passe.',
  },
};

function openLink(provider, onLinked) {
  const conf = LINK_STEPS[provider.id];
  const { el, close } = openModal(`
    <h2 class="modal__title">Connecter ${esc(provider.name)}</h2>
    <ol class="steps">${conf.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    <button class="btn" type="button" id="link-open">${esc(conf.open)}</button>
    <label class="field"><span class="field__label">À coller ici</span><input class="input" id="link-code" autocomplete="off" spellcheck="false" placeholder="${esc(conf.placeholder)}"></label>
    <p class="warn warn--error" id="link-error" hidden></p>
    <p class="note-line">${esc(conf.note)}</p>
    <div class="modal__actions">
      <button class="btn btn--ghost" type="button" data-close>Annuler</button>
      <button class="btn btn--primary" type="button" id="link-go" disabled>Connecter</button>
    </div>`);
  const input = $('#link-code', el);
  const go = $('#link-go', el);
  const error = (msg) => { $('#link-error', el).textContent = msg; $('#link-error', el).hidden = !msg; input.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
  $('#link-open', el).addEventListener('click', async () => {
    // Fenêtre ouverte tout de suite (sinon bloquée), puis envoyée à l'adresse donnée par le serveur
    const win = window.open('about:blank', '_blank');
    try {
      const { url } = await linkStart(provider.id);
      if (win && safeUrl(url)) { win.opener = null; win.location.href = url; } else if (safeUrl(url)) location.assign(url);
      setTimeout(() => input.focus(), 300);
    } catch (err) {
      win?.close();
      error(err.message);
    }
  });
  input.addEventListener('input', () => { go.disabled = !input.value.trim(); error(''); });
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.innerHTML = '<span class="spinner"></span>Connexion…';
    try {
      const data = await linkFinish(provider.id, input.value.trim());
      close();
      confetti();
      toast('✓', `${provider.name} connecté`, 'Tu peux maintenant importer tes jeux.', 6000, { color: 'var(--st-finished)' });
      onLinked(data);
    } catch (err) {
      error(err.message);
      go.disabled = false;
      go.textContent = 'Connecter';
    }
  });
}

/* ---------- Import : choix des jeux de la bibliothèque ---------- */

async function openLibrary(provider, accountId, onDone) {
  const pc = provider.id === 'steam' || provider.id === 'epicgames';
  const { el, close } = openModal(`
    <h2 class="modal__title">Importer depuis ${esc(provider.name)}</h2>
    <p class="modal__lead" id="lib-lead">Les jeux de ton compte qui ne sont pas encore dans ta collection. ${pc ? 'Ils seront rangés dans PC' : 'Chacun sera rangé sur sa console'}, avec leur temps de jeu${provider.capabilities.achievements ? ' et leurs succès' : ''}.</p>
    <div id="lib"><div class="skeleton" style="height:240px"></div></div>
    <div class="bar" id="lib-progress" hidden><i style="--v:5%"></i></div>
    <div class="modal__actions">
      <button class="btn btn--ghost" type="button" data-close>Fermer</button>
      <button class="btn btn--primary" type="button" id="lib-go" disabled>Importer</button>
    </div>`, { wide: true });

  let games = [];
  try {
    games = await accountLibrary(accountId);
  } catch (err) {
    $('#lib', el).innerHTML = `<p class="warn warn--error">${esc(err.message)}</p>`;
    return;
  }
  if (!games.length) { $('#lib', el).innerHTML = `<p class="muted">Tous tes jeux ${esc(provider.name)} sont déjà dans ta collection 🎉</p>`; return; }

  $('#lib-lead', el).insertAdjacentText('afterbegin', `${games.length} jeu${games.length > 1 ? 'x' : ''} trouvé${games.length > 1 ? 's' : ''}. `);
  $('#lib', el).innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <button class="chip" type="button" data-select="played">Tous ceux joués</button>
      <button class="chip" type="button" data-select="all">Tout (${games.length})</button>
      <button class="chip" type="button" data-select="none">Aucun</button>
    </div>
    <div class="lib">${games.map((g) => `
      <label class="check">
        <input type="checkbox" value="${esc(g.id)}">
        ${safeUrl(g.icon) ? `<img src="${esc(g.icon)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
        <span>${esc(g.name)}</span>
        <small>${g.platform && !pc ? `${esc(platformMeta(g.platform).short)} · ` : ''}${g.playtimeMinutes ? fmtHours(g.playtimeMinutes) : 'jamais lancé'}</small>
      </label>`).join('')}</div>`;

  const go = $('#lib-go', el);
  const update = () => {
    const n = $$('.lib input:checked', el).length;
    go.disabled = !n;
    go.textContent = n ? `Importer ${n} jeu${n > 1 ? 'x' : ''}` : 'Importer';
  };
  el.addEventListener('change', update);
  el.addEventListener('click', (e) => {
    const sel = e.target.closest('[data-select]')?.dataset.select;
    if (!sel) return;
    $$('.lib input', el).forEach((input, i) => { input.checked = sel === 'all' || (sel === 'played' && games[i].playtimeMinutes > 0); });
    update();
  });

  go.addEventListener('click', async () => {
    const ids = $$('.lib input:checked', el).map((input) => input.value);
    go.disabled = true;
    const bar = $('#lib-progress', el);
    bar.hidden = false;
    try {
      const job = await runAccountJob(accountId, 'import', { ids }, (j) => {
        bar.firstElementChild.style.setProperty('--v', `${j.total ? (j.progress / j.total) * 100 : 5}%`);
        go.innerHTML = `<span class="spinner"></span>${j.total ? `Import ${j.progress}/${j.total}…` : 'Préparation…'}`;
      });
      close();
      const s = job.stats;
      const n = s.added + s.unmatched;
      confetti();
      toast('↓', `${n} jeu${n > 1 ? 'x' : ''} importé${n > 1 ? 's' : ''}`,
        `${s.linked ? `${s.linked} relié${s.linked > 1 ? 's' : ''} à des jeux déjà présents. ` : ''}${s.unmatched ? `${s.unmatched} à associer à la main. ` : ''}${s.failed ? `${s.failed} en échec.` : ''}`, 9000, { color: 'var(--st-finished)' });
    } catch (err) {
      toast('!', 'Import interrompu', err.message, 9000, { color: 'var(--st-dropped)' });
      go.disabled = false;
      go.textContent = 'Importer';
    }
    onDone?.();
  });
}

/* ---------- Association manuelle d'un jeu importé ---------- */

function openMatch(gameId, onDone) {
  const game = state.games.find((g) => g.id === gameId);
  const { el, close } = openModal(`
    <h2 class="modal__title">Associer « ${esc(game?.name ?? '')} »</h2>
    <p class="modal__lead">Choisis la fiche IGDB qui correspond vraiment à ce jeu. Tes notes, ton statut et ton temps de jeu sont conservés.</p>
    <div class="search">
      <span class="search__icon" aria-hidden="true">⌕</span>
      <input class="input" id="match-q" value="${esc(game?.name ?? '')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="match-suggest" aria-label="Rechercher la fiche">
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
      toast('!', 'Association impossible', err.message, 8000, { color: 'var(--st-dropped)' });
    }
  });
  let timer = 0;
  const suggest = async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.close(); return; }
    try { results = await searchIgdb(q); } catch { results = []; }
    if (input.value.trim() !== q) return;
    box.open(results.length ? results.map((r, i) => `
      <li role="option" id="ms-${i}" class="suggest__item" data-index="${i}" aria-selected="false">
        ${safeUrl(r.cover) ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : '<span class="suggest__ph"></span>'}
        <span class="suggest__text"><strong>${highlight(r.name, q)}</strong><small>${esc([r.year, r.platforms.slice(0, 4).join(', ')].filter(Boolean).join(' · '))}</small></span>
      </li>`).join('') : `<li class="suggest__empty">Aucun jeu trouvé pour « ${esc(q)} ».</li>`);
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(suggest, 220); });
  setTimeout(() => { input.focus(); input.select(); suggest(); }, 60);
}
