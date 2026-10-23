// Petits graphiques en SVG/HTML : anneau, barres, radar. Les valeurs s'animent à l'apparition.

import { esc } from './util.js';

/** Anneau : segments [{ label, value, color }]. */
export function donut(segments, { center = '', sub = '' } = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * c;
    const arc = `<circle class="seg" cx="75" cy="75" r="${r}" stroke="${s.color}" stroke-dasharray="0 ${c}" data-dash="${len} ${c - len}" stroke-dashoffset="${-offset}"><title>${esc(s.label)} : ${s.value}</title></circle>`;
    offset += len;
    return arc;
  }).join('');
  return `
    <div class="donut-wrap">
      <div style="position:relative">
        <svg class="donut" viewBox="0 0 150 150"><circle cx="75" cy="75" r="${r}" stroke="rgba(255,255,255,.06)"/>${arcs}</svg>
        <div class="donut-center" style="top:0;left:0"><div><b>${esc(center)}</b><br><small>${esc(sub)}</small></div></div>
      </div>
      <div class="legend">${segments.map((s) => `<div><i style="--c:${s.color}"></i>${esc(s.label)}<span>${s.value}</span></div>`).join('')}</div>
    </div>`;
}

/** Barres horizontales : items [{ label, value, color, display }]. */
export function bars(items, { max } = {}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return `<div class="bars">${items.map((i) => `
    <div class="bar-row">
      <span title="${esc(i.label)}">${esc(i.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="--c:${i.color ?? 'var(--grad)'}" data-w="${Math.round((i.value / top) * 100)}%"></div></div>
      <b>${esc(i.display ?? i.value)}</b>
    </div>`).join('')}</div>`;
}

/** Radar des notes : values [{ label, value (0–10 ou null) }]. */
export function radar(values) {
  const n = values.length;
  const cx = 95;
  const cy = 95;
  const R = 62;
  const point = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  };
  const ring = (v) => values.map((_, i) => point(i, v).join(',')).join(' ');
  const shape = values.map((x, i) => point(i, (x.value ?? 0) / 10).join(',')).join(' ');
  const rated = values.filter((x) => x.value != null);
  const average = rated.length ? (rated.reduce((a, x) => a + x.value, 0) / rated.length).toFixed(1).replace('.', ',') : '—';
  const labels = values.map((x, i) => {
    const [x2, y2] = point(i, 1.32);
    return `<text x="${x2}" y="${y2}" text-anchor="middle" dominant-baseline="middle">${esc(x.label)}</text>`;
  }).join('');
  return `
    <svg class="radar" viewBox="0 0 190 190" role="img" aria-label="Notes : moyenne ${average} sur 10">
      ${[0.25, 0.5, 0.75, 1].map((v) => `<polygon class="grid" points="${ring(v)}"/>`).join('')}
      <polygon class="shape" points="${shape}"/>
      ${labels}
      <text class="avg" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle">${average}</text>
    </svg>`;
}

/** Lance les animations des graphiques présents dans `root`. */
export function animateCharts(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('[data-dash]').forEach((el) => el.setAttribute('stroke-dasharray', el.dataset.dash));
    root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w; });
    root.querySelectorAll('[data-p]').forEach((el) => el.style.setProperty('--p', el.dataset.p));
  }));
}
