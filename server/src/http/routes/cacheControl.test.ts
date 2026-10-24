import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setPrivateShortCache, setPublicShortCache } from './cacheControl';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  // an upstream middleware that already varies (cors does this) must survive
  app.use((_req, res, next) => { res.vary('Origin'); next(); });
  app.get('/private', (_req, res) => { setPrivateShortCache(res, 60); res.json({ ok: true }); });
  app.get('/public', (_req, res) => { setPublicShortCache(res, 60, 300); res.json({ ok: true }); });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('per-viewer cache headers (real Express)', () => {
  it('private responses are never shared-cacheable and vary on the credential, keeping earlier Vary entries', async () => {
    const res = await fetch(`${base}/private`);
    expect(res.headers.get('cache-control')).toMatch(/^private,/);
    expect(res.headers.get('cache-control')).not.toMatch(/public/);
    const vary = (res.headers.get('vary') ?? '').toLowerCase();
    expect(vary).toContain('authorization');
    expect(vary).toContain('origin');
  });
  it('public responses are unchanged', async () => {
    const res = await fetch(`${base}/public`);
    expect(res.headers.get('cache-control')).toMatch(/^public,/);
    expect((res.headers.get('vary') ?? '').toLowerCase()).not.toContain('authorization');
  });
});
