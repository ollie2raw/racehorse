import { describe, expect, it } from 'vitest';
import { buildApiHealthPayload } from './apiHealthPayload';

/**
 * `/api/health` reported `{ok, ts}` and nothing else, so the endpoint most
 * likely to be probed first was the one that could not answer "what commit is
 * live". It now says what `/health` says.
 */
describe('buildApiHealthPayload', () => {
  it('reports the running release alongside the liveness flag', () => {
    const payload = buildApiHealthPayload({ RENDER_GIT_COMMIT: 'abc123' }, () => 1700);

    expect(payload).toEqual({ ok: true, ts: 1700, release: 'abc123' });
  });

  it('still answers when nothing identifies the build', () => {
    expect(buildApiHealthPayload({}, () => 1).release).toBe('dev');
  });

  it('keeps ts a live clock read, not a captured constant', () => {
    // A frozen timestamp would make the endpoint useless for spotting a
    // wedged process.
    let now = 10;
    const clock = () => (now += 5);
    expect(buildApiHealthPayload({}, clock).ts).toBe(15);
    expect(buildApiHealthPayload({}, clock).ts).toBe(20);
  });
});
