import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARM_FALLBACK_MS,
  afterTileImpact,
  armTileImpact,
  claimTileImpact,
  landTileImpact,
  resetTileImpactForTests,
  setTileFlightActive,
} from './tileImpact';

describe('tileImpact: the clack waits for the tile to land', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTileImpactForTests();
  });
  afterEach(() => {
    resetTileImpactForTests();
    vi.useRealTimers();
  });

  it('plays at once when no flights are running (reduced motion, hidden tab, static board)', () => {
    const clack = vi.fn();
    armTileImpact(clack);
    expect(clack).toHaveBeenCalledTimes(1);
  });

  it('holds the clack through a flight and plays it on landing', () => {
    setTileFlightActive(true);
    const clack = vi.fn();
    armTileImpact(clack);
    expect(clack).not.toHaveBeenCalled();

    expect(claimTileImpact(600)).toBe(true);
    vi.advanceTimersByTime(300);
    expect(clack).not.toHaveBeenCalled(); // still in the air

    landTileImpact();
    expect(clack).toHaveBeenCalledTimes(1);
  });

  it('plays the clack anyway when no flight claims it in time (slow round trip, no source to fly from)', () => {
    setTileFlightActive(true);
    const clack = vi.fn();
    armTileImpact(clack);
    vi.advanceTimersByTime(ARM_FALLBACK_MS - 1);
    expect(clack).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(clack).toHaveBeenCalledTimes(1);
  });

  it('plays a claimed clack at the flight maximum if the flight never lands', () => {
    setTileFlightActive(true);
    const clack = vi.fn();
    armTileImpact(clack);
    claimTileImpact(500);
    vi.advanceTimersByTime(499);
    expect(clack).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(clack).toHaveBeenCalledTimes(1);
  });

  it('plays each clack exactly once', () => {
    setTileFlightActive(true);
    const clack = vi.fn();
    armTileImpact(clack);
    claimTileImpact(500);
    landTileImpact();
    landTileImpact();
    vi.advanceTimersByTime(2000);
    expect(clack).toHaveBeenCalledTimes(1);
  });

  it('claims nothing when nothing is armed, and a second claim finds it already taken', () => {
    setTileFlightActive(true);
    expect(claimTileImpact(500)).toBe(false);
    armTileImpact(vi.fn());
    expect(claimTileImpact(500)).toBe(true);
    expect(claimTileImpact(500)).toBe(false);
  });

  it('plays the score ping after the clack, each at its own delay', () => {
    setTileFlightActive(true);
    const order: string[] = [];
    armTileImpact(() => order.push('clack'));
    afterTileImpact(() => order.push('ping'), 80);
    claimTileImpact(600);
    landTileImpact();
    expect(order).toEqual(['clack']);
    vi.advanceTimersByTime(79);
    expect(order).toEqual(['clack']);
    vi.advanceTimersByTime(1);
    expect(order).toEqual(['clack', 'ping']);
  });

  it('plays a score ping on its own delay when there is no clack to follow', () => {
    const ping = vi.fn();
    afterTileImpact(ping, 80);
    expect(ping).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('a newer move lands the previous move\'s sound immediately', () => {
    setTileFlightActive(true);
    const first = vi.fn();
    const second = vi.fn();
    armTileImpact(first);
    claimTileImpact(600);
    armTileImpact(second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('turning flights off releases whatever is waiting', () => {
    setTileFlightActive(true);
    const clack = vi.fn();
    armTileImpact(clack);
    setTileFlightActive(false);
    expect(clack).toHaveBeenCalledTimes(1);
  });
});
