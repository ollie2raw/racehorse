import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueueService } from './queueService';
import type { QueuedPlayer } from './types';

describe('QueueService', () => {
  let service: QueueService;
  let matchedCalls: Array<{ a: QueuedPlayer; b: QueuedPlayer }>;
  let timeoutCalls: Array<{ socketId: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    matchedCalls = [];
    timeoutCalls = [];
    service = new QueueService({
      onMatched: (a, b) => { matchedCalls.push({ a, b }); },
      onTimeout: (socketId) => { timeoutCalls.push({ socketId }); },
      tickIntervalMs: 1000,
      timeoutAfterMs: 90_000,
    });
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(service.size()).toBe(0);
  });

  it('adds a player on join', () => {
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    expect(service.size()).toBe(1);
  });

  it('rejects duplicate userId join', () => {
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    const result = service.join({ socketId: 's2', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    expect(result.ok).toBe(false);
    expect(service.size()).toBe(1);
  });

  it('rejects synthetic / sim queue seats', () => {
    expect(
      service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: true }).ok,
    ).toBe(false);
    expect(
      service.join({ socketId: 's1', userId: 'sim:abc', username: 'a', rating: 1000, isSim: false }).ok,
    ).toBe(false);
    expect(
      service.join({ socketId: 's1', userId: 'u1', username: 'Bot (sim)', rating: 1000, isSim: false }).ok,
    ).toBe(false);
    expect(service.size()).toBe(0);
  });

  it('removes player on leave', () => {
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    service.leave('s1');
    expect(service.size()).toBe(0);
  });

  it('pairs two compatible players on tick', () => {
    service.start();
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    service.join({ socketId: 's2', userId: 'u2', username: 'b', rating: 1100, isSim: false });
    vi.advanceTimersByTime(1100);
    expect(matchedCalls).toHaveLength(1);
    expect(service.size()).toBe(0);
  });

  it('does not pair incompatible ratings', () => {
    service.start();
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    service.join({ socketId: 's2', userId: 'u2', username: 'b', rating: 1500, isSim: false });
    vi.advanceTimersByTime(2000);
    expect(matchedCalls).toHaveLength(0);
    expect(service.size()).toBe(2);
  });

  it('fires onTimeout after timeoutAfterMs without match', () => {
    service.start();
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    vi.advanceTimersByTime(91_000);
    expect(timeoutCalls).toHaveLength(1);
    expect(timeoutCalls[0].socketId).toBe('s1');
    expect(service.size()).toBe(0);
  });

  it('reports correct elapsedMs in getStatus', () => {
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    vi.advanceTimersByTime(5000);
    const status = service.getStatus('s1');
    expect(status?.elapsedMs).toBeGreaterThanOrEqual(5000);
    expect(status?.queueSize).toBe(1);
  });

  it('getStatus returns null for unknown socket', () => {
    expect(service.getStatus('nope')).toBeNull();
  });
});
