// Fichiers du site. Seuls index.html, assets/ et le jeu de données du mode test sont servis :
// jamais le code du serveur, les données, le .env ou le dépôt Git.

import { stat, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { SECURITY_HEADERS } from './http.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Pages de l'application : la navigation se fait ensuite dans le navigateur (#/…)
const APP_PAGES = [/^\/$/, /^\/index\.html$/, /^\/u\/[\w.\-]{1,40}\/?$/];
const PUBLIC = [/^\/assets\/[\w\-./]+$/, /^\/data\/test-games\.json$/];

// Politique de sécurité du contenu : scripts du site, hls.js (jsDelivr) et lecteur YouTube seulement
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function createStatic(root) {
  return async function serveStatic(req, res, pathname) {
    let file;
    if (APP_PAGES.some((re) => re.test(pathname))) file = 'index.html';
    else if (PUBLIC.some((re) => re.test(pathname)) && !pathname.includes('..')) file = pathname.slice(1);
    else return false;

    const full = resolve(root, file);
    if (!full.startsWith(resolve(root) + sep)) return false;
    let info;
    try { info = await stat(full); } catch { return false; }
    if (!info.isFile()) return false;

    // Revalidation à chaque visite (réponse 304 si rien n'a changé) : une mise à jour du site est vue tout de suite
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    if (file === 'index.html') headers['Content-Security-Policy'] = CSP;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    const body = await readFile(full);
    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
