/** True for a request to the speed-measurement ingest/summary routes (Express matches them case-insensitively). */
export function isRumRequest(originalUrl: string): boolean {
  return /^\/api\/rum(?:[/?#]|$)/i.test(originalUrl);
}
