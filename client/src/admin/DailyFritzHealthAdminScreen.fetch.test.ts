// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ apiGet }));

const { fetchDailyFritzHealth } = await import('./DailyFritzHealthAdminScreen');

beforeEach(() => apiGet.mockReset());

describe('fetchDailyFritzHealth', () => {
  it('sends the admin secret in its header and no Supabase auth', async () => {
    apiGet.mockResolvedValue({ data: { ok: true }, error: null });
    await fetchDailyFritzHealth('s3cret');
    expect(apiGet).toHaveBeenCalledWith('/api/daily-fritz/health', {
      auth: false,
      headers: { 'x-admin-secret': 's3cret' },
    });
  });

  it('returns the health report', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, days: [] }, error: null });
    await expect(fetchDailyFritzHealth('k')).resolves.toEqual({ ok: true, days: [] });
  });

  it('throws the server\'s message, so the screen shows why the key was refused', async () => {
    apiGet.mockResolvedValue({ data: null, error: 'Forbidden', status: 403 });
    await expect(fetchDailyFritzHealth('wrong')).rejects.toThrow('Forbidden');
  });

  it('throws something readable when there is neither data nor a message', async () => {
    apiGet.mockResolvedValue({ data: null, error: null, status: 204 });
    await expect(fetchDailyFritzHealth('k')).rejects.toThrow(/health check failed/i);
  });
});
