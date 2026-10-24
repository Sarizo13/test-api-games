// Connexion : un mur de jaquettes qui défile derrière un panneau « Se connecter avec Discord ».
// Les jaquettes viennent de l'actualité IGDB et de la collection de démonstration (aucune donnée personnelle).

import { state, login, fetchToday } from '../state.js';
import { providerLogo } from '../brands.js';
import { esc, safeUrl } from '../util.js';

const COLUMNS = 8;

async function wallCovers() {
  const [today, demo] = await Promise.allSettled([
    fetchToday(),
    fetch('/data/test-games.json').then((r) => (r.ok ? r.json() : { games: [] })),
  ]);
  const fromFeed = today.status === 'fulfilled' ? [...today.value.recent, ...today.value.upcoming, ...today.value.onThisDay].map((s) => s.cover) : [];
  const fromDemo = demo.status === 'fulfilled' ? (demo.value.games ?? []).map((g) => g.images?.gridThumb || g.images?.grid || g.images?.cover) : [];
  return [...new Set([...fromDemo, ...fromFeed].map(safeUrl).filter(Boolean))];
}

export function renderLogin(view) {
  view.innerHTML = `
    <section class="login" aria-label="Connexion">
      <div class="login__wall" aria-hidden="true">${Array.from({ length: COLUMNS }, () => '<div class="login__col"></div>').join('')}</div>
      <div class="login__veil"></div>
      <div class="login__panel">
        <div class="login__brand"><span class="logo__mark" aria-hidden="true">遊</span><div><strong>ASOBI</strong><small>« jouer », en japonais</small></div></div>
        <p>Ta collection de jeux vidéo, console par console, en cartes à collectionner. Note, range, suis ta progression et retrouve tes comptes Steam, PlayStation, Xbox, Epic et Nintendo.</p>
        ${state.discordConfigured ? '' : '<p class="warn">La connexion Discord n\'est pas encore configurée sur ce serveur.</p>'}
        <button class="btn btn--discord" type="button" id="login-discord"${state.discordConfigured ? '' : ' disabled'}>${providerLogo('discord', 'btn-logo')}Se connecter avec Discord</button>
        <p class="login__note">Asobi ne lit que ton pseudo, ton avatar et la liste des comptes reliés à ton Discord. Aucun mot de passe, aucun e-mail. Ta collection reste privée tant que tu ne la partages pas.</p>
      </div>
    </section>`;
  view.querySelector('#login-discord').addEventListener('click', () => login());

  let alive = true;
  wallCovers().then((covers) => {
    if (!alive || !covers.length) return;
    // Chaque colonne reçoit une suite de jaquettes, doublée pour un défilement sans couture
    const cols = view.querySelectorAll('.login__col');
    cols.forEach((col, c) => {
      const list = Array.from({ length: 7 }, (_, i) => covers[(c * 5 + i * 3) % covers.length]);
      col.style.animationDuration = `${46 + ((c * 7) % 21)}s`;
      col.innerHTML = [...list, ...list].map((src) => `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`).join('');
    });
  }).catch(() => {});
  return () => { alive = false; };
}
