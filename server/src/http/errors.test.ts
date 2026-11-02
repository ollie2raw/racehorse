import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureException: sentry.captureException }));

const { errorHandler, publicErrorMessage, requestIdMiddleware, sendServerError, REQUEST_ID_HEADER } = await import('./errors');

let server: Server | null = null;

async function start(setup: (app: express.Express) => void): Promise<string> {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: '1kb' }));
  setup(app);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeEach(() => sentry.captureException.mockReset());
afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe('request ids', () => {
  it('gives every response one, in the header', async () => {
    const base = await start((app) => app.get('/ok', (_req, res) => void res.json({ ok: true })));
    const res = await fetch(`${base}/ok`);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses a plain id the caller sends, so a client log line can be matched to a server one', async () => {
    const base = await start((app) => app.get('/ok', (_req, res) => void res.json({ ok: true })));
    const res = await fetch(`${base}/ok`, { headers: { [REQUEST_ID_HEADER]: 'client-abc_123.XYZ' } });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('client-abc_123.XYZ');
  });

  it('replaces an id that is too long, too short, or not plain characters, rather than echoing it into headers and logs', async () => {
    const base = await start((app) => app.get('/ok', (_req, res) => void res.json({ ok: true })));
    for (const bad of ['short', 'x'.repeat(65), 'has spaces in it', 'semi;colon=1', '<script>alert(1)</script>']) {
      const res = await fetch(`${base}/ok`, { headers: { [REQUEST_ID_HEADER]: bad } });
      const id = res.headers.get(REQUEST_ID_HEADER)!;
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('sendServerError', () => {
  const failingRoute = (app: express.Express) =>
    app.get('/boom', (_req, res) => sendServerError(res, new Error('Supabase request failed: 500 {"table":"profiles"}'), 'Friends unavailable.'));

  it('never shows internal error text in production, only the route\'s sentence and the request id', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const base = await start(failingRoute);
    const res = await fetch(`${base}/boom`);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('Friends unavailable.');
    expect(body.requestId).toBe(res.headers.get(REQUEST_ID_HEADER));
    expect(JSON.stringify(body)).not.toContain('Supabase');
    expect(JSON.stringify(body)).not.toContain('profiles');
  });

  it('shows the real message while developing, with the same request id', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const base = await start(failingRoute);
    const body = await (await fetch(`${base}/boom`)).json();
    expect(body.error).toContain('Supabase request failed');
    expect(body.requestId).toBeTruthy();
  });

  it('only sends to Sentry when asked, so a transient failure cannot eat the quota', async () => {
    const base = await start((app) => {
      app.get('/quiet', (_req, res) => sendServerError(res, new Error('x'), 'Quiet.'));
      app.get('/loud', (_req, res) => sendServerError(res, new Error('x'), 'Loud.', { capture: true }));
    });
    await fetch(`${base}/quiet`);
    expect(sentry.captureException).not.toHaveBeenCalled();
    await fetch(`${base}/loud`);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('does not write twice when the response has already started', () => {
    const res = { headersSent: true, locals: {}, status: vi.fn(), json: vi.fn() };
    sendServerError(res as never, new Error('late'), 'Late.');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('publicErrorMessage', () => {
  it('is the fixed sentence in production and the real message otherwise', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(publicErrorMessage(new Error('secret detail'), 'Failed.')).toBe('Failed.');
    vi.stubEnv('NODE_ENV', 'test');
    expect(publicErrorMessage(new Error('secret detail'), 'Failed.')).toBe('secret detail');
    expect(publicErrorMessage('not an error', 'Failed.')).toBe('Failed.');
  });
});

describe('the final error handler', () => {
  it('turns an error thrown in a route (sync or async) into JSON with a request id, not a stack or an HTML page', async () => {
    const base = await start((app) => {
      app.get('/sync', () => {
        throw new Error('internal detail at /srv/app/secret.ts');
      });
      app.get('/async', async () => {
        throw new Error('internal async detail');
      });
    });
    for (const path of ['/sync', '/async']) {
      const res = await fetch(`${base}${path}`);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(body.error).toBe('Something went wrong.');
      expect(body.requestId).toBe(res.headers.get(REQUEST_ID_HEADER));
      expect(JSON.stringify(body)).not.toContain('internal');
      expect(JSON.stringify(body)).not.toContain('secret.ts');
    }
    // unexpected errors are exactly what Sentry is for
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('answers a malformed JSON body with a 400 that says so, and does not page Sentry for a client mistake', async () => {
    const base = await start((app) => app.post('/echo', (req, res) => void res.json(req.body)));
    const res = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('The request body is not valid JSON.');
    expect(body.requestId).toBeTruthy();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('keeps the existing 413 message for an oversized body', async () => {
    const base = await start((app) => app.post('/echo', (req, res) => void res.json(req.body)));
    const res = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(5_000) }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('Match result payload is too large.');
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('keeps a 4xx status an error carries, with a plain sentence', async () => {
    const base = await start((app) =>
      app.get('/teapot', () => {
        throw Object.assign(new Error('I am a teapot with internal notes'), { status: 418 });
      }),
    );
    const res = await fetch(`${base}/teapot`);
    expect(res.status).toBe(418);
    expect(JSON.stringify(await res.json())).not.toContain('internal notes');
  });

  it('hands off when the response has already started', () => {
    const next = vi.fn();
    const res = { headersSent: true, locals: {} };
    errorHandler(new Error('late'), {} as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
