import type { ErrorEvent, EventHint } from '@sentry/node';

const REDACTED = '[Filtered]';

// Exact key match (not substring / not pattern) — kept deliberately narrow so it
// can't over-redact adjacent fields (e.g. `password_set_at`, `email_confirmed`).
// snake_case + camelCase variants are both listed where the field has one.
// CC-5 (HARDENING_PLAN.md §13.3): password / refresh_token / email added as
// defense-in-depth — no server code path attaches any of them to an error
// payload today (auth is client-side against Supabase; the server never handles
// credentials), so this is posture, not a live behaviour change.
function isSensitiveKey(key: string): boolean {
  return key === 'access_token'
    || key === 'accessToken'
    || key === 'admin_key'
    || key === 'adminKey'
    || key === 'password'
    || key === 'refresh_token'
    || key === 'refreshToken'
    || key === 'email';
}

/** Recursively redact bearer/session tokens from structured request payloads. */
export function scrubSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubSensitiveFields);
  }
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input)) {
      output[key] = isSensitiveKey(key) ? REDACTED : scrubSensitiveFields(nested);
    }
    return output;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(scrubSensitiveFields(parsed));
      }
    } catch {
      /* leave non-JSON strings untouched */
    }
  }
  return value;
}

export function scrubSentryEventSensitiveData<T extends ErrorEvent>(event: T): T {
  const request = event.request;
  if (request?.data != null) {
    request.data = scrubSensitiveFields(request.data) as typeof request.data;
  }
  if (request?.headers) {
    const headers = { ...request.headers };
    if (typeof headers.Authorization === 'string') headers.Authorization = REDACTED;
    if (typeof headers.authorization === 'string') headers.authorization = REDACTED;
    if (typeof headers['x-admin-secret'] === 'string') headers['x-admin-secret'] = REDACTED;
    request.headers = headers;
  }
  if (typeof request?.query_string === 'string' && request.query_string.includes('admin_key=')) {
    request.query_string = request.query_string.replace(
      /([?&]admin_key=)[^&]*/gi,
      '$1[Filtered]',
    );
  }
  return event;
}

/** Sentry hook: strip checkpoint unload tokens before events leave the server. */
export function sentryBeforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  void _hint;
  return scrubSentryEventSensitiveData(event);
}
