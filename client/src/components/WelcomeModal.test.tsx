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
      'Tournament',
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
