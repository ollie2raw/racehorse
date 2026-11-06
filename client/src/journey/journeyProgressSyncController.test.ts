import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, getJourneyChapterById } from './journeyChapters';
import { EMPTY_SYNCED, mergeSynced, readSyncedProgress, toSyncedProgress, type SyncedProgress } from './journeyProgressSync';
import { createJourneyProgressSync, type ProgressSyncResponse } from './journeyProgressSyncController';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';
import type { JourneyProgress } from './journeyTypes';

const ids = getJourneyChapterById(JOURNEY_CHAPTER_1_ID)!.nodes.map((node) => node.id);

const progressWith = (completed: string[]): JourneyProgress => ({
  version: 2,
  activeChapterId: JOURNEY_CHAPTER_1_ID,
  chapters: {
    [JOURNEY_CHAPTER_1_ID]: { completedNodeIds: completed, lastVisitedNodeId: null, completedAt: null, completionCelebrated: false, layoutVersion: JOURNEY_CHAPTER_ONE_LAYOUT_VERSION },
  },
  updatedAt: new Date(0).toISOString(),
});
const completedOf = (progress: JourneyProgress): string[] => [...progress.chapters[JOURNEY_CHAPTER_1_ID]!.completedNodeIds].sort();

/** An in-memory stand-in for the server: it only ever unions, like the real one. */
function fakeServer(initial: SyncedProgress | null = null) {
  const server = {
    state: initial as SyncedProgress | null,
    enabled: true,
    failing: false,
    gets: 0,
    posts: [] as SyncedProgress[],
    async get(): Promise<ProgressSyncResponse> {
      server.gets += 1;
      if (server.failing) return { ok: false };
      return { ok: true, enabled: server.enabled, progress: server.enabled ? server.state : null };
    },
    async post(progress: SyncedProgress): Promise<ProgressSyncResponse> {
      server.posts.push(progress);
      if (server.failing) return { ok: false };
      if (!server.enabled) return { ok: true, enabled: false, progress: null };
      server.state = mergeSynced(server.state ?? EMPTY_SYNCED, readSyncedProgress(progress));
      return { ok: true, enabled: true, progress: server.state };
    },
  };
  return server;
}

/** One device: its own local progress, a controller against the shared server, and a `save` that behaves like the real one (announces the write). */
function device(server: ReturnType<typeof fakeServer>, completed: string[], options: { scopeIsCurrent?: () => boolean } = {}) {
  const state = { progress: progressWith(completed), applied: 0 };
  const controller = createJourneyProgressSync({
    get: () => server.get(),
    post: (progress) => server.post(progress),
    load: () => state.progress,
    save: (progress) => {
      state.progress = progress;
      controller.schedulePush(); // the real saveJourneyProgress emits "saved", which the hook turns into schedulePush
    },
    scopeIsCurrent: options.scopeIsCurrent ?? (() => true),
    onApplied: () => { state.applied += 1; },
    debounceMs: 2_000,
  });
  return {
    state,
    controller,
    /** The player completes another stage on this device. */
    complete(id: string) {
      state.progress = progressWith([...completedOf(state.progress), id]);
      controller.schedulePush();
    },
  };
}

const serverHas = (server: ReturnType<typeof fakeServer>): string[] => server.state?.chapters[JOURNEY_CHAPTER_1_ID]?.completedNodeIds ?? [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('sign-in pull', () => {
  it('brings the stages another device completed into this one, and sends back the ones the server lacks', async () => {
    const server = fakeServer(toSyncedProgress(progressWith([ids[1]!, ids[2]!])));
    const phone = device(server, [ids[0]!]);
    await phone.controller.start();
    expect(completedOf(phone.state.progress)).toEqual([ids[0], ids[1], ids[2]].sort());
    expect([...serverHas(server)].sort()).toEqual([ids[0], ids[1], ids[2]].sort());
    expect(phone.state.applied).toBe(1);
  });

  it('a new device with nothing local just receives, and sends nothing', async () => {
    const server = fakeServer(toSyncedProgress(progressWith([ids[0]!, ids[1]!])));
    const fresh = device(server, []);
    await fresh.controller.start();
    expect(completedOf(fresh.state.progress)).toEqual([ids[0], ids[1]].sort());
    expect(server.posts).toHaveLength(0);
  });

  it('does not send anything when the server already holds all of it', async () => {
    const server = fakeServer(toSyncedProgress(progressWith([ids[0]!, ids[1]!])));
    const same = device(server, [ids[0]!]);
    await same.controller.start();
    expect(server.posts).toHaveLength(0);
  });

  it('a player with no progress anywhere makes one request and writes nothing', async () => {
    const server = fakeServer(null);
    const empty = device(server, []);
    await empty.controller.start();
    expect(server.gets).toBe(1);
    expect(server.posts).toHaveLength(0);
    expect(empty.state.applied).toBe(0);
  });
});

describe('push after a local change', () => {
  it('waits for the debounce, then sends once however many stages were completed meanwhile', async () => {
    const server = fakeServer(null);
    const phone = device(server, []);
    await phone.controller.start();
    phone.complete(ids[0]!);
    phone.complete(ids[1]!);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(server.posts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(server.posts).toHaveLength(1);
    expect([...serverHas(server)].sort()).toEqual([ids[0], ids[1]].sort());
  });

  it('flushNow sends without waiting', async () => {
    const server = fakeServer(null);
    const phone = device(server, []);
    await phone.controller.start();
    phone.complete(ids[0]!);
    await phone.controller.flushNow();
    expect(serverHas(server)).toEqual([ids[0]]);
  });

  it('applying what the server sent does not make this device send it straight back (no ping-pong)', async () => {
    const server = fakeServer(toSyncedProgress(progressWith([ids[1]!])));
    const phone = device(server, []);
    await phone.controller.start(); // applies [ids[1]], whose save schedules a push
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.posts).toHaveLength(0);
  });
});

describe('two devices', () => {
  it('converge on the union, in either order, and neither loses a stage', async () => {
    const server = fakeServer(null);
    const phone = device(server, []);
    const laptop = device(server, []);
    await phone.controller.start();
    await laptop.controller.start();

    phone.complete(ids[0]!);
    laptop.complete(ids[1]!);
    await vi.advanceTimersByTimeAsync(5_000); // both push; the server now holds both stages
    expect([...serverHas(server)].sort()).toEqual([ids[0], ids[1]].sort());
    // The laptop pushed second, so its answer already carried the phone's stage; the phone learns the laptop's on its next pull (the tab returning, or the next sign-in).
    expect(completedOf(laptop.state.progress)).toEqual([ids[0], ids[1]].sort());
    expect(completedOf(phone.state.progress)).toEqual([ids[0]]);
    await phone.controller.refresh();
    expect(completedOf(phone.state.progress)).toEqual([ids[0], ids[1]].sort());
  });

  it('a stale device that comes online later cannot take anything away', async () => {
    const server = fakeServer(toSyncedProgress(progressWith([ids[0]!, ids[1]!, ids[2]!])));
    const stale = device(server, [ids[0]!]);
    await stale.controller.start();
    expect([...serverHas(server)].sort()).toEqual([ids[0], ids[1], ids[2]].sort());
    expect(completedOf(stale.state.progress)).toEqual([ids[0], ids[1], ids[2]].sort());
  });
});

describe('offline safety', () => {
  it('a failed pull changes nothing locally and is retried with a delay, then succeeds', async () => {
    const server = fakeServer(toSyncedProgress(progressWith([ids[1]!])));
    server.failing = true;
    const phone = device(server, [ids[0]!]);
    await phone.controller.start();
    expect(completedOf(phone.state.progress)).toEqual([ids[0]]);
    expect(phone.state.applied).toBe(0);

    server.failing = false;
    await vi.advanceTimersByTimeAsync(5_001);
    expect(completedOf(phone.state.progress)).toEqual([ids[0], ids[1]].sort());
    expect([...serverHas(server)].sort()).toEqual([ids[0], ids[1]].sort());
  });

  it('a failed push keeps the local progress and lands later, with a growing delay', async () => {
    const server = fakeServer(null);
    const phone = device(server, []);
    await phone.controller.start();
    server.failing = true;
    phone.complete(ids[0]!);
    await vi.advanceTimersByTimeAsync(2_001); // the push fails
    expect(completedOf(phone.state.progress)).toEqual([ids[0]]);
    expect(serverHas(server)).toEqual([]);

    await vi.advanceTimersByTimeAsync(5_001); // first retry, still failing: next delay doubles
    const postsAfterFirstRetry = server.posts.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.posts.length).toBe(postsAfterFirstRetry); // not yet
    server.failing = false;
    await vi.advanceTimersByTimeAsync(5_001);
    expect(serverHas(server)).toEqual([ids[0]]);
  });

  it('retryNow does nothing when nothing has failed, and tries again when something has', async () => {
    const server = fakeServer(null);
    const phone = device(server, []);
    await phone.controller.start();
    const getsBefore = server.gets;
    await phone.controller.retryNow();
    expect(server.gets).toBe(getsBefore);

    server.failing = true;
    phone.complete(ids[0]!);
    await vi.advanceTimersByTimeAsync(2_001);
    server.failing = false;
    await phone.controller.retryNow();
    expect(serverHas(server)).toEqual([ids[0]]);
  });

  it('a transport that throws is a failed request, not an unhandled rejection', async () => {
    const phone = createJourneyProgressSync({
      get: () => Promise.reject(new Error('network down')),
      post: () => Promise.reject(new Error('network down')),
      load: () => progressWith([ids[0]!]),
      save: () => undefined,
      scopeIsCurrent: () => true,
      onApplied: () => undefined,
    });
    await expect(phone.start()).resolves.toBeUndefined();
    phone.dispose();
  });
});

describe('when the server does not do sync (flag off, table not created, an older server)', () => {
  it('does nothing locally, asks nothing more, and stays quiet', async () => {
    const server = fakeServer(toSyncedProgress(progressWith([ids[1]!])));
    server.enabled = false;
    const phone = device(server, [ids[0]!]);
    await phone.controller.start();
    expect(completedOf(phone.state.progress)).toEqual([ids[0]]);
    expect(phone.state.applied).toBe(0);

    phone.complete(ids[2]!);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.gets).toBe(1);
    expect(server.posts).toHaveLength(0);
    expect(completedOf(phone.state.progress)).toEqual([ids[0], ids[2]].sort());
  });
});

describe('account changes and shutdown', () => {
  it('drops an answer that arrives after the account changed, instead of writing it into the next account', async () => {
    const server = fakeServer(toSyncedProgress(progressWith([ids[1]!])));
    let signedInAs = 'user-a';
    const phone = device(server, [], { scopeIsCurrent: () => signedInAs === 'user-a' });
    const started = phone.controller.start();
    signedInAs = 'user-b'; // the account switches while the request is in flight
    await started;
    expect(completedOf(phone.state.progress)).toEqual([]);
    expect(phone.state.applied).toBe(0);
    expect(server.posts).toHaveLength(0);
  });

  it('dispose stops pending pushes and retries', async () => {
    const server = fakeServer(null);
    const phone = device(server, []);
    await phone.controller.start();
    phone.complete(ids[0]!);
    phone.controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.posts).toHaveLength(0);
  });

  it('a change made while a request is in flight earns one more cycle afterwards', async () => {
    const server = fakeServer(null);
    const phone = device(server, []);
    await phone.controller.start();
    phone.complete(ids[0]!);
    const first = phone.controller.flushNow();
    phone.state.progress = progressWith([ids[0]!, ids[1]!]);
    void phone.controller.flushNow(); // arrives while the first is running
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect([...serverHas(server)].sort()).toEqual([ids[0], ids[1]].sort());
  });
});
