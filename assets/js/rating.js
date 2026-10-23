// Barre de note sur 10, par demi-points : dix segments qu'on touche ou qu'on balaie du doigt,
// ou qu'on règle au clavier (flèches, Début/Fin, Suppr pour effacer).

import { $$, clamp } from './util.js';

const STOPS = ['#8b5cf6', '#22d3ee', '#fbbf24']; // violet → cyan → or, comme les raretés qui montent

const mix = (a, b, t) => {
  const [x, y] = [a, b].map((c) => c.match(/\w\w/g).map((h) => parseInt(h, 16)));
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
/** Couleur d'une note (0–10) le long du dégradé. */
export const ratingColor = (v) => {
  const t = clamp(v / 10, 0, 1) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  return mix(STOPS[i], STOPS[i + 1], t - i);
};

const fmt = (v) => (v == null ? '—' : String(v).replace('.', ','));

export const ratingBar = (key, label) => `
  <div class="rate" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="0" aria-valuemax="10" data-rating="${key}">
    ${Array.from({ length: 10 }, (_, i) => `<i style="--c:${ratingColor(i + 1)}"></i>`).join('')}
  </div>`;

/** Affiche la valeur `v` (ou null : pas encore noté) sur une barre et dans sa sortie. */
export function paintRating(bar, out, v) {
  bar.classList.toggle('is-empty', v == null);
  $$('i', bar).forEach((seg, i) => seg.style.setProperty('--f', v == null ? 0 : clamp(v - i, 0, 1)));
  bar.setAttribute('aria-valuenow', v ?? 0);
  bar.setAttribute('aria-valuetext', v == null ? 'pas encore noté' : `${fmt(v)} sur 10`);
  if (out) {
    out.textContent = fmt(v);
    out.style.color = v == null ? '' : ratingColor(v);
  }
}

/**
 * Rend les barres de `root` interactives.
 *  - canEdit() : false → rien ne bouge (et l'appelant peut demander la connexion)
 *  - preview(key, v) : pendant le geste ; commit(key, v) : au relâchement ; cancel(key) : geste abandonné
 */
export function bindRatings(root, { canEdit, preview, commit, cancel }) {
  let drag = null;

  const valueAt = (bar, clientX) => {
    const r = bar.getBoundingClientRect();
    return clamp(Math.ceil(((clientX - r.left) / r.width) * 20) / 2, 0.5, 10);
  };

  root.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('.rate');
    if (!bar || e.button > 0 || !canEdit()) return;
    e.preventDefault();
    bar.focus({ preventScroll: true });
    bar.setPointerCapture(e.pointerId);
    drag = { bar, id: e.pointerId, value: valueAt(bar, e.clientX) };
    bar.classList.add('is-dragging');
    preview(bar.dataset.rating, drag.value);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const v = valueAt(drag.bar, e.clientX);
    if (v !== drag.value) { drag.value = v; preview(drag.bar.dataset.rating, v); }
  });
  const end = (e, keep) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.bar.classList.remove('is-dragging');
    if (keep) commit(drag.bar.dataset.rating, drag.value);
    else cancel(drag.bar.dataset.rating); // le doigt est parti faire défiler la page
    drag = null;
  };
  root.addEventListener('pointerup', (e) => end(e, true));
  root.addEventListener('pointercancel', (e) => end(e, false));

  // Clavier : chaque appui prévisualise, l'enregistrement part après une courte pause
  const timers = new Map();
  root.addEventListener('keydown', (e) => {
    const bar = e.target.closest('.rate');
    if (!bar) return;
    const now = bar.classList.contains('is-empty') ? null : Number(bar.getAttribute('aria-valuenow'));
    const steps = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5, PageUp: 2, PageDown: -2 };
    let v;
    if (e.key in steps) v = clamp((now ?? 0) + steps[e.key], 0, 10);
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = 10;
    else if (e.key === 'Delete' || e.key === 'Backspace') v = null;
    else return;
    e.preventDefault();
    if (!canEdit()) return;
    const key = bar.dataset.rating;
    preview(key, v);
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => commit(key, v), 600));
  });
}
