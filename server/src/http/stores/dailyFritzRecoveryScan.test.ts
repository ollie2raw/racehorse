import { afterEach, describe, expect, it, vi } from 'vitest';
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../supabaseUtils', () => ({ supabaseFetch: fetchMock }));
import { listStrandedDailyFritzAttempts } from './dailyFritzStore';

describe('Daily Fritz recovery scan request contract', () => {
  const memory = process.env.DAILY_FRITZ_MEMORY_STORE;
  afterEach(() => { if (memory === undefined) delete process.env.DAILY_FRITZ_MEMORY_STORE; else process.env.DAILY_FRITZ_MEMORY_STORE = memory; fetchMock.mockReset(); });

  it('uses one bounded projected GET for 100 rows, with no checkpoint/authority/full-result payload', async () => {
    delete process.env.DAILY_FRITZ_MEMORY_STORE;
    fetchMock.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, user_id: 'user', run_date: '2026-09-01', started_at: '2026-09-01T00:00:00Z', version: 2, format: 'best_of_3', games: [], setWinner: null, set_winner: null })));
    const rows = await listStrandedDailyFritzAttempts('2026-10-01T00:00:00Z', 100, 'cursor-id');
    expect(rows).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const path = fetchMock.mock.calls[0]![0] as string;
    const query = new URL(path, 'http://local').searchParams;
    expect(query.get('select')?.split(',')).toEqual(['id', 'user_id', 'run_date', 'started_at', 'version:result->version', 'format:result->format', 'games:result->games', 'setWinner:result->setWinner', 'set_winner:result->set_winner']);
    expect(query.get('limit')).toBe('100');
    expect(query.get('order')).toBe('id.asc');
    expect(query.get('id')).toBe('gt.cursor-id');
    expect(query.get('status')).toBe('eq.started');
    expect(query.get('started_at')).toBe('lt.2026-10-01T00:00:00Z');
    expect(rows[0]?.result).toEqual({ version: 2, format: 'best_of_3', games: [], setWinner: null, set_winner: null });
  });
});
