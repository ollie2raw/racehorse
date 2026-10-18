// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AnimatedScore } from './AnimatedScore';
import { TurnStatus } from './TurnStatus';
import { FeedbackNumber } from './FeedbackNumber';
import { BotHandTray, type BotHandTrayProps } from '../bot/BotHandTray';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function preference(reduced: boolean) {
  const query = new EventTarget();
  const media = Object.assign(query, { matches: reduced });
  vi.stubGlobal('matchMedia', () => media);
  return media;
}

describe('game feel presentation', () => {
  it('shows exact accessible score and starts no RAF under reduced motion', () => {
    preference(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { rerender, container } = render(<AnimatedScore value={20} from={0} />);
    expect(container.textContent).toBe('20');
    rerender(<AnimatedScore value={22} />);
    expect(screen.getByRole('img', { name: '22' })).toBeTruthy();
    expect(container.textContent).toBe('22');
    expect(raf).not.toHaveBeenCalled();
  });

  it('cancels a running score animation when the preference changes', () => {
    vi.useFakeTimers();
    const media = preference(false);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { container } = render(<AnimatedScore value={20} from={0} />);
    act(() => vi.advanceTimersByTime(80));
    expect(Number(container.textContent)).toBeLessThan(20);
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(container.textContent).toBe('20');
    expect(cancel).toHaveBeenCalled();
  });

  it('settles immediately when the document becomes hidden', () => {
    preference(false);
    const { container } = render(<AnimatedScore value={40} from={0} />);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(container.textContent).toBe('40');
  });

  it('replaces the turn cue only when its meaning changes; counter remains exact', () => {
    const { rerender, container } = render(<TurnStatus label="Your move" isYourTurn />);
    const first = container.querySelector('.rh-turn-status__content');
    rerender(<TurnStatus label="Your move" isYourTurn />);
    expect(container.querySelector('.rh-turn-status__content')).toBe(first);
    rerender(<TurnStatus label="Fritz is thinking…" isYourTurn={false} />);
    expect(container.querySelector('.rh-turn-status__content')).not.toBe(first);
    expect(container.textContent).toBe('Fritz is thinking…');
    const number = render(<FeedbackNumber value={14} />);
    expect(number.container.querySelector('.rh-number-change')).toBeNull();
    number.rerender(<FeedbackNumber value={12} />);
    expect(number.container.textContent).toBe('12');
    expect(number.container.querySelector('.rh-number-change')).toBeTruthy();
  });

  it('preserves neighbouring hand DOM when the first tile is played', () => {
    const hand = [{ low: 1, high: 1 }, { low: 1, high: 2 }, { low: 1, high: 3 }];
    const props: BotHandTrayProps = {
      normalHandRows: [hand], playerHand: hand, handTileSize: 30, handCompactStacked: false,
      selectedTile: null, handActive: true, botTurn: false, drawSequenceActive: false, drawPulseIndex: null,
      playableTileKeys: new Set(), isGuidedMode: false, guidedScoringTiles: new Map(),
      showCoachedRecommendation: false, lessonRecommendedTileKey: null, handAreaRef: { current: null }, onTileClick: vi.fn(),
    };
    const { rerender } = render(<BotHandTray {...props} />);
    const neighbour = screen.getByRole('button', { name: /Domino 1-2/ });
    rerender(<BotHandTray {...props} normalHandRows={[hand.slice(1)]} playerHand={hand.slice(1)} />);
    expect(screen.getByRole('button', { name: /Domino 1-2/ })).toBe(neighbour);
  });
});
