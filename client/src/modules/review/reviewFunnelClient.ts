/**
 * Fire-and-forget funnel counters for review cost decisions:
 *   eligible: a game whose review would previously have started at game over
 *   opened:   the player opened Review Game or a hand review
 * The server counts `started` itself when a job is created. Never awaited,
 * never retried, never surfaces an error.
 */
export type ReviewFunnelEvent = 'eligible' | 'opened';

export function sendReviewFunnelEvent(input: {
  readonly apiBase: string;
  readonly authHeader: string | null;
  readonly event: ReviewFunnelEvent;
  readonly sourceMatchId: string;
}): void {
  if (!input.authHeader) return;
  try {
    void fetch(`${input.apiBase}/api/review-completion-jobs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: input.authHeader },
      body: JSON.stringify({ event: input.event, sourceMatchId: input.sourceMatchId }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Counters must never affect the game.
  }
}
