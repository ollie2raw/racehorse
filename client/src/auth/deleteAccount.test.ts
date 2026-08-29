import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiDelete } = vi.hoisted(() => ({ apiDelete: vi.fn() }));
// The factory returns the mock itself. Wrapping it in an arrow leaves vitest
// untracking the result, and a rejection then surfaces as an unhandled error.
vi.mock('../api/client', () => ({ apiDelete }));

const { deleteAccount } = await import('./deleteAccount');

describe('deleteAccount', () => {
  beforeEach(() => apiDelete.mockReset());

  it('sends the typed confirmation to the account endpoint', async () => {
    apiDelete.mockResolvedValue({ data: { ok: true }, error: null });

    const result = await deleteAccount('oliver');

    expect(apiDelete).toHaveBeenCalledWith('/api/account', { confirm: 'oliver' });
    expect(result).toEqual({ error: null });
  });

  it('passes the server error straight through', async () => {
    apiDelete.mockResolvedValue({
      data: null,
      error: 'Type your username exactly to confirm deletion.',
    });

    expect(await deleteAccount('olivia')).toEqual({
      error: 'Type your username exactly to confirm deletion.',
    });
  });

  it('reports a transport failure rather than resolving as deleted', async () => {
    // A rejected call must never look like success — the caller signs the user
    // out on success, and doing that to a live account is the worse failure.
    apiDelete.mockRejectedValueOnce(new Error('offline'));

    expect(await deleteAccount('oliver')).toEqual({ error: 'offline' });
  });

  it('treats a 200 with no ok flag as a failure', async () => {
    apiDelete.mockResolvedValue({ data: {}, error: null });

    const result = await deleteAccount('oliver');

    expect(result.error).toBeTruthy();
  });
});
