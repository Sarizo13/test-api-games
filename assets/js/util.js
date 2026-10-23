// Petits outils partagés par toutes les pages.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');
// Guillemets simples : la valeur finit souvent dans un attribut style="…"
export const cssUrl = (u) => (safeUrl(u) ? `url('${safeUrl(u).replace(/'/g, '%27').replace(/"/g, '%22')}')` : 'none');
export const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
export const sum = (list) => list.reduce((a, b) => a + b, 0);
export const avg = (list) => (list.length ? sum(list) / list.length : null);

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- Stockage local (préférences de cet appareil) ---------- */

export const local = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`ludotheque:${key}`)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`ludotheque:${key}`, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  },
};

/* ---------- Dates et durées ---------- */

export function fmtDate(iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', opts);
}

export const year = (iso) => (iso ? iso.slice(0, 4) : '');

export function fmtHours(minutes) {
  if (minutes == null) return '—';
  const h = minutes / 60;
  if (h < 1) return `${Math.round(minutes)} min`;
  return h < 10 ? `${h.toFixed(1).replace('.', ',')} h` : `${Math.round(h)} h`;
}

export function daysUntil(iso) {
  if (!iso) return null;
  const day = 86400000;
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / day);
}

export function countdown(iso) {
  const d = daysUntil(iso);
  if (d == null) return 'Date inconnue';
  if (d > 1) return `Dans ${d} jours`;
  if (d === 1) return 'Demain';
  if (d === 0) return 'Aujourd\'hui';
  return 'Déjà sorti';
}

/* ---------- Animations ---------- */

export function countUp(el, to, { decimals = 0, suffix = '' } = {}) {
  const format = (v) => `${v.toFixed(decimals).replace('.', ',')}${suffix}`;
  if (reduceMotion || !to) { el.textContent = format(to || 0); return; }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / 1000);
    el.textContent = format(to * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function confetti(x = innerWidth / 2, y = innerHeight / 2) {
  if (reduceMotion) return;
  const colors = ['#8b5cf6', '#22d3ee', '#f472b6', '#fbbf24', '#34d399'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    const angle = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 260;
    c.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist + 160}px;--r:${Math.random() * 720 - 360}deg;animation-delay:${Math.random() * 120}ms`;
    document.body.append(c);
    setTimeout(() => c.remove(), 1700);
  }
}

/* ---------- Fond d'ambiance (image floutée de ce qu'on regarde) ---------- */

let ambientIndex = 0;
let ambientUrl = '';

export function setAmbient(url) {
  if (!safeUrl(url) || url === ambientUrl) return;
  ambientUrl = url;
  const layers = $$('.backdrop .ambient');
  const next = layers[ambientIndex = 1 - ambientIndex];
  const prev = layers[1 - ambientIndex];
  const img = new Image();
  img.onload = () => {
    if (ambientUrl !== url) return;
    next.style.backgroundImage = cssUrl(url);
    next.classList.add('is-visible');
    prev.classList.remove('is-visible');
  };
  img.src = url;
}

/* ---------- Notifications ---------- */

export function toast(icon, title, text = '', ms = 5000, link = null) {
  const el = document.createElement('div');
  el.className = 'toast';
  const more = link && safeUrl(link.href) ? ` <a href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)}</a>` : '';
  el.innerHTML = `<span class="toast-icon">${icon}</span><div><strong>${esc(title)}</strong>${esc(text)}${more}</div>`;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

/* ---------- Fenêtres (modales) ---------- */

/** Ouvre une fenêtre ; renvoie { el, close }. Échap, clic à côté et [data-close] la ferment. */
export function openModal(html, { onClose, wide = false } = {}) {
  const lastFocus = document.activeElement;
  const el = document.createElement('div');
  el.className = 'modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="modal-backdrop" data-close></div>
    <div class="modal-panel"${wide ? ' style="max-width:820px"' : ''}>
      <button class="icon-btn modal-close" type="button" data-close aria-label="Fermer">${ICONS.close}</button>
      ${html}
    </div>`;
  $('#modals').append(el);
  document.body.classList.add('modal-open');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    el.classList.add('is-closing');
    setTimeout(() => {
      el.remove();
      if (!$('#modals').children.length) document.body.classList.remove('modal-open');
      lastFocus?.focus?.({ preventScroll: true });
      onClose?.();
    }, reduceMotion ? 0 : 230);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && el === $('#modals').lastElementChild) { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  return { el, close };
}

/* ---------- Liste de propositions sous un champ (flèches, Entrée, Échap, clic) ---------- */

export function highlight(name, query) {
  const q = query.trim();
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return esc(name);
  return `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, i + q.length))}</mark>${esc(name.slice(i + q.length))}`;
}

export function listbox(input, list, onPick) {
  let active = -1;
  const options = () => $$('[role="option"]', list);
  const setActive = (i) => {
    const all = options();
    if (!all.length) return;
    active = (i + all.length) % all.length;
    all.forEach((el, n) => el.classList.toggle('is-active', n === active));
    all[active].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', all[active].id);
  };
  const box = {
    open(html) {
      list.innerHTML = html;
      list.hidden = false;
      active = -1;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
    },
    close() {
      list.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    },
    get isOpen() { return !list.hidden; },
    get active() { return active; },
  };
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active < 0 ? -1 : active - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); onPick(options()[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); box.close(); }
  });
  input.addEventListener('blur', () => box.close());
  list.addEventListener('mousedown', (e) => e.preventDefault()); // le champ garde le focus (sinon la liste se ferme avant le clic)
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[role="option"]');
    if (li) onPick(li);
  });
  return box;
}

/* ---------- Mode diagnostic : ajouter ?debug à l'adresse ---------- */

export const DEBUG = new URLSearchParams(location.search).has('debug');
const debugLines = [];

export function dbg(message) {
  if (!DEBUG) return;
  debugLines.push(`${(performance.now() / 1000).toFixed(2)}s  ${message}`);
  if (debugLines.length > 16) debugLines.shift();
}

if (DEBUG) {
  const box = document.createElement('pre');
  box.className = 'debug-box';
  document.body.append(box);
  const tick = () => {
    box.textContent = `horloge ${(performance.now() / 1000).toFixed(2)}s\n${debugLines.join('\n')}`;
    requestAnimationFrame(tick);
  };
  tick();
}

/* ---------- Icônes ---------- */

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

export const ICONS = {
  home: svg('M12 3 3 10.5V21h6.5v-6h5v6H21V10.5zm0 2.6 7 5.4V19h-2.5v-6h-9v6H5v-8z'),
  folder: svg('M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm2 0v12h14V8h-7.8l-2-2z'),
  list: svg('M4 6h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8z'),
  compass: svg('M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm4.2 3.8-2.6 5.8-5.8 2.6 2.6-5.8zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'),
  user: svg('M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm0 9c4.4 0 8 2.2 8 5v2H4v-2c0-2.8 3.6-5 8-5zm0 2c-3.4 0-6 1.5-6 3h12c0-1.5-2.6-3-6-3z'),
  plus: svg('M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z'),
  close: svg('M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z'),
  star: svg('m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z'),
  heart: svg('M12 20.5 10.6 19.2C5.4 14.5 2 11.4 2 7.6 2 4.5 4.4 2 7.5 2c1.7 0 3.4.8 4.5 2.1C13.1 2.8 14.8 2 16.5 2 19.6 2 22 4.5 22 7.6c0 3.8-3.4 6.9-8.6 11.6z'),
  play: svg('M8 5v14l11-7z'),
  trash: svg('M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7zm4 2v8h2v-8zm4 0v8h2v-8z'),
  up: svg('m12 7 6 6-1.4 1.4L12 9.8l-4.6 4.6L6 13z'),
  down: svg('m12 17-6-6 1.4-1.4 4.6 4.6 4.6-4.6L18 11z'),
  grip: svg('M9 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z'),
  edit: svg('m14.1 5.1 4.8 4.8L8.8 20H4v-4.8zm1.4-1.4 1.6-1.6a1.5 1.5 0 0 1 2.1 0l2.7 2.7a1.5 1.5 0 0 1 0 2.1l-1.6 1.6z'),
  dice: svg('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z'),
  steam: svg('M12 2a10 10 0 0 0-9.9 8.6l5.3 2.2a2.8 2.8 0 0 1 1.7-.5l2.4-3.4v-.1a3.7 3.7 0 1 1 3.7 3.7h-.1l-3.4 2.4v.2a2.8 2.8 0 0 1-5.5.6l-3.8-1.6A10 10 0 1 0 12 2zM8.3 17.2l-1.2-.5a2.1 2.1 0 1 0 1.2-2.8l1.3.5a1.5 1.5 0 1 1-1.3 2.8zm8.6-6.8a2.4 2.4 0 1 0-4.9 0 2.4 2.4 0 0 0 4.9 0zm-4.3 0a1.8 1.8 0 1 1 3.7 0 1.8 1.8 0 0 1-3.7 0z'),
  download: svg('M11 4h2v8.2l3.3-3.3 1.4 1.4L12 16 6.3 10.3l1.4-1.4 3.3 3.3zM5 18h14v2H5z'),
  lock: svg('M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z'),
  search: svg('M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4.4 4.4-1.4 1.4-4.4-4.4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z'),
  check: svg('m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z'),
  refresh: svg('M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4z'),
  move: svg('M12 2 8 6h3v5H6V8l-4 4 4 4v-3h5v5H8l4 4 4-4h-3v-5h5v3l4-4-4-4v3h-5V6h3z'),
};
