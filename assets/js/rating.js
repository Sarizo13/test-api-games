// Note sur 10 par demi-points : dix cases (.rating__track, role=slider) remplies à moitié pour les demi-points.
// Pointeur : glisser ou toucher (valeur = arrondi au demi-point de x/largeur·10 + 0,25).
// Clavier : ← → ±0,5, ↑ ↓ ±1, Début / Fin, Suppr pour effacer.

import { $$, clamp } from './util.js';

const fmt = (v) => (v == null ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));

export const ratingRow = (key, label) => `
  <div class="rating__row">
    <span>${label}</span>
    <div class="rating__track" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="0" aria-valuemax="10" data-rating="${key}">${'<i></i>'.repeat(10)}</div>
    <span class="rating__value" data-out="${key}">—</span>
  </div>`;

/** Affiche la valeur `v` (ou null : pas encore noté) sur une piste et dans sa sortie. */
export function paintRating(track, out, v) {
  track.dataset.empty = v == null ? '1' : '';
  $$('i', track).forEach((cell, i) => cell.style.setProperty('--f', `${v == null ? 0 : clamp(v - i, 0, 1) * 100}%`));
  track.setAttribute('aria-valuenow', v ?? 0);
  track.setAttribute('aria-valuetext', v == null ? 'pas encore noté' : `${fmt(v)} sur 10`);
  if (out) out.textContent = fmt(v);
}

/**
 * Rend les pistes de `root` interactives.
 *  - canEdit() : false → rien ne bouge (et l'appelant peut demander la connexion)
 *  - preview(key, v) : pendant le geste ; commit(key, v) : au relâchement ; cancel(key) : geste abandonné
 */
export function bindRatings(root, { canEdit, preview, commit, cancel }) {
  let drag = null;
  const valueAt = (track, clientX) => {
    const r = track.getBoundingClientRect();
    return clamp(Math.round((((clientX - r.left) / r.width) * 10 + 0.25) * 2) / 2, 0, 10);
  };

  root.addEventListener('pointerdown', (e) => {
    const track = e.target.closest('.rating__track');
    if (!track || e.button > 0 || !canEdit()) return;
    e.preventDefault();
    track.focus({ preventScroll: true });
    track.setPointerCapture(e.pointerId);
    drag = { track, id: e.pointerId, value: valueAt(track, e.clientX) };
    preview(track.dataset.rating, drag.value);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const v = valueAt(drag.track, e.clientX);
    if (v !== drag.value) { drag.value = v; preview(drag.track.dataset.rating, v); }
  });
  const end = (e, keep) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (keep) commit(drag.track.dataset.rating, drag.value);
    else cancel(drag.track.dataset.rating); // le doigt est parti faire défiler la page
    drag = null;
  };
  root.addEventListener('pointerup', (e) => end(e, true));
  root.addEventListener('pointercancel', (e) => end(e, false));

  // Clavier : chaque appui prévisualise, l'enregistrement part après une courte pause
  const timers = new Map();
  root.addEventListener('keydown', (e) => {
    const track = e.target.closest('.rating__track');
    if (!track) return;
    const now = track.dataset.empty ? null : Number(track.getAttribute('aria-valuenow'));
    const steps = { ArrowRight: 0.5, ArrowLeft: -0.5, ArrowUp: 1, ArrowDown: -1 };
    let v;
    if (e.key in steps) v = clamp((now ?? 0) + steps[e.key], 0, 10);
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = 10;
    else if (e.key === 'Delete' || e.key === 'Backspace') v = null;
    else return;
    e.preventDefault();
    if (!canEdit()) return;
    const key = track.dataset.rating;
    preview(key, v);
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => commit(key, v), 600));
  });
}
