import { beforeEach, describe, expect, it } from 'vitest';
import type { PostGameReviewWriteBody } from './postGameReviewWrite.ts';
import {
  REVIEW_WRITE_OUTBOX_KEY,
  REVIEW_WRITE_OUTBOX_MAX_AGE_MS,
  REVIEW_WRITE_OUTBOX_MAX_ENTRIES,
  clearReviewWriteOutbox,
  enqueueReviewWrite,
  flushReviewWriteOutbox,
  listReviewWriteOutbox,
  resetReviewWriteOutboxForTests,
  type ReviewWriteSender,
} from './reviewWriteOutbox.ts';

function body(digest: string): PostGameReviewWriteBody {
  return {
    gameDigest: digest,
    reviewEngineVersion: 'engine-v',
    accuracyModelVersion: 'accuracy-v',
    evaluations: [],
    accuracyModelResult: {} as PostGameReviewWriteBody['accuracyModelResult'],
    mode: 'pvf',
  };
}

describe('review write outbox', () => {
  beforeEach(() => resetReviewWriteOutboxForTests());

  it('parks a review durably, one entry per game', () => {
    enqueueReviewWrite('user-a', body('g1'), 1_000);
    enqueueReviewWrite('user-a', body('g1'), 2_000);
    const entries = listReviewWriteOutbox(2_000);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.queuedAt).toBe(2_000);
    expect(window.localStorage.getItem(REVIEW_WRITE_OUTBOX_KEY)).toContain('g1');
  });

  it('keeps only the newest few, since a replay artifact is large', () => {
    for (let i = 0; i < REVIEW_WRITE_OUTBOX_MAX_ENTRIES + 2; i += 1) enqueueReviewWrite('user-a', body(`g${i}`), 1_000 + i);
    const keys = listReviewWriteOutbox(2_000).map((entry) => entry.key);
    expect(keys).toHaveLength(REVIEW_WRITE_OUTBOX_MAX_ENTRIES);
    expect(keys[0]).toBe(`g${REVIEW_WRITE_OUTBOX_MAX_ENTRIES + 1}`);
  });

  it('drops entries older than a week', () => {
    enqueueReviewWrite('user-a', body('old'), 0);
    expect(listReviewWriteOutbox(REVIEW_WRITE_OUTBOX_MAX_AGE_MS + 1)).toHaveLength(0);
  });

  it('survives a reload: the next load can still send it', async () => {
    enqueueReviewWrite('user-a', body('g1'), Date.now());
    // Simulate a fresh page: the in-memory mirror is gone, localStorage is not.
    const raw = window.localStorage.getItem(REVIEW_WRITE_OUTBOX_KEY);
    resetReviewWriteOutboxForTests();
    window.localStorage.setItem(REVIEW_WRITE_OUTBOX_KEY, raw!);
    const sent: string[] = [];
    const result = await flushReviewWriteOutbox('user-a', async (b) => { sent.push(b.gameDigest); return { ok: true }; });
    expect(sent).toEqual(['g1']);
    expect(result).toMatchObject({ sent: 1, remaining: 0 });
    expect(listReviewWriteOutbox()).toHaveLength(0);
  });

  it('keeps an entry that failed transiently and sends it next time', async () => {
    enqueueReviewWrite('user-a', body('g1'), Date.now());
    const flaky: ReviewWriteSender = async () => ({ ok: false, status: 503 });
    const first = await flushReviewWriteOutbox('user-a', flaky);
    expect(first).toMatchObject({ sent: 0, remaining: 1, refused: [] });
    const second = await flushReviewWriteOutbox('user-a', async () => ({ ok: true }));
    expect(second).toMatchObject({ sent: 1, remaining: 0 });
  });

  it('treats a thrown network error like a failure and keeps the entry', async () => {
    enqueueReviewWrite('user-a', body('g1'), Date.now());
    const result = await flushReviewWriteOutbox('user-a', async () => { throw new Error('offline'); });
    expect(result.remaining).toBe(1);
  });

  it('keeps an entry on 401 (the session may refresh) but drops one the server refuses for good', async () => {
    enqueueReviewWrite('user-a', body('unauth'), Date.now());
    expect((await flushReviewWriteOutbox('user-a', async () => ({ ok: false, status: 401 }))).remaining).toBe(1);
    expect((await flushReviewWriteOutbox('user-a', async () => ({ ok: false, status: 429 }))).remaining).toBe(1);
    const refused = await flushReviewWriteOutbox('user-a', async () => ({ ok: false, status: 400 }));
    expect(refused).toMatchObject({ remaining: 0, refused: ['unauth'] });
  });

  it("never sends another account's review", async () => {
    enqueueReviewWrite('user-a', body('mine'), Date.now());
    const sent: string[] = [];
    const result = await flushReviewWriteOutbox('user-b', async (b) => { sent.push(b.gameDigest); return { ok: true }; });
    expect(sent).toEqual([]);
    expect(result.remaining).toBe(0);
    expect(listReviewWriteOutbox().map((entry) => entry.userId)).toEqual(['user-a']);
  });

  it('clears one account without touching another', () => {
    enqueueReviewWrite('user-a', body('a1'), Date.now());
    enqueueReviewWrite('user-b', body('b1'), Date.now());
    clearReviewWriteOutbox('user-a');
    expect(listReviewWriteOutbox().map((entry) => entry.key)).toEqual(['b1']);
  });

  it('shares one flush between concurrent callers, so a review is not sent twice', async () => {
    enqueueReviewWrite('user-a', body('g1'), Date.now());
    let calls = 0;
    const slow: ReviewWriteSender = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { ok: true }; };
    await Promise.all([flushReviewWriteOutbox('user-a', slow), flushReviewWriteOutbox('user-a', slow)]);
    expect(calls).toBe(1);
  });

  it('still retries within the session when localStorage is full', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    try {
      enqueueReviewWrite('user-a', body('g1'), Date.now());
      expect(listReviewWriteOutbox()).toHaveLength(1);
      const result = await flushReviewWriteOutbox('user-a', async () => ({ ok: true }));
      expect(result.sent).toBe(1);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
