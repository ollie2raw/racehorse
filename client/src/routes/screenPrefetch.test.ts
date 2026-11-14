// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { connectionAllowsPrefetch } from './screenPrefetch';

function setConnection(connection: object | undefined) {
  Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
}

afterEach(() => setConnection(undefined));

describe('connectionAllowsPrefetch', () => {
  it('allows prefetch when the browser says nothing', () => {
    expect(connectionAllowsPrefetch()).toBe(true);
  });
  it('allows 3g and 4g', () => {
    setConnection({ effectiveType: '3g' });
    expect(connectionAllowsPrefetch()).toBe(true);
    setConnection({ effectiveType: '4g', saveData: false });
    expect(connectionAllowsPrefetch()).toBe(true);
  });
  it('skips prefetch on Save-Data', () => {
    setConnection({ saveData: true, effectiveType: '4g' });
    expect(connectionAllowsPrefetch()).toBe(false);
  });
  it('skips prefetch on 2g and slow-2g', () => {
    setConnection({ effectiveType: '2g' });
    expect(connectionAllowsPrefetch()).toBe(false);
    setConnection({ effectiveType: 'slow-2g' });
    expect(connectionAllowsPrefetch()).toBe(false);
  });
});
