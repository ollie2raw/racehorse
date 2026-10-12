import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthEmailRedirectTo } from './authRedirect';

function at(url: string) {
  vi.stubGlobal('location', new URL(url));
  Object.defineProperty(window, 'location', { value: new URL(url), configurable: true });
}

const original = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', { value: original, configurable: true });
  vi.unstubAllGlobals();
});

describe('getAuthEmailRedirectTo', () => {
  it('web production keeps its own origin', () => {
    at('https://playracehorse.com/settings');
    expect(getAuthEmailRedirectTo(false)).toBe('https://playracehorse.com');
    at('https://www.playracehorse.com/');
    expect(getAuthEmailRedirectTo(false)).toBe('https://www.playracehorse.com');
  });

  it('Vercel previews and the legacy host use the canonical site', () => {
    at('https://racehorsedoms-git-branch.vercel.app/');
    expect(getAuthEmailRedirectTo(false)).toBe('https://playracehorse.com');
    at('https://racehorsedoms.vercel.app/');
    expect(getAuthEmailRedirectTo(false)).toBe('https://playracehorse.com');
  });

  it('local web development keeps localhost', () => {
    at('http://localhost:5173/');
    expect(getAuthEmailRedirectTo(false)).toBe('http://localhost:5173');
  });

  it('the native iOS app never uses capacitor://localhost', () => {
    at('capacitor://localhost/');
    expect(getAuthEmailRedirectTo(true)).toBe('https://playracehorse.com');
  });
});
