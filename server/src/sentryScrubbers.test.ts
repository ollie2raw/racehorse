import { describe, expect, it } from 'vitest';
import { scrubSensitiveFields, scrubSentryEventSensitiveData } from './sentryScrubbers';

describe('scrubSensitiveFields', () => {
  it('redacts access_token and accessToken while preserving other fields', () => {
    const scrubbed = scrubSensitiveFields({
      attempt_id: 'attempt-1',
      access_token: 'secret-jwt',
      nested: { accessToken: 'nested-secret', gameNumber: 1 },
    }) as Record<string, unknown>;

    expect(scrubbed.attempt_id).toBe('attempt-1');
    expect(scrubbed.access_token).toBe('[Filtered]');
    expect(scrubbed.nested).toEqual({ accessToken: '[Filtered]', gameNumber: 1 });
  });

  it('scrubs JSON string request bodies', () => {
    const raw = JSON.stringify({
      verified_match_id: 'match-1',
      access_token: 'secret-jwt',
    });
    const scrubbed = JSON.parse(String(scrubSensitiveFields(raw))) as Record<string, unknown>;
    expect(scrubbed.verified_match_id).toBe('match-1');
    expect(scrubbed.access_token).toBe('[Filtered]');
  });

  it('leaves non-token payloads unchanged', () => {
    const payload = {
      attempt_id: 'attempt-1',
      checkpoint: { checkpointRevision: 4, currentHandIndex: 2 },
      error: 'validation failed',
    };
    expect(scrubSensitiveFields(payload)).toEqual(payload);
  });
});

describe('scrubSentryEventSensitiveData', () => {
  it('scrubs request data and Authorization headers without dropping the event', () => {
    const event = scrubSentryEventSensitiveData({
      message: 'checkpoint failed',
      request: {
        url: 'https://racehorse.onrender.com/api/daily-fritz/checkpoint',
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-jwt',
          'content-type': 'application/json',
        },
        data: {
          attempt_id: 'attempt-1',
          access_token: 'secret-jwt',
        },
      },
    });

    expect(event.message).toBe('checkpoint failed');
    expect(event.request?.url).toContain('/api/daily-fritz/checkpoint');
    expect(event.request?.headers?.Authorization).toBe('[Filtered]');
    expect(event.request?.headers?.['content-type']).toBe('application/json');
    expect((event.request?.data as Record<string, unknown>).attempt_id).toBe('attempt-1');
    expect((event.request?.data as Record<string, unknown>).access_token).toBe('[Filtered]');
  });
});
