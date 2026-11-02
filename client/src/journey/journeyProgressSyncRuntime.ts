import { apiGet, apiPost } from '../api/client';
import { createJourneyProgressSync } from './journeyProgressSyncController';
import type { ProgressSyncResponse } from './journeyProgressSyncController';
import { emitJourneyProgressApplied, onJourneyProgressSaved } from './journeyProgressEvents';
import { loadJourneyProgress, saveJourneyProgress } from './journeyStorage';
import { getJourneyStorageUser } from './journeyStorageScope';

const JOURNEY_PROGRESS_PATH = '/api/progress/journey';
/** Coming back to the tab pulls again, but not more often than this. */
const REFRESH_AFTER_HIDDEN_MS = 60_000;

type ProgressReply = { enabled?: boolean; progress?: unknown };

/** The server's answer as the controller reads it. A route this server does not have (404) is the same as "not enabled": the client simply does nothing. */
export function toResponse(result: { data: ProgressReply | null; error: string | null; status?: number }): ProgressSyncResponse {
  if (result.status === 404) return { ok: true, enabled: false, progress: null };
  if (result.error || !result.data) return { ok: false };
  return { ok: true, enabled: result.data.enabled === true, progress: result.data.progress ?? null };
}

/**
 * Starts the account sync for one signed-in user and returns the function that stops it. Everything that needs Journey's chapter definitions lives here, and this
 * module is loaded on demand (see useJourneyProgressSync) so none of it sits in the main bundle.
 *
 * The local store must already point at this user's namespace (`useJourneyStorageScope` does that during render); the controller checks it again before it reads or
 * writes anything, so a late answer for the previous account is dropped instead of applied to the next.
 */
export function startJourneyProgressSync(userId: string): () => void {
  const controller = createJourneyProgressSync({
    get: async () => toResponse(await apiGet<ProgressReply>(JOURNEY_PROGRESS_PATH)),
    post: async (progress) => toResponse(await apiPost<ProgressReply>(JOURNEY_PROGRESS_PATH, { progress })),
    load: loadJourneyProgress,
    save: (progress) => {
      saveJourneyProgress(progress);
    },
    scopeIsCurrent: () => getJourneyStorageUser() === userId,
    onApplied: emitJourneyProgressApplied,
  });

  const offSaved = onJourneyProgressSaved(() => controller.schedulePush());
  void controller.start();

  let hiddenAt: number | null = null;
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      void controller.flushNow();
      return;
    }
    void controller.retryNow();
    if (hiddenAt !== null && Date.now() - hiddenAt >= REFRESH_AFTER_HIDDEN_MS) void controller.refresh();
    hiddenAt = null;
  };
  const onOnline = () => void controller.retryNow();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);

  return () => {
    offSaved();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    controller.dispose();
  };
}
