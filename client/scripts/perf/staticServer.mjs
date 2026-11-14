#!/usr/bin/env node
/**
 * Static server that behaves like the Vercel deploy for measurement: node scripts/perf/staticServer.mjs <distDir> <port>
 * Brotli on text assets (cached after the first compression), the cache headers from vercel.json (hashed /assets immutable,
 * images 7 days, HTML revalidated), prerendered `<route>.html` before the SPA fallback to index.html.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

const [dist, port = '5400'] = process.argv.slice(2);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml', '.map': 'application/json' };
const compressible = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml']);
const cache = new Map();

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const direct = path.join(dist, clean);
  if (direct.startsWith(dist) && fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const html = path.join(dist, `${clean.replace(/\/$/, '')}.html`);
  if (clean !== '/' && fs.existsSync(html)) return html;
  const idx = path.join(dist, clean, 'index.html');
  if (fs.existsSync(idx)) return idx;
  return path.join(dist, 'index.html');
}

http.createServer((req, res) => {
  const file = resolveFile(req.url ?? '/');
  const ext = path.extname(file);
  const headers = { 'Content-Type': types[ext] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
  if ((req.url ?? '').startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'].includes(ext)) headers['Cache-Control'] = 'public, max-age=604800, stale-while-revalidate=86400';
  else headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
  let body = fs.readFileSync(file);
  if (compressible.has(ext) && /\bbr\b/.test(String(req.headers['accept-encoding']))) {
    let br = cache.get(file);
    if (!br) { br = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }); cache.set(file, br); }
    body = br;
    headers['Content-Encoding'] = 'br';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
}).listen(Number(port), '127.0.0.1', () => console.log(`serving ${dist} on ${port}`));
