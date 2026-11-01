import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COMING_UP_DAYS, ComingUp, HowItWorks, comingUpDays } from './TournamentHubInfo';
import type { ScheduledTournament } from './types';

const NOW = Date.parse('2026-11-02T15:00:00.000Z'); // Mon 10:00 EST
const HOUR = 3_600_000;
const TZ = 'America/New_York';
const at = (ms: number) => new Date(NOW + ms).toISOString();

function ev(id: string, startIn: number, over: Partial<ScheduledTournament> = {}): ScheduledTournament {
  return {
    id, kind: 'live', status: 'upcoming', scheduled_start: at(startIn), registration_open_at: at(startIn - 12 * HOUR),
    registration_close_at: at(startIn - 2 * 60_000), format: '7-tile', win_target: 30, max_players: 8,
    winner_id: null, created_at: at(-HOUR), registered_count: 0, ...over,
  };
}
const days = (events: ScheduledTournament[], shown: string[] = []) =>
  comingUpDays({ upcoming: events, shownIds: new Set(shown), nowMs: NOW, timeZone: TZ });

describe('HowItWorks', () => {
  it('lists the four steps, in order, with the numbers hidden from screen readers', () => {
    render(<HowItWorks variant="side" />);
    const region = screen.getByRole('region', { name: 'How a Live Event works' });
    const steps = within(region).getAllByRole('listitem');
    expect(steps.map((li) => within(li).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Register', 'The bracket', 'Three rounds', 'Be ready',
    ]);
    expect(region.querySelectorAll('.th-how__num[aria-hidden="true"]')).toHaveLength(4);
  });

  it('states the rules the server enforces', () => {
    render(<HowItWorks variant="below" />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/12 hours/);
    expect(text).toMatch(/2 minutes before it starts/);
    expect(text).toMatch(/up to 8/);
    expect(text).toMatch(/first to 30/i);
    expect(text).toMatch(/about 2 minutes/);
  });

  it('takes its position class from the variant, so CSS can show one of the two', () => {
    const { rerender } = render(<HowItWorks variant="side" />);
    expect(document.querySelector('.th-how--side')).not.toBeNull();
    rerender(<HowItWorks variant="below" />);
    expect(document.querySelector('.th-how--below')).not.toBeNull();
    expect(document.querySelector('.th-how--side')).toBeNull();
  });
});

describe('comingUpDays', () => {
  it('groups future Live Events by the player\'s local day and lists the times', () => {
    const result = days([
      ev('a', 8 * HOUR),                 // Mon 6:00 PM
      ev('b', 11 * HOUR),                // Mon 9:00 PM
      ev('c', 32 * HOUR),                // Tue 6:00 PM
      ev('d', 35 * HOUR),                // Tue 9:00 PM
    ]);
    expect(result).toEqual([
      { day: 'Today', times: ['6:00 PM', '9:00 PM'] },
      { day: 'Tomorrow', times: ['6:00 PM', '9:00 PM'] },
    ]);
  });

  it('leaves out events already shown as cards, past ones, Fritz Cups and finished or cancelled ones', () => {
    const result = days(
      [
        ev('shown', 8 * HOUR),
        ev('past', -HOUR),
        ev('cup', 9 * HOUR, { kind: 'fritz_cup' }),
        ev('done', 10 * HOUR, { status: 'completed' }),
        ev('gone', 11 * HOUR, { status: 'cancelled' }),
        ev('open', 12 * HOUR, { status: 'registration_open' }),
      ],
      ['shown'],
    );
    expect(result).toEqual([{ day: 'Today', times: ['10:00 PM'] }]);
  });

  it('puts events in time order even when the server lists them out of order', () => {
    const result = days([ev('late', 32 * HOUR), ev('early', 8 * HOUR)]);
    expect(result.map((r) => r.day)).toEqual(['Today', 'Tomorrow']);
  });

  it('stops at a handful of days, however many events there are', () => {
    const many = Array.from({ length: 24 }, (_, i) => ev(`e${i}`, (8 + i * 24) * HOUR));
    expect(days(many)).toHaveLength(COMING_UP_DAYS);
  });

  it('is empty when there is nothing beyond the cards', () => {
    expect(days([])).toEqual([]);
    expect(days([ev('only', 8 * HOUR)], ['only'])).toEqual([]);
  });
});

describe('ComingUp', () => {
  it('renders nothing for an empty schedule (no empty heading)', () => {
    const { container } = render(<ComingUp days={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders each day with its times', () => {
    render(<ComingUp days={[{ day: 'Tomorrow', times: ['6:00 PM', '9:00 PM'] }]} />);
    const region = screen.getByRole('region', { name: 'Coming up' });
    expect(within(region).getByText('Tomorrow')).toBeTruthy();
    expect(within(region).getByText('6:00 PM · 9:00 PM')).toBeTruthy();
  });
});
