import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startMock, stopMock } = vi.hoisted(() => ({ startMock: vi.fn(), stopMock: vi.fn() }));
vi.mock('./journeyProgressSyncRuntime', () => ({ startJourneyProgressSync: startMock }));

import { useJourneyProgressSync } from './useJourneyProgressSync';

type User = { id: string; is_anonymous?: boolean } | null;

function mount(initial: { user: User; loading?: boolean }) {
  return renderHook(({ user, loading }: { user: User; loading: boolean }) => useJourneyProgressSync(user, loading), {
    initialProps: { user: initial.user, loading: initial.loading ?? false },
  });
}

/** The sync is loaded on demand: let that import settle. */
const settle = () => vi.dynamicImportSettled();

beforeEach(() => {
  startMock.mockReset();
  stopMock.mockReset();
  startMock.mockReturnValue(stopMock);
});

describe('who is synced', () => {
  it('a signed-out visitor stays local-only: the sync is never even loaded', async () => {
    mount({ user: null });
    await settle();
    expect(startMock).not.toHaveBeenCalled();
  });

  it('a guest (anonymous user) stays local-only, even though they have an account id', async () => {
    mount({ user: { id: 'guest-1', is_anonymous: true } });
    await settle();
    expect(startMock).not.toHaveBeenCalled();
  });

  it('waits while auth is still resolving, then starts', async () => {
    const view = mount({ user: { id: 'user-a' }, loading: true });
    await settle();
    expect(startMock).not.toHaveBeenCalled();
    view.rerender({ user: { id: 'user-a' }, loading: false });
    await settle();
    expect(startMock).toHaveBeenCalledWith('user-a');
  });

  it('a signed-in player starts it once, and unmounting stops it', async () => {
    const view = mount({ user: { id: 'user-a' } });
    await settle();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('user-a');
    view.unmount();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it('a re-render with the same player does not restart it', async () => {
    const view = mount({ user: { id: 'user-a' } });
    await settle();
    view.rerender({ user: { id: 'user-a' }, loading: false });
    await settle();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('an account switch stops the first player\'s sync and starts the second\'s', async () => {
    const view = mount({ user: { id: 'user-a' } });
    await settle();
    view.rerender({ user: { id: 'user-b' }, loading: false });
    await settle();
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenLastCalledWith('user-b');
  });

  it('signing out stops it, and a guest session that follows does not start it', async () => {
    const view = mount({ user: { id: 'user-a' } });
    await settle();
    view.rerender({ user: { id: 'guest-1', is_anonymous: true }, loading: false });
    await settle();
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('unmounting before the sync has loaded starts nothing', async () => {
    const view = mount({ user: { id: 'user-a' } });
    view.unmount(); // before the on-demand import resolves
    await settle();
    expect(startMock).not.toHaveBeenCalled();
  });
});
