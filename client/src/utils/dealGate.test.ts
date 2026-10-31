import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEAL_GATE_MAX_WAIT_MS,
  beginDeal,
  endDeal,
  isDealInProgress,
  resetDealGateForTests,
  whenDealDone,
} from './dealGate';

describe('dealGate: Fritz waits for the deal, but never forever', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDealGateForTests();
  });
  afterEach(() => {
    resetDealGateForTests();
    vi.useRealTimers();
  });

  it('is open when no deal is running, and resolves at once', async () => {
    expect(isDealInProgress()).toBe(false);
    const done = vi.fn();
    void whenDealDone().then(done);
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('holds a waiter while the deal runs and releases it the moment it ends', async () => {
    beginDeal();
    expect(isDealInProgress()).toBe(true);
    const done = vi.fn();
    void whenDealDone().then(done);
    await vi.advanceTimersByTimeAsync(1500);
    expect(done).not.toHaveBeenCalled();

    endDeal();
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
    expect(isDealInProgress()).toBe(false);
  });

  it('releases every waiter, not just the first', async () => {
    beginDeal();
    const a = vi.fn();
    const b = vi.fn();
    void whenDealDone().then(a);
    void whenDealDone().then(b);
    endDeal();
    await Promise.resolve();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting after the cap, even if the deal never reports that it ended', async () => {
    beginDeal();
    const done = vi.fn();
    void whenDealDone().then(done);
    await vi.advanceTimersByTimeAsync(DEAL_GATE_MAX_WAIT_MS - 1);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('honours a shorter cap', async () => {
    beginDeal();
    const done = vi.fn();
    void whenDealDone(300).then(done);
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('a waiter released by the deal ending leaves no timer behind', async () => {
    beginDeal();
    void whenDealDone();
    endDeal();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
