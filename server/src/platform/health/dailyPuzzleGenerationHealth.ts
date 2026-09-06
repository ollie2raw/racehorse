/**
 * `/ready.checks.dailyPuzzleGeneration` — is the Daily Puzzle **generation
 * pipeline** still producing content?
 *
 * History: this slot used to be `dailyPuzzleLadder` and reused
 * `isDailyPuzzleLadderReady` to assert that *today's* Pacific date had a
 * publish-ready 3-slot ladder — a check shaped for the retired ladder *UI*. Two
 * problems (CODE_QUALITY_PLAN.md §CQ9.1.6.4): (a) `gen-puzzles.yml` seeds ~363
 * days ahead and skips already-ready dates, so "today is ready" was decided ~a
 * year ago — a stalled generator stayed green for ~365 days; (b) it gated
 * `/ready`'s overall `ok`, so a retired feature's content lag could 503 the
 * server.
 *
 * Now: check the **lookahead horizon** — the furthest published `daily_puzzles`
 * date must be at least `minLookaheadDays` out. `gen-puzzles.yml` runs every 6h
 * and seeds 363 days out, so a healthy pipeline sits far above a 30-day floor; a
 * genuinely stalled cron crosses it within weeks, and one bad day never trips it.
 * This snapshot is surfaced in `/ready` but is **not** part of `/ready`'s `ok`
 * gate — see `registerHealthRoutes.ts`.
 */

/** Furthest-out published `daily_puzzles` date must be at least this many days ahead. */
export const DAILY_PUZZLE_GENERATION_MIN_LOOKAHEAD_DAYS = 30;

export type DailyPuzzleGenerationHealthSnapshot = {
  ok: boolean;
  furthestPublishedDate: string | null;
  requiredThroughDate: string;
  lookaheadDays: number | null;
  shouldAlert: boolean;
  alertReason: string | null;
};

/** Add `days` calendar days to a `YYYY-MM-DD` string. Pure day math, timezone-free. */
export function addDaysToIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Whole calendar days from `fromIso` to `toIso` (negative if `toIso` is earlier). */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function assessDailyPuzzleGenerationHealth(
  todayPt: string,
  furthestPublishedDate: string | null,
  minLookaheadDays: number = DAILY_PUZZLE_GENERATION_MIN_LOOKAHEAD_DAYS,
): DailyPuzzleGenerationHealthSnapshot {
  const requiredThroughDate = addDaysToIsoDate(todayPt, minLookaheadDays);
  const lookaheadDays = furthestPublishedDate
    ? daysBetweenIsoDates(todayPt, furthestPublishedDate)
    : null;
  // ISO `YYYY-MM-DD` strings sort chronologically, so a string compare is a date compare.
  const ok = furthestPublishedDate !== null && furthestPublishedDate >= requiredThroughDate;
  const alertReason = ok
    ? null
    : `daily_puzzles generation is behind: furthest published date ${
        furthestPublishedDate ?? '(none)'
      } does not reach the required ${requiredThroughDate} (today ${todayPt} + ${minLookaheadDays}d). The gen-puzzles.yml cron may be failing or disabled.`;

  return {
    ok,
    furthestPublishedDate,
    requiredThroughDate,
    lookaheadDays,
    shouldAlert: !ok,
    alertReason,
  };
}
