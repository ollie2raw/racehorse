import { describe, expect, it, vi } from 'vitest';
import { startDailyFritzRequestDiagnostics } from './dailyFritzRequestDiagnostics';

describe('Daily Fritz request diagnostics', () => {
  it('preserves a bounded client request id and exposes it in the response', () => {
    const setHeader = vi.fn();
    const once = vi.fn();
    const req = { get: vi.fn(() => 'client-retry-42') };
    const res = { setHeader, once, statusCode: 409 };

    const diagnostics = startDailyFritzRequestDiagnostics(
      req as never,
      res as never,
      'next-hand',
    );

    expect(diagnostics.requestId).toBe('client-retry-42');
    expect(diagnostics.operation).toBe('next-hand');
    expect(setHeader).toHaveBeenCalledWith('x-racehorse-request-id', 'client-retry-42');
    expect(once).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('rejects an oversized supplied id and generates a server id', () => {
    const setHeader = vi.fn();
    const req = { get: vi.fn(() => 'x'.repeat(129)) };
    const res = { setHeader, once: vi.fn(), statusCode: 500 };

    const diagnostics = startDailyFritzRequestDiagnostics(req as never, res as never, 'complete');

    expect(diagnostics.requestId).not.toBe('x'.repeat(129));
    expect(diagnostics.requestId.length).toBeGreaterThan(10);
    expect(setHeader).toHaveBeenCalledWith('x-racehorse-request-id', diagnostics.requestId);
  });
});
