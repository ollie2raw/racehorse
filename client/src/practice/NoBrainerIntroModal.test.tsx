// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoBrainerIntroModal } from './NoBrainerIntroModal';

describe('NoBrainerIntroModal', () => {
  it('renders the no-brainer explainer copy', () => {
    render(<NoBrainerIntroModal open onStart={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: "What's a no-brainer?" })).toBeInTheDocument();
    expect(screen.getByText(/all 7 of your starting tiles chain together/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Solve it, and you'll never miss one in a real game\./i),
    ).toBeInTheDocument();
  });

  it('calls onStart when Start training is clicked', () => {
    const onStart = vi.fn();
    render(<NoBrainerIntroModal open onStart={onStart} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Start training/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when Escape is pressed', () => {
    const onDismiss = vi.fn();
    render(<NoBrainerIntroModal open onStart={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when the backdrop is clicked', () => {
    const onDismiss = vi.fn();
    render(<NoBrainerIntroModal open onStart={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(document.querySelector('.rh-modal-backdrop')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
