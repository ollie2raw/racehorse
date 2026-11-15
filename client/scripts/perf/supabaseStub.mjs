#!/usr/bin/env node
/**
 * Minimal PostgREST stand-in for local lag measurement: node scripts/perf/supabaseStub.mjs [port] [latencyMs] [timeline.jsonl]
 * Every request answers `[]` (200) after the configured latency. GET /__lat?ms=N changes the latency; GET /__stats returns the
 * per-path call counts and request bytes; GET /__reset clears them (and truncates the timeline). It exists only so the real
 * server's room persistence can "succeed" with a chosen round-trip time; it validates nothing.
 *
 * With a timeline file, every request is also appended as one JSON line when it is answered:
 *   { tIn, tOut, key, bytes, room?, ev?, hand?, handOver?, seq?, ready? }
 * (arrival and answer time in epoch ms; for a room-session write: the room, the type of its newest event, the hand number, whether the
 * hand is over, the game-state sequence and how many players are marked ready). mpMatchDriver.mjs and perfBudgetsTier1.mjs read it.
 */
import fs from 'node:fs';
import http from 'node:http';

const port = Number(process.argv[2] ?? 54399);
let latency = Number(process.argv[3] ?? 0);
const timelineFile = process.argv[4] || null;
const counts = new Map();
const sizes = new Map();

function describeRoomWrite(buf) {
  try {
    const body = JSON.parse(buf.toString());
    const row = Array.isArray(body) ? body[0] : (body.p_session ?? body);
    if (!row || !row.room_code) return {};
    const events = Array.isArray(row.events) ? row.events : [];
    const entries = Array.isArray(body.p_entries) ? body.p_entries.filter((e) => e.stream === 'events') : [];
    const last = events.length ? events[events.length - 1] : (entries.length ? entries[entries.length - 1].entry : null);
    return {
      room: row.room_code,
      ev: last?.type ?? null,
      hand: row.game_state?.handNumber ?? null,
      handOver: row.game_state?.handOver ?? null,
      seq: row.game_state?.sequence ?? null,
      ready: Array.isArray(row.room_shell?.nextHandReady) ? row.room_shell.nextHandReady.length : 0,
    };
  } catch {
    return {};
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__lat') { latency = Number(url.searchParams.get('ms') ?? 0); res.end(String(latency)); return; }
  if (url.pathname === '/__stats') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ latency, counts: Object.fromEntries(counts), requestBytes: Object.fromEntries(sizes) })); return; }
  if (url.pathname === '/__reset') { counts.clear(); sizes.clear(); if (timelineFile) fs.writeFileSync(timelineFile, ''); res.end('ok'); return; }
  const tIn = Date.now();
  const key = `${req.method} ${url.pathname.replace('/rest/v1/', '')}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  const chunks = [];
  req.on('data', (c) => { chunks.push(c); });
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    sizes.set(key, (sizes.get(key) ?? 0) + buf.length);
    const record = timelineFile && buf.length ? { tIn, key, bytes: buf.length, ...describeRoomWrite(buf) } : null;
    setTimeout(() => {
      if (record) { record.tOut = Date.now(); fs.appendFileSync(timelineFile, `${JSON.stringify(record)}\n`); }
      res.setHeader('content-type', 'application/json'); res.statusCode = 200; res.end('[]');
    }, latency);
  });
}).listen(port, '127.0.0.1', () => console.log(`supabase stub on ${port}, latency ${latency}ms${timelineFile ? `, timeline ${timelineFile}` : ''}`));
