export type DailyFritzNextHandDebugPayload = {
  location: string;
  message: string;
  hypothesisId?: string;
  data?: Record<string, unknown>;
  runId?: string;
};

const DAILY_FRITZ_DEBUG_INGEST_ENDPOINT =
  'http://127.0.0.1:7933/ingest/9cab376f-7897-4cfa-8543-b458c17de979';
const DAILY_FRITZ_DEBUG_SESSION = '65d5db';

export function ingestDailyFritzNextHandDebug(payload: DailyFritzNextHandDebugPayload): void {
  fetch(DAILY_FRITZ_DEBUG_INGEST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': DAILY_FRITZ_DEBUG_SESSION,
    },
    body: JSON.stringify({
      sessionId: DAILY_FRITZ_DEBUG_SESSION,
      timestamp: Date.now(),
      ...payload,
    }),
  }).catch((error) => {
    if (import.meta.env.DEV) {
      console.warn('[daily-fritz-debug] ingest unavailable', error);
    }
  });
}
