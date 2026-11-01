// @vitest-environment jsdom
/**
 * The identify effect, under the exact conditions that broke #61.
 *
 * A new object reference for the same signed-in user must not re-identify, and
 * StrictMode's double invocation must not double-identify. Both are asserted
 * on call count.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { __setAnalyticsTransport, type AnalyticsTransport } from './analytics';
// The real hook, imported rather than re-declared: a local copy would pass
// while the shipped effect regressed.
import { useAnalyticsIdentity } from '../auth/useAuth';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function Harness({ user }: { user: { id: string } | null }) {
  useAnalyticsIdentity(user?.id ?? null);
  return null;
}

describe('identify effect', () => {
  let identify: ReturnType<typeof vi.fn>;
  let reset: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    identify = vi.fn();
    reset = vi.fn();
    __setAnalyticsTransport({ capture: vi.fn(), identify, reset } as AnalyticsTransport);
  });

  it('identifies once for a signed-in user', async () => {
    render(<Harness user={{ id: 'user-1' }} />);
    await settle();
    expect(identify).toHaveBeenCalledTimes(1);
  });

  it('does not re-identify when the user object is a new reference', async () => {
    const { rerender } = render(<Harness user={{ id: 'user-1' }} />);
    await settle();
    // A fresh object for the same person — the #61 failure mode exactly.
    rerender(<Harness user={{ id: 'user-1' }} />);
    rerender(<Harness user={{ id: 'user-1' }} />);
    await settle();
    expect(identify).toHaveBeenCalledTimes(1);
  });

  it('does not double-identify under StrictMode', async () => {
    render(
      <StrictMode>
        <Harness user={{ id: 'user-1' }} />
      </StrictMode>,
    );
    await settle();
    expect(identify).toHaveBeenCalledTimes(1);
  });

  it('re-identifies only when the person actually changes', async () => {
    const { rerender } = render(<Harness user={{ id: 'user-1' }} />);
    await settle();
    rerender(<Harness user={{ id: 'user-2' }} />);
    await settle();
    expect(identify).toHaveBeenCalledTimes(2);
    expect(identify.mock.calls.map(([id]) => id)).toEqual(['user-1', 'user-2']);
  });

  it('resets on sign-out, but not for a visitor who never signed in', async () => {
    const { rerender } = render(<Harness user={{ id: 'user-1' }} />);
    await settle();
    rerender(<Harness user={null} />);
    await settle();
    expect(reset).toHaveBeenCalledTimes(1);

    reset.mockClear();
    render(<Harness user={null} />);
    await settle();
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('identify effect for a guest (docs/guest-play-design.md)', () => {
  let identify: ReturnType<typeof vi.fn>;
  let reset: ReturnType<typeof vi.fn>;

  function GuestHarness({ id, guest }: { id: string | null; guest: boolean }) {
    useAnalyticsIdentity(id, guest);
    return null;
  }

  beforeEach(() => {
    identify = vi.fn();
    reset = vi.fn();
    __setAnalyticsTransport({ capture: vi.fn(), identify, reset } as AnalyticsTransport);
  });

  it('marks a guest, once', async () => {
    const { rerender } = render(<GuestHarness id="g-1" guest />);
    rerender(<GuestHarness id="g-1" guest />);
    await settle();
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith('g-1', { guest: true });
  });

  it('says the same person is no longer a guest when they upgrade, without a second person', async () => {
    const { rerender } = render(<GuestHarness id="g-1" guest />);
    await settle();
    rerender(<GuestHarness id="g-1" guest={false} />);
    await settle();
    expect(identify).toHaveBeenCalledTimes(2);
    expect(identify).toHaveBeenLastCalledWith('g-1', { guest: false });
    expect(reset).not.toHaveBeenCalled();
  });

  it('sends nothing extra for an ordinary account, exactly as before', async () => {
    render(<GuestHarness id="user-1" guest={false} />);
    await settle();
    expect(identify).toHaveBeenCalledWith('user-1', undefined);
  });

  it('unlinks when a guest leaves, and a new guest is a new person', async () => {
    const { rerender } = render(<GuestHarness id="g-1" guest />);
    await settle();
    rerender(<GuestHarness id={null} guest={false} />);
    await settle();
    expect(reset).toHaveBeenCalledTimes(1);
    rerender(<GuestHarness id="g-2" guest />);
    await settle();
    expect(identify).toHaveBeenLastCalledWith('g-2', { guest: true });
  });
});
