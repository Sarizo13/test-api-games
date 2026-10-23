// Données d'Asobi : chargement, modifications (affichées tout de suite, enregistrées en arrière-plan)
// et appels au mini-serveur. Avec ?test dans l'adresse, on travaille sur data/test-games.json, en mémoire.

import { local, toast } from './util.js';

export const API = 'https://ludotheque.theopacheco5.workers.dev';
export const TEST = new URLSearchParams(location.search).has('test');

export const state = {
  games: [],
  wishlist: [],
  playlist: [],
  settings: {},
  loaded: false,
  canEdit: TEST || Boolean(local.get('password', '')),
};

/* ---------- Abonnements : les pages se redessinent quand les données changent ---------- */

const bus = new EventTarget();
export const onChange = (fn) => {
  bus.addEventListener('change', fn);
  return () => bus.removeEventListener('change', fn);
};
const emit = (detail = {}) => bus.dispatchEvent(new CustomEvent('change', { detail }));

/* ---------- Appels au serveur ---------- */

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const password = local.get('password', '');
  if (password) headers.Authorization = `Bearer ${password}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && method !== 'GET') {
    local.set('password', '');
    state.canEdit = TEST;
    emit({ type: 'auth' });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status });
  return data;
}

export const get = (path) => request('GET', path);

/** Écriture : en mode test, rien n'est envoyé. */
async function write(method, path, body) {
  if (TEST) return null;
  if (!state.canEdit) throw Object.assign(new Error('Connecte-toi pour modifier ta collection.'), { status: 401 });
  return request(method, path, body);
}

function fail(err, title = 'Modification non enregistrée') {
  toast('⚠️', title, ` ${err.message}`, 7000);
}

/* ---------- Chargement ---------- */

export async function load() {
  const data = TEST
    ? await fetch(`data/test-games.json?t=${Date.now()}`).then((r) => r.json())
    : await get('/collection');
  state.games = data.games ?? [];
  state.wishlist = data.wishlist ?? [];
  state.playlist = data.playlist ?? [];
  state.settings = data.settings ?? {};
  state.loaded = true;
  emit({ type: 'load' });
}

export const gameById = (id) => state.games.find((g) => g.id === id);

/* ---------- Connexion ---------- */

export async function login(password) {
  local.set('password', password);
  try {
    await request('POST', '/login');
    state.canEdit = true;
    emit({ type: 'auth' });
    return true;
  } catch (err) {
    local.set('password', '');
    state.canEdit = TEST;
    throw err;
  }
}

export function logout() {
  local.set('password', '');
  state.canEdit = TEST;
  emit({ type: 'auth' });
}

/* ---------- Jeux ---------- */

/** Ajoute un jeu. `pick` (proposition de recherche) sert à simuler l'ajout en mode test. */
export async function addGame({ igdbId, steamAppId, name, platform, status = 'backlog', playlist = false }, pick = null) {
  let game;
  if (TEST) {
    game = {
      id: `test-${igdbId ?? steamAppId ?? Date.now()}-${String(platform).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: pick?.name ?? name ?? 'Jeu de test',
      platform,
      addedAt: new Date().toISOString(),
      releaseDate: pick?.releaseDate ?? null,
      genres: pick?.genres ?? [],
      developers: [],
      igdbId: igdbId ?? null,
      images: { grid: pick?.cover ?? null, gridThumb: pick?.cover ?? null, cover: pick?.cover ?? null, hero: null, screenshots: [] },
      status, ratings: {}, review: '', favorite: false, playtimeMinutes: null, achievements: null,
    };
    if (state.games.some((g) => g.igdbId && g.igdbId === game.igdbId && g.platform === platform)) {
      throw new Error('Déjà dans ta collection sur cette console.');
    }
  } else {
    ({ game } = await write('POST', '/games', { igdbId, steamAppId, name, platform, status, playlist }));
  }
  state.games.push(game);
  state.wishlist = state.wishlist.filter((w) => w.igdbId !== game.igdbId);
  if (playlist && !state.playlist.includes(game.id)) state.playlist.push(game.id);
  emit({ type: 'games' });
  return game;
}

/** Modifie un jeu : affiché tout de suite, annulé si le serveur refuse. */
export async function updateGame(id, patch) {
  const game = gameById(id);
  if (!game) return null;
  const before = structuredClone(game);
  const playlistBefore = [...state.playlist];

  // Aperçu local fidèle à ce que fera le serveur
  if ('ratings' in patch) {
    game.ratings = { ...(game.ratings ?? {}) };
    for (const [k, v] of Object.entries(patch.ratings)) { if (v === null) delete game.ratings[k]; else game.ratings[k] = v; }
  }
  for (const key of ['status', 'favorite', 'review', 'startedAt', 'finishedAt', 'platform']) if (key in patch) game[key] = patch[key];
  if ('playtimeMinutes' in patch) { game.playtimeMinutes = patch.playtimeMinutes; game.playtimeSource = patch.playtimeMinutes == null ? null : 'manual'; }
  if ('achievements' in patch) {
    const a = patch.achievements;
    game.achievements = !a ? null : a.total ? { ...a, percent: Math.round((a.unlocked / a.total) * 100), source: 'manual' } : { percent: a.percent, source: 'manual' };
  }
  if (patch.status === 'playing') game.startedAt ??= new Date().toISOString().slice(0, 10);
  if (['finished', 'completed'].includes(patch.status)) {
    game.finishedAt ??= new Date().toISOString().slice(0, 10);
    state.playlist = state.playlist.filter((x) => x !== id);
  }
  emit({ type: 'game', id });

  try {
    const res = await write('PATCH', `/games/${encodeURIComponent(id)}`, patch);
    if (res?.game) Object.assign(game, res.game);
    return game;
  } catch (err) {
    Object.assign(game, before);
    state.playlist = playlistBefore;
    emit({ type: 'game', id });
    fail(err);
    return null;
  }
}

export async function removeGame(id) {
  const index = state.games.findIndex((g) => g.id === id);
  if (index < 0) return;
  const [game] = state.games.splice(index, 1);
  const playlistBefore = [...state.playlist];
  state.playlist = state.playlist.filter((x) => x !== id);
  emit({ type: 'games' });
  try {
    await write('DELETE', `/games/${encodeURIComponent(id)}`);
  } catch (err) {
    state.games.splice(index, 0, game);
    state.playlist = playlistBefore;
    emit({ type: 'games' });
    fail(err, 'Suppression impossible');
  }
}

/* ---------- Liste « à jouer » ---------- */

export async function setPlaylist(ids) {
  const before = [...state.playlist];
  state.playlist = ids;
  emit({ type: 'playlist' });
  try {
    await write('PUT', '/playlist', { ids });
  } catch (err) {
    state.playlist = before;
    emit({ type: 'playlist' });
    fail(err);
  }
}

export const togglePlaylist = (id) => setPlaylist(state.playlist.includes(id) ? state.playlist.filter((x) => x !== id) : [...state.playlist, id]);

/* ---------- Envies ---------- */

export async function addWish(stub) {
  if (state.wishlist.some((w) => w.igdbId === stub.igdbId)) return;
  const temp = { ...stub, addedAt: new Date().toISOString() };
  state.wishlist.push(temp);
  emit({ type: 'wishlist' });
  try {
    const res = await write('POST', '/wishlist', { igdbId: stub.igdbId });
    if (res?.item) Object.assign(temp, res.item);
    emit({ type: 'wishlist' });
  } catch (err) {
    state.wishlist = state.wishlist.filter((w) => w !== temp);
    emit({ type: 'wishlist' });
    fail(err);
  }
}

export async function removeWish(igdbId) {
  const before = [...state.wishlist];
  state.wishlist = state.wishlist.filter((w) => w.igdbId !== igdbId);
  emit({ type: 'wishlist' });
  try {
    await write('DELETE', `/wishlist/${igdbId}`);
  } catch (err) {
    state.wishlist = before;
    emit({ type: 'wishlist' });
    fail(err);
  }
}

/* ---------- Réglages, Steam ---------- */

export async function saveSettings(patch) {
  if (TEST) {
    if ('name' in patch) state.settings.name = patch.name;
    if (patch.consoleTrailers) state.settings.consoleTrailers = { ...(state.settings.consoleTrailers ?? {}), ...patch.consoleTrailers };
    emit({ type: 'settings' });
    return state.settings;
  }
  const { settings } = await write('PATCH', '/settings', patch);
  state.settings = settings;
  emit({ type: 'settings' });
  return settings;
}

/** Synchronise temps de jeu et succès Steam, par paquets. */
export async function steamSync(onProgress) {
  if (TEST) throw new Error('Indisponible en mode test.');
  let offset = 0;
  let total = 0;
  do {
    const res = await write('POST', '/steam/sync', { offset });
    total = res.steamGames;
    offset = res.next;
    onProgress?.(offset ?? total, total);
  } while (offset !== null);
  await load();
  return total;
}

export async function steamLibrary() {
  if (TEST) throw new Error('Indisponible en mode test.');
  return (await request('GET', '/steam/library')).results;
}

/* ---------- Contenus publics (IGDB) ---------- */

const memo = new Map();
const cachedGet = (path) => {
  if (!memo.has(path)) memo.set(path, get(path).catch((err) => { memo.delete(path); throw err; }));
  return memo.get(path);
};

export const fetchToday = () => cachedGet('/today');
export const fetchDiscover = (ids, exclude = []) => cachedGet(`/discover?ids=${ids.join(',')}&exclude=${exclude.join(',')}`).then((r) => r.results);
export const fetchRecommend = (genres, mode, exclude = []) =>
  cachedGet(`/recommend?genres=${encodeURIComponent(genres.join(','))}&mode=${mode}&exclude=${exclude.join(',')}`).then((r) => r.results);

/** IDs IGDB déjà possédés ou désirés : à exclure des suggestions. */
export const knownIgdbIds = () => [...new Set([...state.games, ...state.wishlist].map((g) => g.igdbId).filter(Boolean))];

export async function searchIgdb(query, signal) {
  const res = await fetch(`${API}/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).results;
}
