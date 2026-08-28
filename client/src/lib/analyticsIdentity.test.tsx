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
