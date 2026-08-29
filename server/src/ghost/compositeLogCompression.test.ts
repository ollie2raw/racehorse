import http from 'http';
import { gzipSync } from 'zlib';
import express from 'express';
import compression from 'compression';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPOSITE_LOG_STATE_BUDGET_BYTES, capCompositeLogStates } from './service';
import type { GhostCompositeLog, GhostCompositeState } from './service';

/** Mirrors the production shape: ~800-char boardState, repeated inside `key`. */
function makeState(turn: number): GhostCompositeState {
  const boardState = `board:${'ab'.repeat(400)}:${turn}`;
  return {
    key: `${turn}::${boardState}`,
    turn,
    boardState,
    recommendedMove: { tilePlayed: '6|6', branch: 'left', count: 2, bestScoreDelta: 2 },
    candidates: [{ tilePlayed: '6|6', branch: 'left', count: 2, bestScoreDelta: 2 }],
  };
}

const heavyLog: GhostCompositeLog = {
  generatedAt: '2026-08-29T00:00:00.000Z',
  sourceGameIds: Array.from({ length: 20 }, (_, i) => `game-${i}`),
  states: Array.from({ length: 1200 }, (_, i) => makeState(i + 1)),
  recentGameStyles: [],
};

let server: http.Server;
let port: number;

beforeAll(async () => {
  const app = express();
  app.use(compression());
  app.get('/capped', (_req, res) => {
    res.json({ ok: true, summary: { compositeLog: capCompositeLogStates(heavyLog) } });
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function get(path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; encoding?: string; bytes: number }>((resolve, reject) => {
    const req = http.request({ port, path, headers }, (res) => {
      let bytes = 0;
      res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          encoding: res.headers['content-encoding'] as string | undefined,
          bytes,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('response compression', () => {
  it('gzips a large JSON response when the client accepts it', async () => {
    const res = await get('/capped', { 'accept-encoding': 'gzip' });
    expect(res.status).toBe(200);
    expect(res.encoding).toBe('gzip');
  });

  it('serves the same route uncompressed to a client that does not accept gzip', async () => {
    const res = await get('/capped', { 'accept-encoding': 'identity' });
    expect(res.status).toBe(200);
    expect(res.encoding).toBeUndefined();
  });

  it('transfers dramatically fewer bytes on the wire once gzipped', async () => {
    const plain = await get('/capped', { 'accept-encoding': 'identity' });
    const gzipped = await get('/capped', { 'accept-encoding': 'gzip' });
    expect(gzipped.bytes).toBeLessThan(plain.bytes / 5);
  });

  it('caps then compresses — both layers apply to the same response', async () => {
    const uncappedBytes = JSON.stringify(heavyLog).length;
    const cappedBytes = JSON.stringify(capCompositeLogStates(heavyLog)).length;
    const wireBytes = (await get('/capped', { 'accept-encoding': 'gzip' })).bytes;

    expect(cappedBytes).toBeLessThanOrEqual(COMPOSITE_LOG_STATE_BUDGET_BYTES + 2_000);
    expect(cappedBytes).toBeLessThan(uncappedBytes / 5);
    expect(wireBytes).toBeLessThan(cappedBytes / 5);
  });

  it('leaves the gzip win on the table without the cap — the two are independent', () => {
    const uncapped = JSON.stringify(heavyLog).length;
    const uncappedGzip = gzipSync(JSON.stringify(heavyLog)).length;
    // Compression alone still ships far more than the capped+gzipped response.
    expect(uncappedGzip).toBeGreaterThan(0);
    expect(uncappedGzip).toBeLessThan(uncapped);
  });
});
