// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/hub/HubViewportPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { mutePreference } = await import('../utils/mutePreference');
const { SettingsScreen } = await import('./SettingsScreen');

const authUser = { id: 'user-1', email: 'qa@racehorse.test' } as never;

const soundToggle = () => screen.getByRole('switch', { name: /sound/i });

describe('SettingsScreen — preferences', () => {
  beforeEach(() => {
    mutePreference.set(false);
  });

  it('reflects sound being on', () => {
    render(<SettingsScreen authUser={authUser} />);
    expect(soundToggle().getAttribute('aria-checked')).toBe('true');
  });

  it('reflects a mute set elsewhere — in a match tray, say', () => {
    mutePreference.set(true);
    render(<SettingsScreen authUser={authUser} />);
    expect(soundToggle().getAttribute('aria-checked')).toBe('false');
  });

  it('mutes the whole app from here', () => {
    render(<SettingsScreen authUser={authUser} />);

    fireEvent.click(soundToggle());

    expect(mutePreference.get()).toBe(true);
    expect(soundToggle().getAttribute('aria-checked')).toBe('false');
  });

  it('unmutes again', () => {
    mutePreference.set(true);
    render(<SettingsScreen authUser={authUser} />);

    fireEvent.click(soundToggle());

    expect(mutePreference.get()).toBe(false);
  });

  it('offers sound to a signed-out visitor too — it is a device preference', () => {
    render(<SettingsScreen authUser={null} />);
    expect(soundToggle()).toBeTruthy();
  });
});
