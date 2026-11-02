import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGetMock, apiPostMock } = vi.hoisted(() => ({ apiGetMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../api/client', () => ({ apiGet: apiGetMock, apiPost: apiPostMock }));

import { JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, getJourneyChapterById } from './journeyChapters';
import { onJourneyProgressApplied } from './journeyProgressEvents';
import { startJourneyProgressSync, toResponse } from './journeyProgressSyncRuntime';
import { loadJourneyProgress, markJourneyNodeCompleted } from './journeyStorage';
import { setJourneyStorageUser } from './journeyStorageScope';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';

const ids = getJourneyChapterById(JOURNEY_CHAPTER_1_ID)!.nodes.map((node) => node.id);
const remoteCopy = (completed: string[]) => ({
  chapters: { [JOURNEY_CHAPTER_1_ID]: { completedNodeIds: completed, layoutVersion: JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, completedAt: null, completionCelebrated: false } },
});
const reply = (data: { enabled?: boolean; progress?: unknown; reason?: string }, status = 200) => ({ data, error: null, status });
const completedLocally = () => loadJourneyProgress().chapters[JOURNEY_CHAPTER_1_ID]!.completedNodeIds;

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  setJourneyStorageUser('user-a');
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  apiGetMock.mockResolvedValue(reply({ enabled: true, progress: null }));
  apiPostMock.mockImplementation(async (_path: string, body: { progress: unknown }) => reply({ enabled: true, progress: body.progress }));
});
afterEach(() => {
  setJourneyStorageUser(null);
  vi.useRealTimers();
});

describe('toResponse', () => {
  it('reads the server\'s answer: enabled, not enabled, a missing route (404), and a failure', () => {
    expect(toResponse(reply({ enabled: true, progress: null }))).toEqual({ ok: true, enabled: true, progress: null });
    expect(toResponse(reply({ enabled: false, reason: 'disabled' }))).toEqual({ ok: true, enabled: false, progress: null });
    expect(toResponse({ data: null, error: 'Not Found', status: 404 })).toEqual({ ok: true, enabled: false, progress: null });
    expect(toResponse({ data: null, error: 'Failed to fetch' })).toEqual({ ok: false });
    expect(toResponse({ data: null, error: 'boom', status: 500 })).toEqual({ ok: false });
  });
});

describe('a signed-in player\'s sync', () => {
  it('pulls on start and the stages from another device appear in the local store, announced to whatever shows progress', async () => {
    apiGetMock.mockResolvedValue(reply({ enabled: true, progress: remoteCopy([ids[1]!]) }));
    const onApplied = vi.fn();
    const off = onJourneyProgressApplied(onApplied);
    const stop = startJourneyProgressSync('user-a');
    await settle();
    expect(apiGetMock).toHaveBeenCalledWith('/api/progress/journey');
    expect(completedLocally()).toEqual([ids[1]]);
    expect(onApplied).toHaveBeenCalledTimes(1);
    off();
    stop();
  });

  it('pushes a local save after the debounce, sending only what is synced', async () => {
    const stop = startJourneyProgressSync('user-a');
    await settle();
    markJourneyNodeCompleted(ids[0]!);
    await advance(2_001);
    expect(apiPostMock).toHaveBeenCalledTimes(1);
    const [path, body] = apiPostMock.mock.calls[0]! as [string, { progress: { chapters: Record<string, unknown> } }];
    expect(path).toBe('/api/progress/journey');
    expect(body.progress.chapters[JOURNEY_CHAPTER_1_ID]).toMatchObject({ completedNodeIds: [ids[0]] });
    expect(JSON.stringify(body)).not.toContain('lastVisitedNodeId');
    stop();
  });

  it('does nothing, and keeps quiet, when the server says sync is not enabled (flag off or table not created)', async () => {
    apiGetMock.mockResolvedValue(reply({ enabled: false, reason: 'unavailable' }));
    const stop = startJourneyProgressSync('user-a');
    await settle();
    markJourneyNodeCompleted(ids[0]!);
    await advance(30_000);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(completedLocally()).toEqual([ids[0]]);
    stop();
  });

  it('treats a server without the route (404) as not enabled', async () => {
    apiGetMock.mockResolvedValue({ data: null, error: 'Not Found', status: 404 });
    const stop = startJourneyProgressSync('user-a');
    await settle();
    markJourneyNodeCompleted(ids[0]!);
    await advance(30_000);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).not.toHaveBeenCalled();
    stop();
  });

  it('an unreachable server leaves local progress alone and is retried later', async () => {
    apiGetMock.mockResolvedValueOnce({ data: null, error: 'Failed to fetch' });
    markJourneyNodeCompleted(ids[0]!);
    const stop = startJourneyProgressSync('user-a');
    await settle();
    expect(completedLocally()).toEqual([ids[0]]);
    await advance(5_001);
    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiPostMock).toHaveBeenCalledTimes(1); // the stage this device had, now sent
    stop();
  });

  it('stopping cancels a push that is still waiting', async () => {
    const stop = startJourneyProgressSync('user-a');
    await settle();
    markJourneyNodeCompleted(ids[0]!); // a push is now waiting
    stop();
    await advance(10_000);
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('drops the answer that arrives after the account changed, instead of writing it into the next account', async () => {
    let release: (value: unknown) => void = () => undefined;
    apiGetMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const stop = startJourneyProgressSync('user-a');
    await settle();
    setJourneyStorageUser('user-b'); // the account switches while the request is in flight
    release(reply({ enabled: true, progress: remoteCopy([ids[1]!]) }));
    await settle();
    expect(completedLocally()).toEqual([]);
    expect(apiPostMock).not.toHaveBeenCalled();
    stop();
  });

  it('pulls again when the tab returns after a minute, and pushes when it is hidden', async () => {
    const stop = startJourneyProgressSync('user-a');
    await settle();
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    const setVisibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    markJourneyNodeCompleted(ids[0]!);
    setVisibility('hidden');
    await settle();
    expect(apiPostMock).toHaveBeenCalledTimes(1); // flushed at once, not after the debounce

    await advance(61_000);
    setVisibility('visible');
    await settle();
    expect(apiGetMock).toHaveBeenCalledTimes(2);
    stop();
  });
});
