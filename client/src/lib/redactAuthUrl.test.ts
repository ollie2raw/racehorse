import { describe, expect, it } from 'vitest';
import { redactAuthUrl, redactAuthUrlsInProperties, redactAuthUrlsInSentryEvent } from './redactAuthUrl';

describe('redactAuthUrl', () => {
  it('drops an implicit-flow fragment but keeps origin and path', () => {
    expect(redactAuthUrl('https://playracehorse.com/reset#access_token=AAA&refresh_token=BBB&type=recovery')).toBe('https://playracehorse.com/reset');
  });
  it('drops token and code query parameters but keeps others', () => {
    expect(redactAuthUrl('/x?ref=mail&access_token=AAA&code=CCC&refresh_token=BBB')).toBe('/x?ref=mail');
  });
  it('leaves ordinary urls and #/route fragments unchanged', () => {
    expect(redactAuthUrl('https://playracehorse.com/play?mode=daily#/lobby')).toBe('https://playracehorse.com/play?mode=daily#/lobby');
    expect(redactAuthUrl('')).toBe('');
  });
  it('redacts sentry request/breadcrumb urls and posthog properties', () => {
    const event = redactAuthUrlsInSentryEvent({
      request: { url: 'https://h/#access_token=A&refresh_token=B' },
      breadcrumbs: [{ data: { from: '/a', to: 'https://h/#access_token=A&refresh_token=B' } }],
    });
    expect(JSON.stringify(event)).not.toMatch(/access_token|refresh_token/);
    const props = redactAuthUrlsInProperties({ $current_url: 'https://h/#access_token=A&refresh_token=B', other: 'access_token=keep' });
    expect(props.$current_url).toBe('https://h/');
    expect(props.other).toBe('access_token=keep');
  });
});
