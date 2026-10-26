// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The page renders GlobalNav directly now — it is no longer a hub page, so
// there is no HubViewportPage between them.
vi.mock('../components/GlobalNav', () => ({ GlobalNav: () => null }));

const { mutePreference } = await import('../utils/mutePreference');
const { gameSpeedPreference } = await import('../utils/gameSpeedPreference');
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

  describe('Fast Fritz', () => {
    const fastToggle = () => screen.getByRole('switch', { name: /fast fritz/i });

    beforeEach(() => {
      gameSpeedPreference.set('normal');
    });

    it('is off by default and says Daily Fritz keeps its pace', () => {
      render(<SettingsScreen authUser={authUser} />);
      expect(fastToggle().getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText(/Daily Fritz keeps its standard pace/i)).toBeTruthy();
    });

    it('turns fast pace on and off from here', () => {
      render(<SettingsScreen authUser={authUser} />);

      fireEvent.click(fastToggle());
      expect(gameSpeedPreference.get()).toBe('fast');
      expect(fastToggle().getAttribute('aria-checked')).toBe('true');

      fireEvent.click(fastToggle());
      expect(gameSpeedPreference.get()).toBe('normal');
    });

    it('reflects a value set elsewhere', () => {
      gameSpeedPreference.set('fast');
      render(<SettingsScreen authUser={authUser} />);
      expect(fastToggle().getAttribute('aria-checked')).toBe('true');
    });

    it('is offered to a signed-out visitor too — it is a device preference', () => {
      render(<SettingsScreen authUser={null} />);
      expect(fastToggle()).toBeTruthy();
    });

    it('does not touch the sound preference', () => {
      render(<SettingsScreen authUser={authUser} />);
      fireEvent.click(fastToggle());
      expect(mutePreference.get()).toBe(false);
    });
  });
});
