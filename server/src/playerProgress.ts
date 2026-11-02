import { childLogger } from './logger';
import { supabaseFetch } from './supabaseUtils';

const log = childLogger('player-progress');

/**
 * Player progress that follows the account (docs/progress-sync.md).
 *
 * Journey progress lived only in the browser, so a second device started from nothing. This keeps a signed-in player's completed Journey stages on the server.
 * Progress only ever grows, so two devices merge without loss: every write is a UNION with what is already stored, never a replacement, which makes the merge
 * commutative, associative and idempotent: devices converge in any order, and a stale device can never take a stage away.
 *
 * Off unless PROGRESS_SYNC_ENABLED is exactly "true", and it also answers "not enabled" while the table does not exist (supabase/migrations/2026-11-02_player_progress.sql),
 * so it is safe to ship before the SQL is applied. The routes in http/routes/progressSyncRoute.ts are the only caller.
 *
 * What the server does NOT know is which stage ids are real: those live in the client's chapter definitions. It stores any well-formed id and the client drops the
 * ones it does not recognise when it reads them back. A player can only write their own progress, and Journey has no leaderboard or reward, so there is nothing to forge.
 */

export function progressSyncEnabled(setting: string | undefined = process.env.PROGRESS_SYNC_ENABLED): boolean {
  return setting === 'true';
}

export const JOURNEY_SCOPE = 'journey';

/** One chapter's synced progress. Everything here is monotone: it can be merged without losing anything. */
export type SyncedJourneyChapter = {
  completedNodeIds: string[];
  /** Chapter One's layout number; absent means 1. A higher layout replaces a lower one wholesale (stage ids are reused across layouts). */
  layoutVersion?: number;
  /** The earliest time the chapter was completed, or null. */
  completedAt: string | null;
  completionCelebrated: boolean;
};

export type SyncedJourneyProgress = { chapters: Record<string, SyncedJourneyChapter> };

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_CHAPTERS = 12;
const MAX_NODES_PER_CHAPTER = 200;
const MAX_LAYOUT_VERSION = 1000;
const MAX_TIMESTAMP_CHARS = 40;

const layoutOf = (chapter: SyncedJourneyChapter): number => chapter.layoutVersion ?? 1;

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TIMESTAMP_CHARS && Number.isFinite(Date.parse(value));
}

/** Clean one chapter or say it is malformed. Unknown keys are dropped. */
function parseChapter(value: unknown): SyncedJourneyChapter | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.completedNodeIds) || raw.completedNodeIds.length > MAX_NODES_PER_CHAPTER) return null;
  const ids = new Set<string>();
  for (const id of raw.completedNodeIds) {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    ids.add(id);
  }
  let layoutVersion: number | undefined;
  if (raw.layoutVersion !== undefined && raw.layoutVersion !== null) {
    if (!Number.isInteger(raw.layoutVersion) || (raw.layoutVersion as number) < 1 || (raw.layoutVersion as number) > MAX_LAYOUT_VERSION) return null;
    layoutVersion = raw.layoutVersion as number;
  }
  const completedAt = raw.completedAt === undefined || raw.completedAt === null ? null : raw.completedAt;
  if (completedAt !== null && !validTimestamp(completedAt)) return null;
  if (raw.completionCelebrated !== undefined && typeof raw.completionCelebrated !== 'boolean') return null;
  return {
    completedNodeIds: [...ids].sort(),
    ...(layoutVersion !== undefined ? { layoutVersion } : {}),
    completedAt,
    completionCelebrated: raw.completionCelebrated === true,
  };
}

/** Clean a payload from a client (or from the table) or say it is malformed. */
export function parseJourneyProgress(value: unknown): SyncedJourneyProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawChapters = (value as Record<string, unknown>).chapters;
  if (!rawChapters || typeof rawChapters !== 'object' || Array.isArray(rawChapters)) return null;
  const entries = Object.entries(rawChapters as Record<string, unknown>);
  if (entries.length > MAX_CHAPTERS) return null;
  const chapters: Record<string, SyncedJourneyChapter> = {};
  for (const [chapterId, chapterValue] of entries) {
    if (!ID.test(chapterId)) return null;
    const chapter = parseChapter(chapterValue);
    if (!chapter) return null;
    chapters[chapterId] = chapter;
  }
  return { chapters };
}

export const EMPTY_JOURNEY_PROGRESS: SyncedJourneyProgress = { chapters: {} };

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/**
 * The merge. For one chapter: a higher layout wins wholesale (the lower one was recorded against stage ids that now mean something else); equal layouts
 * union their completed stages, keep the earliest completion time, and OR the celebrated flag. Commutative, associative and idempotent.
 */
export function mergeJourneyChapter(a: SyncedJourneyChapter, b: SyncedJourneyChapter): SyncedJourneyChapter {
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

export function mergeJourneyProgress(a: SyncedJourneyProgress, b: SyncedJourneyProgress): SyncedJourneyProgress {
  const chapters: Record<string, SyncedJourneyChapter> = {};
  for (const chapterId of new Set([...Object.keys(a.chapters), ...Object.keys(b.chapters)])) {
    const left = a.chapters[chapterId];
    const right = b.chapters[chapterId];
    chapters[chapterId] = left && right ? mergeJourneyChapter(left, right) : (left ?? right)!;
  }
  return { chapters };
}

// ─── The table ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** True when PostgREST says the table is not there (the flag was set, or the route hit, before the SQL was applied). */
export function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(message);
}

type StoredRow = { data: unknown; revision: number };

const ROW_PATH = (userId: string) => `user_id=eq.${encodeURIComponent(userId)}&scope=eq.${JOURNEY_SCOPE}`;

async function loadRow(userId: string): Promise<StoredRow | null> {
  const rows = await supabaseFetch<StoredRow[] | undefined>(`/rest/v1/player_progress?select=data,revision&${ROW_PATH(userId)}&limit=1`, { method: 'GET' });
  return Array.isArray(rows) && rows.length > 0 ? rows[0]! : null;
}

/** The player's stored Journey progress, or null when there is none yet. A row that no longer parses reads as none rather than failing the request. */
export async function loadJourneyProgress(userId: string): Promise<SyncedJourneyProgress | null> {
  const row = await loadRow(userId);
  return row ? (parseJourneyProgress(row.data) ?? EMPTY_JOURNEY_PROGRESS) : null;
}

const MAX_WRITE_ATTEMPTS = 4;

/**
 * Unions `incoming` into what is stored and returns the result. Optimistic: two devices writing at once each read a revision and the loser of the update
 * simply re-reads and merges again, so nothing either device sent is lost. Writes nothing when the union equals what is already stored.
 */
export async function mergeStoredJourneyProgress(userId: string, incoming: SyncedJourneyProgress): Promise<SyncedJourneyProgress> {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const row = await loadRow(userId);
    if (!row) {
      const inserted = await supabaseFetch<unknown[] | undefined>('/rest/v1/player_progress?on_conflict=user_id,scope', {
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
        body: JSON.stringify([{ user_id: userId, scope: JOURNEY_SCOPE, data: incoming }]),
      });
      if (Array.isArray(inserted) && inserted.length > 0) return incoming;
      continue; // someone else created it first: merge into theirs
    }
    const stored = parseJourneyProgress(row.data) ?? EMPTY_JOURNEY_PROGRESS;
    const merged = mergeJourneyProgress(stored, incoming);
    if (JSON.stringify(merged) === JSON.stringify(stored)) return stored;
    const updated = await supabaseFetch<unknown[] | undefined>(`/rest/v1/player_progress?${ROW_PATH(userId)}&revision=eq.${row.revision}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ data: merged, revision: row.revision + 1, updated_at: new Date().toISOString() }),
    });
    if (Array.isArray(updated) && updated.length > 0) return merged;
  }
  log.warn({ userId }, 'player progress write kept losing the race');
  throw new Error('progress_write_conflict');
}
