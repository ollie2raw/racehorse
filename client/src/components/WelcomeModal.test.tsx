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

  it('shows the Direction B lineup when open', () => {
    render(<WelcomeModal open onDismiss={noop} onNavigate={noop} />);
    expect(screen.getByRole('dialog', { name: "Welcome. Here's today." })).toBeInTheDocument();
    expect(screen.getByText('Daily Fritz')).toBeInTheDocument();
    expect(screen.getByText('Daily Puzzles')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Daily Fritz' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Daily Puzzles' })).toBeInTheDocument();
  });

  it('routes each daily CTA to its mode', () => {
    const onNavigate = vi.fn();
    render(<WelcomeModal open onDismiss={noop} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Daily Fritz' }));
    expect(onNavigate).toHaveBeenCalledWith('dailyFritz');
    fireEvent.click(screen.getByRole('button', { name: 'Play Daily Puzzles' }));
    expect(onNavigate).toHaveBeenCalledWith('puzzleRush');
  });

  it('dismisses from "Got it" and from the close control', () => {
    const onDismiss = vi.fn();
    render(<WelcomeModal open onDismiss={onDismiss} onNavigate={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
