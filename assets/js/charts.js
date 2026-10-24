// Petits graphiques du design : anneau des statuts (.donut), barres horizontales (.hbars), radar des notes.

import { esc } from './util.js';
import { STATUS } from './card.js';

/** Anneau des statuts : `counts` = { playing, finished, completed, dropped, backlog }. */
export function statusDonut(counts) {
  const count = Object.values(counts).reduce((a, b) => a + b, 0);
  let acc = 0;
  const stop = (k) => { acc += ((counts[k] ?? 0) / (count || 1)) * 100; return `${acc}%`; };
  const [a, b, c, d] = ['playing', 'finished', 'completed', 'dropped'].map(stop);
  return `
    <div class="donut-wrap">
      <div class="donut-box"><div class="donut" style="--a:${a};--b:${b};--c:${c};--d:${d}"></div><b>${count}</b></div>
      <div class="legend">${Object.entries(STATUS).map(([k, s]) => `<span><i style="--c:${s.color}"></i>${esc(s.label)}<em>${counts[k] ?? 0}</em></span>`).join('')}</div>
    </div>`;
}

/** Barres horizontales : items [{ label, value, color, display }]. */
export function bars(items, { max } = {}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">${items.map((i) => `
    <div class="hbars__row">
      <span>${esc(i.label)}<em>${esc(i.display ?? i.value)}</em></span>
      <div class="bar"><i data-v="${Math.round((i.value / top) * 100)}%"${i.color ? ` style="--c:${i.color}"` : ''}></i></div>
    </div>`).join('')}</div>`;
}

/** Radar des notes : values [{ label, value (0–10 ou null) }], moyenne au centre. */
export function radar(values) {
  const n = values.length;
  const cx = 130;
  const cy = 120;
  const R = 84;
  const point = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  };
  const ring = (v) => values.map((_, i) => point(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const shape = values.map((x, i) => point(i, (x.value ?? 0) / 10).map((c) => c.toFixed(1)).join(',')).join(' ');
  const rated = values.filter((x) => x.value != null);
  const average = rated.length ? (rated.reduce((a, x) => a + x.value, 0) / rated.length).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—';
  const labels = values.map((x, i) => {
    const [x2, y2] = point(i, 1.2);
    return `<text x="${x2.toFixed(1)}" y="${y2.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(x.label)}</text>`;
  }).join('');
  return `
    <div class="radar" role="img" aria-label="Notes : moyenne ${average} sur 10">
      <svg viewBox="0 0 260 240">
        ${[0.25, 0.5, 0.75, 1].map((v) => `<polygon class="grid" points="${ring(v)}"/>`).join('')}
        <polygon class="data" points="${shape}"/>
        ${labels}
      </svg>
      <div class="radar__avg"><div>${average}<small>moyenne</small></div></div>
    </div>`;
}

/** Lance les animations des barres présentes dans `root` (largeur 0 → valeur). */
export function animateCharts(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('[data-v]').forEach((el) => el.style.setProperty('--v', el.dataset.v));
  }));
}
