import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CircuitEndTargets } from './CircuitEndTargets';

describe('CircuitEndTargets', () => {
  it('shows idle copy before tile selection', () => {
    render(
      <CircuitEndTargets
        leftEnd={4}
        rightEnd={2}
        selectedTile={null}
        legalPositions={[]}
        onCommit={vi.fn()}
        onIllegalAttempt={vi.fn()}
      />,
    );
    expect(screen.getByText(/Select a tile to reveal placement targets/i)).toBeTruthy();
  });

  it('labels both legal ends with pip requirements', () => {
    const onCommit = vi.fn();
    render(
      <CircuitEndTargets
        leftEnd={4}
        rightEnd={2}
        selectedTile={{ low: 1, high: 4 }}
        legalPositions={['left', 'right']}
        onCommit={onCommit}
        onIllegalAttempt={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Play on left, needs 4/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Play on right, needs 2/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Play on left, needs 4/i }));
    expect(onCommit).toHaveBeenCalledWith('left');
  });

  it('makes a single legal destination obvious while showing the blocked end', () => {
    const onCommit = vi.fn();
    const onIllegal = vi.fn();
    render(
      <CircuitEndTargets
        leftEnd={1}
        rightEnd={6}
        selectedTile={{ low: 1, high: 4 }}
        legalPositions={['left']}
        onCommit={onCommit}
        onIllegalAttempt={onIllegal}
      />,
    );
    const left = screen.getByRole('button', { name: /Play on left, needs 1/i });
    const right = screen.getByRole('button', { name: /Right end blocked, needs 6/i });
    expect(left.className).toMatch(/solo/);
    expect(right.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(right);
    expect(onIllegal).toHaveBeenCalledWith('right');
    fireEvent.click(left);
    expect(onCommit).toHaveBeenCalledWith('left');
  });

  it('explains when no end is legal', () => {
    render(
      <CircuitEndTargets
        leftEnd={2}
        rightEnd={3}
        selectedTile={{ low: 5, high: 5 }}
        legalPositions={[]}
        onCommit={vi.fn()}
        onIllegalAttempt={vi.fn()}
      />,
    );
    expect(screen.getByText(/cannot play on either open end/i)).toBeTruthy();
  });

  it('supports keyboard activation on legal ends', () => {
    const onCommit = vi.fn();
    render(
      <CircuitEndTargets
        leftEnd={4}
        rightEnd={2}
        selectedTile={{ low: 4, high: 5 }}
        legalPositions={['right']}
        onCommit={onCommit}
        onIllegalAttempt={vi.fn()}
      />,
    );
    const right = screen.getByRole('button', { name: /Play on right, needs 2/i });
    right.focus();
    fireEvent.keyDown(right, { key: 'Enter' });
    fireEvent.click(right);
    expect(onCommit).toHaveBeenCalledWith('right');
  });
});
