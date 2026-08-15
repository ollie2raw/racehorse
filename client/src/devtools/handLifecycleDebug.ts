export type HandLifecycleDebugPayload = {
  location: string;
  message: string;
  hypothesisId?: string;
  data?: Record<string, unknown>;
  runId?: string;
};

const HAND_LIFECYCLE_DEBUG_ENDPOINT =
  'http://127.0.0.1:7933/ingest/9cab376f-7897-4cfa-8543-b458c17de979';
const HAND_LIFECYCLE_DEBUG_SESSION = '65d5db';

export function emitHandLifecycleDebugLog(payload: HandLifecycleDebugPayload): void {
  fetch(HAND_LIFECYCLE_DEBUG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': HAND_LIFECYCLE_DEBUG_SESSION,
    },
    body: JSON.stringify({
      sessionId: HAND_LIFECYCLE_DEBUG_SESSION,
      timestamp: Date.now(),
      ...payload,
    }),
  }).catch((error) => {
    if (import.meta.env.DEV) {
      console.warn('[hand-lifecycle-debug] ingest unavailable', error);
    }
  });
}
