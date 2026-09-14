import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/reviewContracts';
import {
  REVIEW_SNAPSHOTS_STORAGE_KEY,
  clearReviewSnapshots,
  loadReviewSnapshots,
  saveReviewSnapshots,
} from './reviewSnapshotStorage.ts';

function makeSnapshot(decisionId: string): ReviewPositionSnapshotV2 {
  // Minimal stand-in — these tests exercise storage round-tripping, not the
  // V2 contract shape itself (that's covered by reviewContracts' own tests).
  return { identifiers: { decisionId } } as unknown as ReviewPositionSnapshotV2;
}

describe('reviewSnapshotStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('round-trips a saved snapshot array through load', () => {
    const snapshots = [makeSnapshot('d1'), makeSnapshot('d2')];
    saveReviewSnapshots(snapshots);
    expect(loadReviewSnapshots()).toEqual(snapshots);
  });

  it('round-trips an empty array without special-casing (the ineligible-session case)', () => {
    saveReviewSnapshots([]);
    expect(loadReviewSnapshots()).toEqual([]);
  });

  it('clear empties previously saved snapshots', () => {
    saveReviewSnapshots([makeSnapshot('d1')]);
    clearReviewSnapshots();
    expect(loadReviewSnapshots()).toBeNull();
  });

  it('load returns null when nothing has been stored', () => {
    expect(loadReviewSnapshots()).toBeNull();
  });

  it('save is a no-op when window is undefined (SSR safety)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => saveReviewSnapshots([makeSnapshot('d1')])).not.toThrow();
  });

  it('load returns null when window is undefined (SSR safety)', () => {
    vi.stubGlobal('window', undefined);
    expect(loadReviewSnapshots()).toBeNull();
  });

  it('clear is a no-op when window is undefined (SSR safety)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => clearReviewSnapshots()).not.toThrow();
  });

  it('load degrades to null on malformed stored JSON rather than throwing', () => {
    window.localStorage.setItem(REVIEW_SNAPSHOTS_STORAGE_KEY, 'not valid json{');
    expect(loadReviewSnapshots()).toBeNull();
  });

  it('load degrades to null when stored value is not an array', () => {
    window.localStorage.setItem(REVIEW_SNAPSHOTS_STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(loadReviewSnapshots()).toBeNull();
  });

  it('save degrades silently (does not throw) when localStorage.setItem throws (e.g. quota exceeded)', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveReviewSnapshots([makeSnapshot('d1')])).not.toThrow();
  });
});
