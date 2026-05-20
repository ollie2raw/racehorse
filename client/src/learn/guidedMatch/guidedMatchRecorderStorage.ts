import {
  GUIDED_MATCH_RECORDER_DRAFT_KEY,
  GUIDED_MATCH_RECORDER_DRAFT_VERSION,
  type GuidedMatchRecorderDraft,
} from './guidedMatchTypes';

function safeRead(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadGuidedMatchRecorderDraft(): GuidedMatchRecorderDraft | null {
  const raw = safeRead(GUIDED_MATCH_RECORDER_DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GuidedMatchRecorderDraft;
    if (
      !parsed ||
      parsed.version !== GUIDED_MATCH_RECORDER_DRAFT_VERSION ||
      parsed.source !== 'recorder' ||
      !parsed.lesson ||
      typeof parsed.lesson.lessonId !== 'string' ||
      typeof parsed.currentMatchSnapshot !== 'string' ||
      !parsed.cursor ||
      typeof parsed.cursor.currentTurnNumber !== 'number' ||
      typeof parsed.cursor.currentChainIndex !== 'number'
    ) {
      return null;
    }
    parsed.cursor.eventCounter =
      typeof parsed.cursor.eventCounter === 'number'
        ? parsed.cursor.eventCounter
        : parsed.lesson.events.length + 1;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGuidedMatchRecorderDraft(draft: GuidedMatchRecorderDraft): boolean {
  return safeWrite(GUIDED_MATCH_RECORDER_DRAFT_KEY, JSON.stringify(draft));
}

export function clearGuidedMatchRecorderDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUIDED_MATCH_RECORDER_DRAFT_KEY);
  } catch {}
}

export function probeGuidedMatchRecorderDraftStorage(): {
  key: string;
  present: boolean;
  parseable: boolean;
} {
  const raw = safeRead(GUIDED_MATCH_RECORDER_DRAFT_KEY);
  if (!raw) {
    return {
      key: GUIDED_MATCH_RECORDER_DRAFT_KEY,
      present: false,
      parseable: false,
    };
  }

  try {
    JSON.parse(raw);
    return {
      key: GUIDED_MATCH_RECORDER_DRAFT_KEY,
      present: true,
      parseable: true,
    };
  } catch {
    return {
      key: GUIDED_MATCH_RECORDER_DRAFT_KEY,
      present: true,
      parseable: false,
    };
  }
}
