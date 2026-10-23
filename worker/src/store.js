// La collection vit dans Cloudflare KV, sous une seule clé :
//   { version, games: [], wishlist: [], playlist: [ids], settings: {}, updatedAt }
// Une sauvegarde quotidienne est recopiée dans le dépôt GitHub (.github/workflows/backup.yml).

const KEY = 'state';
const empty = () => ({ version: 1, games: [], wishlist: [], playlist: [], settings: {}, updatedAt: null });

export async function loadState(env) {
  const raw = await env.LUDO.get(KEY);
  return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
}

export async function saveState(env, state) {
  state.updatedAt = new Date().toISOString();
  await env.LUDO.put(KEY, JSON.stringify(state));
  return state;
}

/** Ce que tout le monde peut voir : tout sauf les réglages privés (identifiant Steam…). */
export function publicState(state) {
  const { settings = {}, ...rest } = state;
  return {
    ...rest,
    settings: {
      name: settings.name ?? null,
      consoleTrailers: settings.consoleTrailers ?? {},
      steamConnected: Boolean(settings.steamId),
      steamSyncedAt: settings.steamSyncedAt ?? null,
    },
  };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
