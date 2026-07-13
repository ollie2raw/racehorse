import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFixedBotMatch } from '../modules/match/runtime/botEngine.ts';
import { buildDailyFritzSpectatorSnapshot, DailyFritzBroadcastControl } from './DailyFritzBroadcastControl.tsx';

const state = createFixedBotMatch({
  player_tiles: [{ low: 0, high: 0 }, { low: 0, high: 1 }, { low: 0, high: 2 }, { low: 0, high: 3 }, { low: 0, high: 4 }, { low: 0, high: 5 }, { low: 0, high: 6 }],
  fritz_tiles: [{ low: 1, high: 1 }, { low: 1, high: 2 }, { low: 1, high: 3 }, { low: 1, high: 4 }, { low: 1, high: 5 }, { low: 1, high: 6 }, { low: 2, high: 2 }],
  boneyard: [{ low: 2, high: 3 }],
  locked: [{ low: 2, high: 4 }],
}, 60, 7);

describe('Daily Fritz spectator broadcasting', () => {
  it('builds an allowlisted public snapshot without hand or boneyard contents', () => {
    const snapshot = buildDailyFritzSpectatorSnapshot({ state, sessionId: 'daily:1', sequence: 1, userId: 'u1', username: 'Oliver', spectatorCount: 2, startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' });
    expect(snapshot.participants.map((participant) => participant.handCount)).toEqual([7, 7]);
    expect(snapshot.boneyardCount).toBe(1);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('"hand"');
    expect(serialized).not.toContain('"boneyard"');
    expect(serialized).not.toContain('verification');
    expect(serialized).not.toContain('opponentKnownMissing');
  });

  it('starts off and exposes explicit accessible opt-in', () => {
    const start = vi.fn();
    render(<DailyFritzBroadcastControl phase="off" count={0} canStart onStart={start} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go Live' }));
    expect(start).toHaveBeenCalledOnce();
  });

  it('shows server count and stopping does not imply ending gameplay', () => {
    const stop = vi.fn();
    render(<DailyFritzBroadcastControl phase="live" count={4} canStart onStart={vi.fn()} onStop={stop} />);
    expect(screen.getByText('4 watching')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop Broadcast' }));
    expect(stop).toHaveBeenCalledOnce();
  });
});
