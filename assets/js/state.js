// Données d'Asobi : chargement, modifications (affichées tout de suite, enregistrées en arrière-plan)
// et appels au serveur (/api, même adresse que le site). Trois modes :
//   - connecté avec Discord : sa propre collection, modifiable ;
//   - /u/<pseudo> : la collection publique de quelqu'un, en lecture seule ;
//   - ?dev-test (réservé au développement, aucun lien n'y mène) : data/test-games.json, en mémoire.
// La session est un cookie HttpOnly posé par le serveur : aucun jeton n'est gardé dans le navigateur.

import { toast } from './util.js';

export const API = '/api';
export const TEST = new URLSearchParams(location.search).has('dev-test');
/** Pseudo du profil public affiché (/u/<pseudo>), ou null. */
export const PROFILE = TEST ? null : location.pathname.match(/^\/u\/([\w.\-]{1,40})\/?$/)?.[1] ?? null;

export const state = {
  games: [],
  wishlist: [],
  playlist: [],
  settings: {},
  user: null,          // utilisateur connecté (pseudo, nom, avatar, profil public ?)
  owner: null,         // propriétaire de la collection affichée en mode /u/<pseudo>
  discordConfigured: true,
  loaded: false,
  canEdit: TEST,
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
  const headers = {};
  if (method !== 'GET') headers['X-Asobi'] = '1'; // le serveur refuse toute écriture sans cet en-tête (CSRF)
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'login_required' && state.user) {
    state.user = null; // session expirée
    state.canEdit = TEST;
    emit({ type: 'auth' });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status, code: data.code });
  return data;
}

export const get = (path) => request('GET', path);
export const post = (path, body) => request('POST', path, body ?? {});

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

function apply(data) {
  state.games = data.games ?? [];
  state.wishlist = data.wishlist ?? [];
  state.playlist = data.playlist ?? [];
  state.settings = data.settings ?? {};
}

export async function load() {
  if (TEST) {
    apply(await fetch(`/data/test-games.json?t=${Date.now()}`).then((r) => r.json()));
  } else {
    const me = await get('/me');
    state.user = me.user;
    state.discordConfigured = me.discordConfigured;
    if (PROFILE) {
      const data = await get(`/users/${encodeURIComponent(PROFILE)}`);
      state.owner = data.user;
      apply(data);
    } else if (state.user) {
      apply(await get('/collection'));
    } else {
      apply({});
    }
    state.canEdit = Boolean(state.user) && !PROFILE;
  }
  state.loaded = true;
  emit({ type: 'load' });
}

export const gameById = (id) => state.games.find((g) => g.id === id);

/* ---------- Connexion (Discord) ---------- */

/** Part vers Discord ; on revient ensuite sur la page en cours. */
export function login(next = location.hash || '#/') {
  location.href = `${API}/auth/discord/login?next=${encodeURIComponent(next)}`;
}

export async function logout() {
  await post('/auth/logout').catch(() => {});
  location.href = '/';
}

/* ---------- Jeux ---------- */

/** Ajoute un jeu. `pick` (proposition de recherche) sert à simuler l'ajout en mode test. */
export async function addGame({ igdbId, platform, status = 'backlog', playlist = false }, pick = null) {
  let game;
  if (TEST) {
    game = {
      id: `test-${igdbId ?? Date.now()}-${String(platform).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: pick?.name ?? 'Jeu de test',
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
    ({ game } = await write('POST', '/games', { igdbId, platform, status, playlist }));
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

/** Associe un jeu importé sans correspondance à sa fiche IGDB. */
export async function matchGame(id, igdbId) {
  const { game } = await write('POST', `/games/${encodeURIComponent(id)}/match`, { igdbId });
  const index = state.games.findIndex((g) => g.id === id);
  if (index >= 0) state.games[index] = game;
  emit({ type: 'games' });
  return game;
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

/* ---------- Réglages, compte ---------- */

export async function saveSettings(patch) {
  if (TEST) {
    if ('name' in patch) state.settings.name = patch.name;
    if (Array.isArray(patch.friends)) state.settings.friends = patch.friends;
    if (patch.consoleTrailers) state.settings.consoleTrailers = { ...(state.settings.consoleTrailers ?? {}), ...patch.consoleTrailers };
    emit({ type: 'settings' });
    return state.settings;
  }
  const { settings, user } = await write('PATCH', '/settings', patch);
  state.settings = settings;
  state.user = user;
  emit({ type: 'settings' });
  return settings;
}

/** Supprime le compte et toutes ses données (il faut retaper son pseudo). */
export async function deleteAccount(confirm) {
  await request('DELETE', '/me', { confirm });
  location.href = '/';
}

/* ---------- Comptes de jeu connectés ---------- */

const NO_TEST = () => Promise.reject(new Error('Indisponible en mode test.'));

export const fetchAccounts = () => (TEST ? NO_TEST() : get('/accounts'));
export const discoverAccounts = () => (TEST ? NO_TEST() : post('/accounts/discover'));
export const enableAccount = (id) => post(`/accounts/${id}/enable`);
export const accountLibrary = (id) => get(`/accounts/${id}/library`).then((r) => r.results);
export const setAutoSync = (id, autoSync) => request('PATCH', `/accounts/${id}`, { autoSync });
export const disconnectAccount = (id) => request('DELETE', `/accounts/${id}`);
/** Liaison directe (Epic) : adresse où se connecter, puis le code collé par le joueur. */
export const linkStart = (provider) => post(`/accounts/link/${encodeURIComponent(provider)}/start`);
export const linkFinish = (provider, code) => post(`/accounts/link/${encodeURIComponent(provider)}/finish`, { code });

/**
 * Lance une synchronisation ou un import (`kind` : 'sync' | 'import') et suit son avancement jusqu'à la fin.
 * `onProgress(job)` est appelé à chaque étape ; la collection est rechargée à la fin.
 */
export async function runAccountJob(id, kind, body, onProgress) {
  const { job } = await post(`/accounts/${id}/${kind}`, body);
  let current = job;
  while (current.status === 'running' || current.status === 'queued') {
    onProgress?.(current);
    await new Promise((r) => setTimeout(r, 1200));
    current = (await get(`/jobs/${current.id}`)).job;
  }
  onProgress?.(current);
  if (current.status === 'error') throw Object.assign(new Error(current.error || 'Synchronisation impossible.'), { job: current });
  await load();
  return current;
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
