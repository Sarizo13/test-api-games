// Accueil des visiteurs non connectés : ce qu'est Asobi, connexion avec Discord.

import { state, login } from '../state.js';
import { providerLogo } from '../brands.js';
import { esc } from '../util.js';

const FEATURES = [
  ['🃏', 'Chaque jeu devient une carte', 'Ta note, ton temps de jeu et tes trophées décident de sa rareté, de commune à mythique.'],
  ['🗂️', 'Rangé console par console', 'Un dossier par console, du NES à la PS5, avec les visuels d\'IGDB et SteamGridDB.'],
  ['🔗', 'Tes comptes retrouvés via Discord', 'Steam, Xbox, PlayStation… Steam importe ta bibliothèque, tes heures et tes succès.'],
  ['🎰', 'Plus d\'excuse pour la pile de la honte', 'Roulette parmi tes jeux jamais lancés, suggestions « Pour toi » et liste « à jouer ».'],
];

export function renderLanding(view, { error } = {}) {
  view.innerHTML = `
    <section class="landing">
      <div class="landing-hero">
        <img class="landing-logo" src="/assets/img/logo.svg" alt="" width="88" height="88">
        <p class="kicker">遊び · jouer</p>
        <h1>Ta collection de jeux,<br><span>en cartes à collectionner.</span></h1>
        <p class="landing-lead">Range tes jeux, note-les, suis ta progression et retrouve tes comptes de jeu. Ta collection reste privée tant que tu ne la partages pas.</p>
        ${error ? `<p class="modal-warning">${esc(error)}</p>` : ''}
        ${state.discordConfigured ? '' : '<p class="modal-warning">La connexion Discord n\'est pas encore configurée sur ce serveur.</p>'}
        <div class="chips landing-actions">
          <button class="btn btn-primary btn-discord btn-lg" type="button" id="landing-login"${state.discordConfigured ? '' : ' disabled'}>${providerLogo('discord', 'btn-logo')}Se connecter avec Discord</button>
        </div>
        <p class="source-note">Asobi ne lit que ton pseudo, ton avatar et la liste des comptes reliés à ton Discord. Aucun mot de passe, aucun e-mail.</p>
      </div>
      <div class="landing-features">${FEATURES.map(([icon, title, text], i) => `
        <div class="panel landing-feature" style="--i:${i}"><span>${icon}</span><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`).join('')}
      </div>
    </section>`;
  view.querySelector('#landing-login').addEventListener('click', () => login());
  return null;
}
