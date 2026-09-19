import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePostGameReviewAccess } from './usePostGameReviewAccess';

const apiGetMock = vi.fn();

vi.mock('../../api/client.ts', () => ({ apiGet: apiGetMock }));

describe('usePostGameReviewAccess', () => {
  beforeEach(() => apiGetMock.mockReset());

  it('enables access only for a positive server response', async () => {
    apiGetMock.mockResolvedValueOnce({ data: { enabled: true }, error: null });
    const { result } = renderHook(() => usePostGameReviewAccess('user-a'));

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(apiGetMock).toHaveBeenCalledWith('/api/game-reviews/access');
  });

  it('fails closed on errors and incompatible response shapes', async () => {
    apiGetMock.mockResolvedValueOnce({ data: { enabled: 'yes' }, error: null });
    const { result } = renderHook(() => usePostGameReviewAccess('user-a'));
    await waitFor(() => expect(apiGetMock).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);

    apiGetMock.mockRejectedValueOnce(new Error('offline'));
    const second = renderHook(() => usePostGameReviewAccess('user-b'));
    await waitFor(() => expect(apiGetMock).toHaveBeenCalledTimes(2));
    expect(second.result.current).toBe(false);
  });

  it('does not request access without an authenticated user', () => {
    const { result } = renderHook(() => usePostGameReviewAccess(null));
    expect(result.current).toBe(false);
    expect(apiGetMock).not.toHaveBeenCalled();
  });
});
