// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeModal } from './WelcomeModal';

const noop = () => {};

describe('WelcomeModal', () => {
  it('renders nothing when closed', () => {
    render(<WelcomeModal open={false} onDismiss={noop} onNavigate={noop} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the Option A lineup when open — Daily Fritz leads, every other mode listed below', () => {
    render(<WelcomeModal open onDismiss={noop} onNavigate={noop} />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Racehorse Dominoes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Daily Fritz' })).toBeInTheDocument();
    // Every other mode gets its own line — none folded into a shared entry.
    for (const mode of [
      'Puzzle Rush',
      'Multiplayer',
      'Play vs Fritz',
      'Journey',
      'Ghost',
      'The Lab',
      'Learn',
      'Social',
    ]) {
      expect(screen.getByText(mode)).toBeInTheDocument();
    }
  });

  it('lists Tournament only while live tournaments are switched on', () => {
    const on = { tournaments: true, fritzCup: true };
    const { unmount } = render(<WelcomeModal open onDismiss={noop} onNavigate={noop} tournamentFeatures={on} />);
    expect(screen.queryByText('Tournament')).toBeNull();
    unmount();
    vi.stubEnv('VITE_ENABLE_TOURNAMENTS', 'true');
    try {
      render(<WelcomeModal open onDismiss={noop} onNavigate={noop} tournamentFeatures={on} />);
      expect(screen.getByText('Tournament')).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('Phase 3E: the Tournament line follows the server flags and never advertises early', () => {
    vi.stubEnv('VITE_ENABLE_TOURNAMENTS', 'true');
    try {
      const { rerender } = render(<WelcomeModal open onDismiss={noop} onNavigate={noop} tournamentFeatures={null} />);
      // Flags not loaded yet: no tournament line at all (no Fritz Cup flash).
      expect(screen.queryByText('Tournament')).toBeNull();
      expect(screen.queryByText(/Cup against Fritz/)).toBeNull();
      rerender(<WelcomeModal open onDismiss={noop} onNavigate={noop} tournamentFeatures={{ tournaments: true, fritzCup: false }} />);
      expect(screen.getByText('Join one of two Live Events each day. Fritz fills open seats. Registration opens 12 hours before start.')).toBeInTheDocument();
      expect(screen.queryByText(/Cup against Fritz/)).toBeNull();
      rerender(<WelcomeModal open onDismiss={noop} onNavigate={noop} tournamentFeatures={{ tournaments: true, fritzCup: true }} />);
      expect(screen.getByText('Play a 3-round Cup against Fritz anytime, or join one of two Live Events each day. Fritz fills open seats. Live Event registration opens 12 hours before start.')).toBeInTheDocument();
      rerender(<WelcomeModal open onDismiss={noop} onNavigate={noop} tournamentFeatures={{ tournaments: false, fritzCup: false }} />);
      expect(screen.queryByText('Tournament')).toBeNull();
      expect(document.body.textContent).not.toMatch(/\bPT\b|30 minutes|every 30/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('routes the primary CTA to Daily Fritz', () => {
    const onNavigate = vi.fn();
    render(<WelcomeModal open onDismiss={noop} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Daily Fritz' }));
    expect(onNavigate).toHaveBeenCalledWith('dailyFritz');
  });

  it('dismisses from "Let\'s play" and from the close control, never blocking either path', () => {
    const onDismiss = vi.fn();
    render(<WelcomeModal open onDismiss={onDismiss} onNavigate={noop} />);
    fireEvent.click(screen.getByRole('button', { name: "Let's play →" }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
