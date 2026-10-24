// Tâches de fond : ménage (sessions, « state », cache), sauvegarde quotidienne de la base,
// synchronisation périodique des comptes de jeu (seulement ceux qui l'ont activée).

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { now } from './db.js';
import { getProvider } from './integrations/index.js';
import { startJob } from './integrations/core/sync.js';

const HOUR = 3600_000;

export function cleanup(db) {
  const t = now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM cache WHERE expires_at < ?').run(Date.now());
  // Historique des synchronisations : 90 jours
  db.prepare('DELETE FROM sync_jobs WHERE started_at < ?').run(new Date(Date.now() - 90 * 86400_000).toISOString());
}

/** Copie cohérente de la base (VACUUM INTO) dans data/backups, en gardant les N derniers jours. */
export function backup(db, config) {
  const dir = join(config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `asobi-${new Date().toISOString().slice(0, 10)}.sqlite`);
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = readdirSync(dir).filter((f) => /^asobi-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - config.backupDays))) rmSync(join(dir, old), { force: true });
  return file;
}

/** Synchronise, l'un après l'autre, les comptes dont la dernière synchro date de plus de `autoSyncHours`. */
export async function autoSync(ctx) {
  const { db, config } = ctx;
  const before = new Date(Date.now() - config.autoSyncHours * HOUR).toISOString();
  const due = db.prepare(`SELECT * FROM connected_accounts WHERE auto_sync = 1 AND verified = 1 AND status IN ('connected', 'synced')
    AND (last_sync_at IS NULL OR last_sync_at < ?)`).all(before);
  for (const account of due) {
    const provider = getProvider(account.provider);
    if (!provider?.capabilities.sync || !provider.sync || !provider.enabled(config)) continue;
    const jobCtx = { ...ctx, awaitJobs: true };
    try {
      startJob(jobCtx, { userId: account.user_id, account, provider: provider.id, kind: 'sync' }, (job) => provider.sync(ctx, account, job));
    } catch { continue; } // déjà en cours
    await jobCtx.pending; // un compte à la fois
    await new Promise((r) => setTimeout(r, 30_000)); // laisse respirer l'API entre deux comptes
  }
}

export function startTasks(ctx) {
  const { db, config } = ctx;
  const safe = (name, fn) => async () => {
    try { await fn(); } catch (err) { ctx.log?.(`tâche ${name} : ${err.message}`); }
  };
  const runCleanup = safe('ménage', () => cleanup(db));
  const runBackup = safe('sauvegarde', () => ctx.log?.(`sauvegarde : ${backup(db, config)}`));
  const runSync = safe('synchro', () => autoSync(ctx));
  runCleanup();
  setTimeout(runBackup, 60_000).unref();
  const timers = [
    setInterval(runCleanup, HOUR),
    setInterval(runBackup, 24 * HOUR),
    setInterval(runSync, HOUR),
  ];
  timers.forEach((t) => t.unref());
  return () => timers.forEach(clearInterval);
}
