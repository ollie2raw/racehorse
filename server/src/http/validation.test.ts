import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('../logger', () => ({ childLogger: () => logger, logger }));

const { requestIdMiddleware, errorHandler } = await import('./errors');
const { validateBody, validationMode, validationTallies, resetValidationStateForTests, VALIDATION_LOG_INTERVAL_MS } = await import('./validation');
const { puzzleRushReportBody, puzzleRushCompleteBody, recordMatchBody } = await import('./requestSchemas');

const schema = z.strictObject({ name: z.string().min(1), score: z.number().int().min(0).max(200) });

let server: Server | null = null;
const reached = vi.fn();

async function start(now?: () => number): Promise<string> {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.post('/x', validateBody('test/x', schema, now ? { now } : {}), (_req, res) => {
    reached();
    res.json({ ok: true });
  });
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  resetValidationStateForTests();
  reached.mockReset();
  Object.values(logger).forEach((fn) => fn.mockReset());
  vi.stubEnv('REQUEST_VALIDATION_MODE', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe('the validation mode', () => {
  it('is shadow unless told otherwise, including for an unrecognised value', () => {
    expect(validationMode()).toBe('shadow');
    vi.stubEnv('REQUEST_VALIDATION_MODE', 'strict-please');
    expect(validationMode()).toBe('shadow');
    vi.stubEnv('REQUEST_VALIDATION_MODE', 'enforce');
    expect(validationMode()).toBe('enforce');
    vi.stubEnv('REQUEST_VALIDATION_MODE', 'off');
    expect(validationMode()).toBe('off');
  });
});

describe('shadow mode (the default)', () => {
  it('lets a body that does not match through to the handler untouched, and counts it', async () => {
    const base = await start();
    const res = await post(base, { name: '', score: 9999, surprise: true });
    expect(res.status).toBe(200);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(validationTallies()['test/x']).toEqual({ checked: 1, invalid: 1 });
  });

  it('counts a matching body as checked and says nothing', async () => {
    const base = await start();
    expect((await post(base, { name: 'a', score: 3 })).status).toBe(200);
    expect(validationTallies()['test/x']).toEqual({ checked: 1, invalid: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs the path and code of each problem, never a value from the body', async () => {
    const base = await start();
    await post(base, { name: 'SECRET-ROOM-CODE-XYZ', score: 'SECRET-SCORE-XYZ', extra: 'SECRET-EXTRA-XYZ' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(logger.warn.mock.calls[0]);
    expect(logged).toContain('score');
    expect(logged).toContain('invalid_type');
    expect(logged).not.toContain('SECRET');
    expect(logger.warn.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs a drifting client once per interval per route, not once per request, with the running counts', async () => {
    let clock = 1_000_000;
    const base = await start(() => clock);
    for (let i = 0; i < 5; i += 1) await post(base, { name: '' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    clock += VALIDATION_LOG_INTERVAL_MS;
    await post(base, { name: '' });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[1][0]).toMatchObject({ checked: 6, invalid: 6 });
  });

  it('is exactly the same response as no validation: the same body reaches the handler', async () => {
    const base = await start();
    const res = await post(base, { name: 'a', score: 1 });
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('enforce mode', () => {
  beforeEach(() => vi.stubEnv('REQUEST_VALIDATION_MODE', 'enforce'));

  it('answers a body that does not match with a 400 and a request id, and never calls the handler', async () => {
    const base = await start();
    const res = await post(base, { name: '', score: 1 });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('The request is not valid.');
    expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
    expect(reached).not.toHaveBeenCalled();
  });

  it('still lets a matching body through', async () => {
    const base = await start();
    expect((await post(base, { name: 'a', score: 1 })).status).toBe(200);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('logs every rejection, not just one per interval (a rejection is an event, not drift)', async () => {
    const base = await start(() => 5);
    await post(base, { name: '' });
    await post(base, { name: '' });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe('off', () => {
  it('does no checking at all', async () => {
    vi.stubEnv('REQUEST_VALIDATION_MODE', 'off');
    const base = await start();
    expect((await post(base, { nonsense: true })).status).toBe(200);
    expect(validationTallies()).toEqual({});
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('the Puzzle Rush and record-match schemas', () => {
  const UUID_A = '3d70f65e-e9a1-4c47-abb8-8bf2fc020295';
  const UUID_B = '291bdfc3-f092-47d7-9dcf-d0a20b30d9cf';

  it('accept what the client sends', () => {
    expect(
      puzzleRushReportBody.safeParse({
        runId: '690cdda6-8fe8-4176-81a3-19e4ea587d4e',
        puzzleId: '9feb8808-d53d-4a2f-bee5-991552efb834',
        ordinal: 3,
        clientRawScore: 120,
        submittedLine: [{ tile: { low: 3, high: 4 }, position: 'left' }],
        stageReachedKey: 'warmup',
      }).success,
    ).toBe(true);
    expect(puzzleRushCompleteBody.safeParse({ runId: '690cdda6-8fe8-4176-81a3-19e4ea587d4e', clientReportedScore: 2163 }).success).toBe(true);
    expect(
      recordMatchBody.safeParse({
        mode: 'online', opponentType: 'online', winnerUserId: UUID_A, loserUserId: UUID_B, winnerScore: 150, loserScore: 90, moveCount: 41, roomCode: 'AB12CD',
        metadata: { source: 'live' },
      }).success,
    ).toBe(true);
    // a bot game: no opponent id, null scores, no room, no metadata
    expect(
      recordMatchBody.safeParse({ mode: 'bot', opponentType: 'bot', winnerUserId: UUID_A, loserUserId: null, winnerScore: null, loserScore: null, moveCount: null }).success,
    ).toBe(true);
  });

  it('reject malformed Puzzle Rush bodies', () => {
    const ok = { runId: 'run-abcdefgh', puzzleId: 'puzzle-abcdefgh', ordinal: 1, clientRawScore: 0, submittedLine: [] };
    expect(puzzleRushReportBody.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, ordinal: 0 },
      { ...ok, ordinal: 10_000 },
      { ...ok, ordinal: 1.5 },
      { ...ok, clientRawScore: -1 },
      { ...ok, runId: '' },
      { ...ok, submittedLine: Array.from({ length: 65 }, () => ({})) },
      { ...ok, submittedLine: 'not an array' },
      { ...ok, unexpected: 1 },
    ]) {
      expect(puzzleRushReportBody.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
    expect(puzzleRushCompleteBody.safeParse({ runId: 'run-abcdefgh', clientReportedScore: -5 }).success).toBe(false);
    expect(puzzleRushCompleteBody.safeParse({ runId: 'run-abcdefgh' }).success).toBe(false);
  });

  it('reject malformed record-match bodies, the ones recordUserMatch would quietly turn into null', () => {
    const ok = { mode: 'bot', opponentType: 'bot', winnerUserId: UUID_A, loserUserId: null, winnerScore: 100, loserScore: 50, moveCount: 12 };
    expect(recordMatchBody.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, mode: 'tournament' },
      { ...ok, opponentType: 'robot' },
      { ...ok, winnerUserId: 'not-a-uuid' },
      { ...ok, winnerScore: 201 },
      { ...ok, winnerScore: -1 },
      { ...ok, winnerScore: 1.5 },
      { ...ok, moveCount: -3 },
      { ...ok, roomCode: 'X'.repeat(33) },
      { ...ok, metadata: { big: 'x'.repeat(9_000) } },
      { ...ok, extra: true },
    ]) {
      expect(recordMatchBody.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
  });
});
