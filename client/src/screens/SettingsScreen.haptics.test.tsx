// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Haptics exist in the native app only (utils/haptics.ts), so the Settings switch is shown there and nowhere else:
 * a switch on the web would promise something the page cannot deliver.
 */

const native = vi.hoisted(() => ({ value: false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn(), selectionChanged: vi.fn(), notification: vi.fn() },
  ImpactStyle: {},
  NotificationType: {},
}));
vi.mock('../components/GlobalNav', () => ({ GlobalNav: () => null }));

const { SettingsScreen } = await import('./SettingsScreen');
const { hapticsPreference } = await import('../utils/hapticsPreference');

const authUser = { id: 'user-1', email: 'qa@racehorse.test' } as never;

describe('SettingsScreen: Haptics', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it('is not offered on the web', () => {
    native.value = false;
    render(<SettingsScreen authUser={authUser} />);
    expect(screen.queryByRole('switch', { name: 'Haptics' })).toBeNull();
  });

  it('is offered in the app, on by default, and the switch turns it off and on', () => {
    native.value = true;
    render(<SettingsScreen authUser={authUser} />);
    const toggle = screen.getByRole('switch', { name: 'Haptics' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(hapticsPreference.get()).toBe(false);
    expect(screen.getByRole('switch', { name: 'Haptics' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('switch', { name: 'Haptics' }));
    expect(hapticsPreference.get()).toBe(true);
  });
});
