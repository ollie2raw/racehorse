const ANALYSIS_STORAGE_VERSION_KEY = 'racehorse_analysis_version';
const ANALYSIS_STORAGE_VERSION = '2';

const LEGACY_ANALYSIS_KEYS = [
  'racehorse_move_analysis_history_v1',
  'racehorse_pivotal_review_sessions_v1',
  'racehorse_hand_analysis_v1',
] as const;

/** One-time silent purge of pre–Fix-1 corrupted analysis localStorage. */
export function migrateAnalysisStorage(): void {
  if (typeof window === 'undefined') return;

  try {
    const current = window.localStorage.getItem(ANALYSIS_STORAGE_VERSION_KEY);
    if (current === ANALYSIS_STORAGE_VERSION) return;

    for (const key of LEGACY_ANALYSIS_KEYS) {
      window.localStorage.removeItem(key);
    }

    window.localStorage.setItem(ANALYSIS_STORAGE_VERSION_KEY, ANALYSIS_STORAGE_VERSION);
  } catch {
    // localStorage unavailable — fail silently
  }
}
