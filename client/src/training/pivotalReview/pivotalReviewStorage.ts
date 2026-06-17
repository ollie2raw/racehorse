import type { PivotalReviewMissReasonId } from './pivotalReviewMissReasons';
import { getMissReasonLabel } from './pivotalReviewMissReasons';
import type { PivotalTurnSelection } from './pivotalTurnSelector';

export type PivotalTurnReflection = {
  moveNumber: number;
  rank: number;
  missReasons: PivotalReviewMissReasonId[];
  note: string;
};

export type PivotalReviewSession = {
  id: string;
  mode: 'bot' | 'multiplayer';
  createdAt: number;
  accuracy: number;
  youScore: number;
  opponentScore: number;
  reflections: PivotalTurnReflection[];
  pivotalMoveNumbers: number[];
};

const PIVOTAL_REVIEW_SESSIONS_KEY = 'racehorse_pivotal_review_sessions_v1';
const MAX_STORED_SESSIONS = 40;

export function buildPivotalReviewSession(input: {
  mode: 'bot' | 'multiplayer';
  selection: PivotalTurnSelection;
  reflections: PivotalTurnReflection[];
  youScore: number;
  opponentScore: number;
}): PivotalReviewSession {
  return {
    id: `${input.mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: input.mode,
    createdAt: Date.now(),
    accuracy: input.selection.analysis.accuracy,
    youScore: input.youScore,
    opponentScore: input.opponentScore,
    reflections: input.reflections,
    pivotalMoveNumbers: input.selection.candidates.map((candidate) => candidate.moveNumber),
  };
}

export function savePivotalReviewSession(session: PivotalReviewSession): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(PIVOTAL_REVIEW_SESSIONS_KEY);
    const existing: PivotalReviewSession[] = raw ? JSON.parse(raw) : [];
    const next = [session, ...existing].slice(0, MAX_STORED_SESSIONS);
    window.localStorage.setItem(PIVOTAL_REVIEW_SESSIONS_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota / parse failures — review still completes in-session.
  }
}

export function loadPivotalReviewSessions(): PivotalReviewSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PIVOTAL_REVIEW_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function countPivotalReviewSessionsThisWeek(windowMs = ONE_WEEK_MS): number {
  const cutoff = Date.now() - windowMs;
  return loadPivotalReviewSessions().filter((session) => session.createdAt >= cutoff).length;
}

export type RecurringMissReasonPattern = {
  reasonId: PivotalReviewMissReasonId;
  label: string;
  count: number;
};

/** Top miss reason across stored sessions (optionally including an unsaved draft). */
export function computeTopRecurringMissReason(
  extraSession?: PivotalReviewSession | null,
  windowMs = ONE_WEEK_MS,
): RecurringMissReasonPattern | null {
  const cutoff = Date.now() - windowMs;
  const sessions = loadPivotalReviewSessions().filter((session) => session.createdAt >= cutoff);
  if (extraSession) sessions.unshift(extraSession);

  const counts = new Map<PivotalReviewMissReasonId, number>();
  for (const session of sessions) {
    for (const reflection of session.reflections) {
      for (const reasonId of reflection.missReasons) {
        counts.set(reasonId, (counts.get(reasonId) ?? 0) + 1);
      }
    }
  }

  let top: RecurringMissReasonPattern | null = null;
  for (const [reasonId, count] of counts) {
    if (!top || count > top.count) {
      top = { reasonId, label: getMissReasonLabel(reasonId), count };
    }
  }
  return top;
}

export function formatPivotalLessonLine(
  reflection: PivotalTurnReflection,
  rating?: string,
  action?: string,
): string {
  const reasonCopy =
    reflection.missReasons.length > 0
      ? reflection.missReasons.map((id) => getMissReasonLabel(id)).join(', ')
      : reflection.note.trim() || 'no reason tagged';

  let hook = 'pivotal moment';
  if (action === 'pass') hook = 'pass with a legal play available';
  else if (rating === 'Blunder') hook = 'blunder on a key line';
  else if (rating === 'Mistake') hook = 'mistake on a key line';
  else if (rating === 'Inaccuracy') hook = 'inaccuracy on a key line';

  return `Turn ${reflection.moveNumber} — ${hook} (${reasonCopy})`;
}
