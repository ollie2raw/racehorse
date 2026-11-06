/**
 * The pure half of Journey's account sync (docs/progress-sync.md): what is sent, how two copies merge, and how a merged copy is applied to the local store.
 * No I/O here; journeyProgressSyncController.ts does the talking.
 *
 * Progress only ever grows, so every rule is a union: a completed stage is never removed by a merge, whichever device it arrives from, in whatever order.
 * `mergeSynced` is the same rule as `mergeJourneyProgress` in server/src/playerProgress.ts (the server cannot import client code); both test files run the same
 * vectors, so they cannot drift apart unnoticed.
 *
 * Only what is monotone is synced: completed stages, the earliest completion time and whether the finish was celebrated. The last-visited stage and the active
 * chapter are per-device and stay local.
 */
import { JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, createEmptyChapterProgress, getJourneyChapterById } from './journeyChapters';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';
import type { JourneyChapterProgress, JourneyProgress } from './journeyTypes';

export type SyncedChapter = {
  completedNodeIds: string[];
  layoutVersion?: number;
  completedAt: string | null;
  completionCelebrated: boolean;
};
export type SyncedProgress = { chapters: Record<string, SyncedChapter> };

export const EMPTY_SYNCED: SyncedProgress = { chapters: {} };

/** The server's limits (server/src/playerProgress.ts); sending more would get the whole request refused. */
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_NODES_PER_CHAPTER = 200;

const layoutOf = (chapter: { layoutVersion?: number }): number => chapter.layoutVersion ?? 1;

/** The layout this build understands for a chapter: Chapter One's is versioned, the others have only ever had the first. */
function currentLayout(chapterId: string): number {
  return chapterId === JOURNEY_CHAPTER_1_ID ? JOURNEY_CHAPTER_ONE_LAYOUT_VERSION : 1;
}

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/** What goes to the server for these local progress: only chapters with something completed, only what the server accepts, ids sorted. */
export function toSyncedProgress(progress: JourneyProgress): SyncedProgress {
  const chapters: Record<string, SyncedChapter> = {};
  for (const [chapterId, chapter] of Object.entries(progress.chapters)) {
    if (!ID.test(chapterId)) continue;
    const ids = [...new Set(chapter.completedNodeIds.filter((id) => ID.test(id)))].sort().slice(0, MAX_NODES_PER_CHAPTER);
    if (ids.length === 0) continue;
    chapters[chapterId] = {
      completedNodeIds: ids,
      ...(chapter.layoutVersion !== undefined ? { layoutVersion: chapter.layoutVersion } : {}),
      completedAt: chapter.completedAt ?? null,
      completionCelebrated: chapter.completionCelebrated === true,
    };
  }
  return { chapters };
}

/** Same rule as the server's merge: a higher layout replaces a lower one wholesale; equal layouts union, keep the earliest completion and OR the celebrated flag. */
export function mergeSyncedChapter(a: SyncedChapter, b: SyncedChapter): SyncedChapter {
  const la = layoutOf(a);
  const lb = layoutOf(b);
  if (la !== lb) return la > lb ? a : b;
  return {
    completedNodeIds: [...new Set([...a.completedNodeIds, ...b.completedNodeIds])].sort(),
    ...(a.layoutVersion !== undefined || b.layoutVersion !== undefined ? { layoutVersion: la } : {}),
    completedAt: earlier(a.completedAt, b.completedAt),
    completionCelebrated: a.completionCelebrated || b.completionCelebrated,
  };
}

export function mergeSynced(a: SyncedProgress, b: SyncedProgress): SyncedProgress {
  const chapters: Record<string, SyncedChapter> = {};
  for (const chapterId of new Set([...Object.keys(a.chapters), ...Object.keys(b.chapters)])) {
    const left = a.chapters[chapterId];
    const right = b.chapters[chapterId];
    chapters[chapterId] = left && right ? mergeSyncedChapter(left, right) : (left ?? right)!;
  }
  return { chapters };
}

const chapterSignature = (chapter: SyncedChapter): string =>
  [chapter.completedNodeIds.join(','), layoutOf(chapter), chapter.completedAt ?? '', chapter.completionCelebrated ? 1 : 0].join('|');

/** Same content, whatever the key or id order. An absent layout and an explicit 1 are the same layout. */
export function syncedEqual(a: SyncedProgress, b: SyncedProgress): boolean {
  const left = Object.keys(a.chapters).sort();
  const right = Object.keys(b.chapters).sort();
  if (left.length !== right.length || left.some((key, index) => key !== right[index])) return false;
  return left.every((key) => chapterSignature(a.chapters[key]!) === chapterSignature(b.chapters[key]!));
}

/** Reads what the server sent defensively: it is data, and anything that does not fit is dropped rather than trusted. */
export function readSyncedProgress(value: unknown): SyncedProgress {
  if (!value || typeof value !== 'object') return EMPTY_SYNCED;
  const rawChapters = (value as { chapters?: unknown }).chapters;
  if (!rawChapters || typeof rawChapters !== 'object') return EMPTY_SYNCED;
  const chapters: Record<string, SyncedChapter> = {};
  for (const [chapterId, raw] of Object.entries(rawChapters as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const chapter = raw as Partial<SyncedChapter>;
    if (!Array.isArray(chapter.completedNodeIds)) continue;
    const layoutVersion = typeof chapter.layoutVersion === 'number' && Number.isInteger(chapter.layoutVersion) && chapter.layoutVersion >= 1 ? chapter.layoutVersion : undefined;
    chapters[chapterId] = {
      completedNodeIds: [...new Set(chapter.completedNodeIds.filter((id): id is string => typeof id === 'string'))].sort(),
      ...(layoutVersion !== undefined ? { layoutVersion } : {}),
      completedAt: typeof chapter.completedAt === 'string' && Number.isFinite(Date.parse(chapter.completedAt)) ? chapter.completedAt : null,
      completionCelebrated: chapter.completionCelebrated === true,
    };
  }
  return { chapters };
}

/**
 * The local progress with a merged copy applied, or null when it would change nothing. Per chapter:
 *   - a chapter this build does not know is skipped;
 *   - a copy recorded against a NEWER layout than this build understands is skipped (it cannot be read here, and the older build's own stages must not be replaced by it);
 *   - a copy recorded against an OLDER layout than the local one is stale and ignored (its stage ids now mean something else);
 *   - a newer local layout than the stored one cannot happen after a load, but would take the incoming copy wholesale;
 *   - otherwise the stages are unioned, and the chapter is stamped complete (earliest time) only if every one of its stages is now done.
 * Stage ids this build does not define are dropped, the same filter a load applies. The result is NOT saved here.
 */
export function applySyncedToLocal(local: JourneyProgress, incoming: SyncedProgress): JourneyProgress | null {
  let changed = false;
  const chapters: Record<string, JourneyChapterProgress> = { ...local.chapters };

  for (const [chapterId, remote] of Object.entries(incoming.chapters)) {
    const definition = getJourneyChapterById(chapterId);
    if (!definition) continue;
    const remoteLayout = layoutOf(remote);
    if (remoteLayout > currentLayout(chapterId)) continue;

    const current = chapters[chapterId] ?? createEmptyChapterProgress();
    const localLayout = layoutOf(current);
    if (remoteLayout < localLayout) continue;

    const valid = new Set(definition.nodes.map((node) => node.id));
    const remoteIds = remote.completedNodeIds.filter((id) => valid.has(id));
    const base = remoteLayout > localLayout ? [] : current.completedNodeIds;
    const completedNodeIds = [...base, ...remoteIds.filter((id) => !base.includes(id))];

    const allComplete = definition.nodes.every((node) => completedNodeIds.includes(node.id));
    const completedAt = allComplete ? earlier(remoteLayout > localLayout ? null : current.completedAt, remote.completedAt) : null;
    const completionCelebrated = allComplete && (remote.completionCelebrated || (remoteLayout === localLayout && current.completionCelebrated));

    const next: JourneyChapterProgress = {
      ...current,
      completedNodeIds,
      completedAt,
      completionCelebrated,
      ...(remote.layoutVersion !== undefined ? { layoutVersion: remote.layoutVersion } : {}),
    };

    const same =
      next.completedNodeIds.join('|') === current.completedNodeIds.join('|') &&
      next.completedAt === current.completedAt &&
      next.completionCelebrated === current.completionCelebrated &&
      next.layoutVersion === current.layoutVersion;
    if (same) continue;
    changed = true;
    chapters[chapterId] = next;
  }

  return changed ? { ...local, chapters } : null;
}
