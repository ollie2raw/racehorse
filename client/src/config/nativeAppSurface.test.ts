import { describe, expect, it } from 'vitest';
import { hidesComingSoonSurfaces } from './nativeAppSurface';

describe('hidesComingSoonSurfaces', () => {
  it('hides coming-soon surfaces only in the native app', () => {
    expect(hidesComingSoonSurfaces(true)).toBe(true);
    expect(hidesComingSoonSurfaces(false)).toBe(false);
  });

  it('defaults to the web behaviour in a browser (tests run as web)', () => {
    expect(hidesComingSoonSurfaces()).toBe(false);
  });
});
