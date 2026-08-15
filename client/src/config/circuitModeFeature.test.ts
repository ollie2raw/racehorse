import { describe, expect, it } from 'vitest';
import {
  isCircuitModeEnabled,
  parseCircuitModeFlag,
  resolveCircuitGatedMode,
} from './circuitModeFeature.ts';

describe('circuitModeFeature', () => {
  it('parses only the explicit string true', () => {
    expect(parseCircuitModeFlag('true')).toBe(true);
    expect(parseCircuitModeFlag('1')).toBe(false);
    expect(parseCircuitModeFlag(true)).toBe(false);
  });

  it('is disabled by default in development and always in production', () => {
    expect(isCircuitModeEnabled(undefined, true)).toBe(false);
    expect(isCircuitModeEnabled(undefined, false)).toBe(false);
    expect(isCircuitModeEnabled('true', false)).toBe(false);
    expect(isCircuitModeEnabled('true', true)).toBe(true);
  });

  it('gates circuit navigation when disabled', () => {
    expect(resolveCircuitGatedMode('circuit', false)).toBe('singlePlayerHub');
    expect(resolveCircuitGatedMode('circuit', true)).toBe('circuit');
    expect(resolveCircuitGatedMode('botSetup', false)).toBe('botSetup');
  });
});
