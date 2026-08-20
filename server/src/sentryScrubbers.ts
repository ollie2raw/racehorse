import type { ErrorEvent, EventHint } from '@sentry/node';

const REDACTED = '[Filtered]';

function isSensitiveKey(key: string): boolean {
  return key === 'access_token' || key === 'accessToken';
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
  if (event.request?.data != null) {
    event.request.data = scrubSensitiveFields(event.request.data) as typeof event.request.data;
  }
  if (event.request?.headers) {
    const headers = { ...event.request.headers };
    if (typeof headers.Authorization === 'string') headers.Authorization = REDACTED;
    if (typeof headers.authorization === 'string') headers.authorization = REDACTED;
    event.request.headers = headers;
  }
  return event;
}

/** Sentry hook: strip checkpoint unload tokens before events leave the server. */
export function sentryBeforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  void _hint;
  return scrubSentryEventSensitiveData(event);
}
