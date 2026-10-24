// Moteur de synchronisation : tâches suivies en base (historique), une seule à la fois par compte,
// nouvelles tentatives avec attente croissante quand une plateforme limite le débit ou tombe en panne.

import { now, parseJson } from '../../db.js';
import { HttpError } from '../../http.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Erreur d'une plateforme : `retryable` pour un 429 / 5xx / souci réseau. */
export class ProviderError extends Error {
  constructor(message, { status = 502, retryable = false, code } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

/** Relance `fn` sur erreur passagère : 0,5 s, 1 s, 2 s, 4 s (+ aléa), ou le délai demandé par la plateforme. */
export async function withRetry(fn, { retries = 4, base = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const network = err.name === 'TypeError'; // TypeError : échec réseau de fetch (DNS, coupure, délai)
      const retryable = err.retryable || network;
      if (network && attempt >= retries) throw new ProviderError('La plateforme ne répond pas pour le moment (réseau). Réessaie plus tard.', { status: 502, code: 'network' });
      if (!retryable || attempt >= retries) throw err;
      await sleep(err.retryAfterMs ?? base * 2 ** attempt + Math.random() * 250);
    }
  }
}

/** Exécute des tâches asynchrones avec au plus `limit` en parallèle. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/* ---------- Tâches ---------- */

const running = new Set(); // comptes en cours de synchronisation (une tâche à la fois)

export const jobView = (row) => row && ({
  id: row.id,
  provider: row.provider,
  kind: row.kind,
  status: row.status,
  progress: row.progress,
  total: row.total,
  stats: parseJson(row.stats),
  error: row.error,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export function getJob(db, userId, id) {
  const row = db.prepare('SELECT * FROM sync_jobs WHERE id = ? AND user_id = ?').get(Number(id), userId);
  if (!row) throw new HttpError(404, 'Tâche introuvable.');
  return jobView(row);
}

/**
 * Lance `work(job)` en arrière-plan et renvoie tout de suite la tâche créée.
 * `job.progress(n, total)` met à jour l'avancement ; le résultat de `work` devient `stats`.
 */
export function startJob(ctx, { userId, account, provider, kind }, work) {
  const { db } = ctx;
  const lockKey = account ? `account:${account.id}` : `user:${userId}:${provider}:${kind}`;
  if (running.has(lockKey)) throw new HttpError(409, 'Une synchronisation est déjà en cours pour ce compte.');
  running.add(lockKey);

  const { lastInsertRowid: id } = db.prepare(`INSERT INTO sync_jobs (user_id, connected_account_id, provider, kind, status, started_at)
    VALUES (?, ?, ?, ?, 'running', ?)`).run(userId, account?.id ?? null, provider, kind, now());
  const job = {
    id: Number(id),
    progress: (n, total) => db.prepare('UPDATE sync_jobs SET progress = ?, total = COALESCE(?, total) WHERE id = ?').run(n, total ?? null, id),
  };

  const done = (async () => {
    try {
      const stats = await work(job);
      db.prepare("UPDATE sync_jobs SET status = 'done', stats = ?, finished_at = ? WHERE id = ?").run(JSON.stringify(stats ?? {}), now(), id);
    } catch (err) {
      ctx.log?.(`synchro ${provider}/${kind} #${id} : ${err.message}`);
      db.prepare("UPDATE sync_jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ?").run(String(err.message).slice(0, 500), now(), id);
    } finally {
      running.delete(lockKey);
    }
  })();
  if (ctx.awaitJobs) ctx.pending = done; // tests : attendre la fin de la tâche

  return getJob(db, userId, id);
}
