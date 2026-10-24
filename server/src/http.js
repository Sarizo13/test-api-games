// Outils HTTP : erreurs, réponses JSON, lecture du corps, cookies, limitation du débit, petit routeur.

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

export function redirect(res, location, headers = {}) {
  res.writeHead(302, { ...SECURITY_HEADERS, Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export async function readJson(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Requête trop volumineuse.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new HttpError(400, 'Corps de requête invalide.');
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Cookie toujours HttpOnly et SameSite=Lax ; Secure dès que le site est en HTTPS. */
export function cookie(name, value, { maxAge, secure, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

/**
 * Adresse du visiteur. Derrière nginx, on lit X-Real-IP (que nginx écrase avec la vraie adresse) et pas
 * X-Forwarded-For, dont le début peut être inventé par le visiteur.
 */
export function clientIp(req, trustProxy) {
  const real = trustProxy ? String(req.headers['x-real-ip'] ?? '').trim() : '';
  return real || req.socket.remoteAddress || 'inconnu';
}

/** Limite simple en mémoire : `max` requêtes par fenêtre de `windowMs`, par clé (adresse + catégorie). */
export function rateLimiter() {
  const hits = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, 60_000).unref();
  return (key, max, windowMs = 60_000) => {
    const t = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < t) hits.set(key, (entry = { count: 0, reset: t + windowMs }));
    entry.count++;
    if (entry.count > max) throw new HttpError(429, 'Trop de requêtes, réessaie dans un instant.', { retryAfter: Math.ceil((entry.reset - t) / 1000) });
  };
}

/** Routeur minimal : route('GET', '/api/games/:id', handler). */
export function router() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
    routes.push({ method, re, keys, handler });
  };
  const match = (method, path) => {
    let allowed = false;
    for (const r of routes) {
      const m = path.match(r.re);
      if (!m) continue;
      if (r.method !== method) { allowed = true; continue; }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { handler: r.handler, params };
    }
    return allowed ? { notAllowed: true } : null;
  };
  return { add, match };
}
