#!/usr/bin/env node
/**
 * Minimal PostgREST stand-in for local lag measurement: node scripts/perf/supabaseStub.mjs [port] [latencyMs]
 * Every request answers `[]` (200) after the configured latency. GET /__lat?ms=N changes the latency; GET /__stats returns the
 * per-path call counts and the latency each call was given. It exists only so the real server's room persistence can "succeed"
 * with a chosen round-trip time; it validates nothing.
 */
import http from 'node:http';

const port = Number(process.argv[2] ?? 54399);
let latency = Number(process.argv[3] ?? 0);
const counts = new Map();
const sizes = new Map();

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__lat') { latency = Number(url.searchParams.get('ms') ?? 0); res.end(String(latency)); return; }
  if (url.pathname === '/__stats') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ latency, counts: Object.fromEntries(counts), requestBytes: Object.fromEntries(sizes) })); return; }
  if (url.pathname === '/__reset') { counts.clear(); sizes.clear(); res.end('ok'); return; }
  const key = `${req.method} ${url.pathname.replace('/rest/v1/', '')}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  let bytes = 0;
  req.on('data', (c) => { bytes += c.length; });
  req.on('end', () => { sizes.set(key, (sizes.get(key) ?? 0) + bytes); });
  setTimeout(() => { res.setHeader('content-type', 'application/json'); res.statusCode = 200; res.end('[]'); }, latency);
}).listen(port, '127.0.0.1', () => console.log(`supabase stub on ${port}, latency ${latency}ms`));
