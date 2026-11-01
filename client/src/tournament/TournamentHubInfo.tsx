import { formatEventDay, formatEventTime } from './tournamentTime';
import type { ScheduledTournament } from './types';

/**
 * The two informational blocks of the Hub that are not events themselves (Hub v2): how a Live Event works, and what is
 * coming up after the cards. Presentation only; no state, no actions. Every statement here is checked against the server
 * (registration window M2: 12 h before to 2 min before; 8 players, three rounds, first to 30; the ready window is
 * TOURNAMENT_MATCH_READY_WINDOW_MS = 2 min), so change them together.
 */

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: 'Register', body: 'Registration opens 12 hours before an event and closes 2 minutes before it starts.' },
  { title: 'The bracket', body: 'When the event starts, the field is seeded into a bracket of up to 8. Fritz sits in any empty seat.' },
  { title: 'Three rounds', body: 'Quarterfinal, semifinal, final. Every match is first to 30.' },
  { title: 'Be ready', body: 'When your match is set, tap Join Match. You have about 2 minutes before it counts as a no-show.' },
];

/**
 * `side` sits under the title on a wide screen; `below` sits under the events on a narrow one. Both are rendered and CSS
 * shows one, so the order on a phone is "events first, rules after".
 */
export function HowItWorks({ variant }: { variant: 'side' | 'below' }) {
  return (
    <section className={`th-how th-how--${variant}`} aria-label="How a Live Event works">
      <h2 className="th-how__title">How it works</h2>
      <ol className="th-how__steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className="th-how__step">
            <span className="th-how__num" aria-hidden>{index + 1}</span>
            <div>
              <h3 className="th-how__step-title">{step.title}</h3>
              <p className="th-how__step-body">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** How many days ahead the schedule lists. */
export const COMING_UP_DAYS = 4;

export interface ComingUpDay {
  day: string;
  times: string[];
}

/**
 * The Live Events after the ones already shown as cards, grouped by the player's local day ("Tomorrow  6:00 PM · 9:00 PM").
 * Only future, not-yet-finished Live Events; never Fritz Cups; at most COMING_UP_DAYS days.
 */
export function comingUpDays(input: {
  upcoming: readonly ScheduledTournament[];
  shownIds: ReadonlySet<string>;
  nowMs: number;
  timeZone?: string;
}): ComingUpDay[] {
  const days: ComingUpDay[] = [];
  const events = input.upcoming
    .filter(
      (t) =>
        (t.kind ?? 'live') === 'live' &&
        (t.status === 'upcoming' || t.status === 'registration_open') &&
        !input.shownIds.has(t.id) &&
        Date.parse(t.scheduled_start) > input.nowMs,
    )
    .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start));
  for (const event of events) {
    const day = formatEventDay(event.scheduled_start, input.nowMs, { timeZone: input.timeZone });
    const time = formatEventTime(event.scheduled_start, { timeZone: input.timeZone });
    const last = days[days.length - 1];
    if (last && last.day === day) last.times.push(time);
    else if (days.length < COMING_UP_DAYS) days.push({ day, times: [time] });
    else break;
  }
  return days;
}

export function ComingUp(props: { days: ComingUpDay[] }) {
  if (props.days.length === 0) return null;
  return (
    <section className="th-soon" aria-label="Coming up">
      <h2 className="th-soon__title">Coming up</h2>
      <ul className="th-soon__list">
        {props.days.map((row) => (
          <li key={row.day} className="th-soon__row">
            <span className="th-soon__day">{row.day}</span>
            <span className="th-soon__times">{row.times.join(' · ')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
