/**
 * Error text that is safe to show a player.
 *
 * API failures reach the UI as `Error.message`, which can be the server's raw response body
 * (`{"ok":false,"error":"NOT_FOUND"}`) or a bare error code (`not_found`). Those are for logs, not people. Anything that
 * already reads like a sentence is kept; anything that looks like JSON or a code is replaced with `fallback`.
 */
export function playerFacingErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.trim();
  if (!message) return fallback;
  if (message.startsWith('{') || message.startsWith('[')) return fallback;
  // A bare code: one token of letters, digits, underscores or dashes with no spaces ("NOT_FOUND", "rate_limited").
  if (/^[A-Za-z0-9_.:-]+$/.test(message) && (message.includes('_') || message === message.toUpperCase())) return fallback;
  // "HTTP 500", "Request failed with status code 404", "Failed to fetch": transport noise, not a sentence for a player.
  if (/^(http\s*\d{3}|request failed|failed to fetch|networkerror|load failed)/i.test(message)) return fallback;
  return message;
}
