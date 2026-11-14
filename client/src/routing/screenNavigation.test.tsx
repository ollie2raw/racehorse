// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({ next: null as Promise<unknown> | null }));
vi.mock('../routes/screenPrefetch', () => ({ pendingScreenLoad: () => loads.next }));

const { SlowNavigationLoader, navigateToScreen } = await import('./screenNavigation');

beforeEach(() => {
  vi.useFakeTimers();
  loads.next = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('navigateToScreen', () => {
  it('commits at once when the screen is already loaded', () => {
    const commit = vi.fn();
    navigateToScreen('singlePlayerHub', commit);
    expect(commit).toHaveBeenCalledWith('singlePlayerHub');
  });

  it('waits for the chunk, and shows the loader only after 150 ms', async () => {
    let finish!: () => void;
    loads.next = new Promise<void>((r) => {
      finish = r;
    });
    const commit = vi.fn();
    render(<SlowNavigationLoader />);
    navigateToScreen('bot', commit);
    expect(commit).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(149);
    });
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByRole('status')).toBeTruthy();
    await act(async () => finish());
    expect(commit).toHaveBeenCalledWith('bot');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never shows the loader for a load that finishes inside 150 ms', async () => {
    loads.next = Promise.resolve();
    const commit = vi.fn();
    render(<SlowNavigationLoader />);
    navigateToScreen('bot', commit);
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(400);
    });
    expect(commit).toHaveBeenCalledWith('bot');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lets the newest tap win over a slower earlier one', async () => {
    let finishSlow!: () => void;
    loads.next = new Promise<void>((r) => {
      finishSlow = r;
    });
    const commit = vi.fn();
    navigateToScreen('bot', commit);
    loads.next = null;
    navigateToScreen('home', commit);
    await act(async () => finishSlow());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('home');
  });

  it('still commits when the load fails, so the route error boundary can report it', async () => {
    loads.next = Promise.reject(new Error('offline'));
    const commit = vi.fn();
    navigateToScreen('bot', commit);
    await act(async () => {
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledWith('bot');
  });

  it('marks the tapped control pressed while the load is pending, and clears it after', async () => {
    let finish!: () => void;
    loads.next = new Promise<void>((r) => {
      finish = r;
    });
    render(
      <>
        <SlowNavigationLoader />
        <button type="button">Play vs Fritz</button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Play vs Fritz' });
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    navigateToScreen('bot', vi.fn());
    expect(button.getAttribute('data-nav-pending')).toBe('true');
    await act(async () => finish());
    expect(button.hasAttribute('data-nav-pending')).toBe(false);
  });

  it('does not mark anything when the screen is already loaded', () => {
    render(
      <>
        <SlowNavigationLoader />
        <button type="button">Back</button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Back' });
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    navigateToScreen('home', vi.fn());
    expect(button.hasAttribute('data-nav-pending')).toBe(false);
  });
});
