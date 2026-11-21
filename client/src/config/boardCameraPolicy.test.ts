// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BOARD_CAMERA_POLICY_STORAGE_KEY, parseBoardCameraPolicy, resolveBoardCameraPolicy } from './boardCameraPolicy';

describe('board camera policy flag', () => {
  it('is policy A ("full") unless something says otherwise', () => {
    expect(resolveBoardCameraPolicy(undefined, () => null)).toBe('full');
    expect(resolveBoardCameraPolicy('', () => null)).toBe('full');
  });

  it('only the exact strings count: anything else is "full"', () => {
    for (const v of ['COMFORT', 'true', '1', 'on', 'comfort ', 'b', 0, true, {}]) expect(parseBoardCameraPolicy(v), String(v)).toBeNull();
    expect(resolveBoardCameraPolicy('COMFORT', () => 'yes')).toBe('full');
  });

  it('the build variable selects "comfort"', () => {
    expect(resolveBoardCameraPolicy('comfort', () => null)).toBe('comfort');
  });

  it('the stored override beats the build variable, both ways (so one build can be compared on a device and rolled back there)', () => {
    expect(resolveBoardCameraPolicy(undefined, () => 'comfort')).toBe('comfort');
    expect(resolveBoardCameraPolicy('comfort', () => 'full')).toBe('full');
    expect(resolveBoardCameraPolicy('full', () => 'comfort')).toBe('comfort');
  });

  it('blocked storage means no override, not a crash', () => {
    expect(resolveBoardCameraPolicy('comfort', () => { throw new Error('denied'); })).toBe('comfort');
    expect(resolveBoardCameraPolicy(undefined, () => { throw new Error('denied'); })).toBe('full');
  });

  it('the default reader uses localStorage under the documented key', () => {
    window.localStorage.setItem(BOARD_CAMERA_POLICY_STORAGE_KEY, 'comfort');
    expect(resolveBoardCameraPolicy(undefined)).toBe('comfort');
    window.localStorage.removeItem(BOARD_CAMERA_POLICY_STORAGE_KEY);
    expect(resolveBoardCameraPolicy(undefined)).toBe('full');
  });
});
