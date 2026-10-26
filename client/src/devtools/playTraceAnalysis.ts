// client/src/devtools/playTraceAnalysis.ts
//
// Pure analysis of a "play trace": the timestamped UI-state log that e2e/play-trace.spec.ts
// records while a real match is played. It turns the raw log into the numbers the draw and
// tile-play programme is judged by (docs/draw-and-play-diagnosis.md): how fast the game
// answers a tap, how long Fritz makes the player wait, how long draws take, how often a
// placement has only one legal zone.
//
// The log is a list of [timestampMs, key, value]. Keys are either a UI-state counter that
// changed (board, hand, playable, zones, flying, boneyardOpen, pregame, handOver, turn) or a
// marker the driver added just before a tap (MARK:tap-tile, MARK:tap-zone, MARK:tap-draw,
// MARK:tap-pregame-pick). Not imported by the app.

export type TraceValue = number | string | null;
export type TraceEvent = readonly [number, string, TraceValue];

export interface Stat {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export interface PlayTraceReport {
  /** Tap a tile -> its legal drop zones are on screen. */
  tapTileToZonesMs: Stat;
  /** Tap a zone -> the tile is on the board. */
  tapZoneToBoardMs: Stat;
  /** The player's tile lands -> the opponent's next tile lands (includes all of Fritz's pacing). */
  opponentReplyMs: Stat;
  /** The opponent's tile lands -> the player's tiles are tappable. */
  opponentTileToMyTappableMs: Stat;
  /** Tap the boneyard -> the drawn tile is in the hand (single successful draws only). */
  drawTapToHandMs: Stat;
  /** How long the flying-tile (draw) overlay stays up. */
  flyingVisibleMs: Stat;
  /** How long each turn label (e.g. "FRITZ IS THINKING…") is held. */
  turnLabelHeldMs: Record<string, Stat>;
  /** Legal drop zones on screen at the moment of the zone tap -> number of plays. */
  zonesAtPlay: Record<number, number>;
  /** Share of plays that had exactly one legal zone. */
  singleZoneShare: number;
  plays: number;
}

const EMPTY: Stat = { n: 0, p50: 0, p95: 0, max: 0 };

export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.max(0, Math.round((p / 100) * (sortedAscending.length - 1))));
  return sortedAscending[index];
}

export function stat(values: readonly number[]): Stat {
  if (values.length === 0) return EMPTY;
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] };
}

const num = (v: TraceValue): number => (typeof v === 'number' ? v : 0);

/**
 * A tap's consequence arrives within a handful of events and well under a second. Bound the look-ahead by
 * both, so a tap that produced nothing (a stale tap during the opponent's turn) is not credited with an
 * unrelated event seconds later.
 */
const WINDOW = 40;
const WINDOW_MS = 1500;

function firstAfter(events: readonly TraceEvent[], from: number, pick: (e: TraceEvent) => boolean): TraceEvent | undefined {
  const start = events[from][0];
  for (let i = from + 1; i < Math.min(events.length, from + 1 + WINDOW); i += 1) {
    if (events[i][0] - start > WINDOW_MS) return undefined;
    if (pick(events[i])) return events[i];
  }
  return undefined;
}

export function analyzePlayTrace(log: readonly TraceEvent[]): PlayTraceReport {
  const tapTileToZones: number[] = [];
  const tapZoneToBoard: number[] = [];
  const zonesAtPlay: Record<number, number> = {};
  const myBoardTimes: number[] = [];

  log.forEach((event, i) => {
    const [t, key] = event;
    if (key === 'MARK:tap-tile') {
      const z = firstAfter(log, i, ([, k, v]) => k === 'zones' && num(v) > 0);
      if (z) tapTileToZones.push(z[0] - t);
    }
    if (key === 'MARK:tap-zone') {
      const b = firstAfter(log, i, ([, k]) => k === 'board');
      if (b) {
        tapZoneToBoard.push(b[0] - t);
        myBoardTimes.push(b[0]);
      }
      for (let j = i - 1; j >= Math.max(0, i - 8); j -= 1) {
        const [, k, v] = log[j];
        if (k === 'zones' && num(v) > 0) {
          zonesAtPlay[num(v)] = (zonesAtPlay[num(v)] ?? 0) + 1;
          break;
        }
      }
    }
  });

  const boardTimes = log.filter(([, k]) => k === 'board').map(([t]) => t);
  const opponentReply = myBoardTimes.flatMap((mine) => {
    const next = boardTimes.find((b) => b > mine + 1);
    return next === undefined ? [] : [next - mine];
  });

  const opponentTileToMyTappable = boardTimes.flatMap((tm) => {
    const p = log.find(([t, k, v]) => k === 'playable' && t >= tm && num(v) > 0);
    return p && p[0] - tm < 3000 ? [p[0] - tm] : [];
  });

  // Draw: a boneyard tap followed (soon) by the hand growing by exactly one.
  const handEvents = log.filter(([, k]) => k === 'hand');
  const drawTapToHand: number[] = [];
  for (const [t, key] of log) {
    if (key !== 'MARK:tap-draw') continue;
    const next = handEvents.findIndex(([ht]) => ht > t);
    if (next <= 0) continue;
    const grew = num(handEvents[next][2]) === num(handEvents[next - 1][2]) + 1;
    if (grew && handEvents[next][0] - t < 3000) drawTapToHand.push(handEvents[next][0] - t);
  }

  const flying: number[] = [];
  let flyStart: number | null = null;
  for (const [t, key, v] of log) {
    if (key !== 'flying') continue;
    if (num(v) > 0 && flyStart === null) flyStart = t;
    if (num(v) === 0 && flyStart !== null) {
      flying.push(t - flyStart);
      flyStart = null;
    }
  }

  const turns = log.filter(([, k]) => k === 'turn');
  const held: Record<string, number[]> = {};
  for (let i = 0; i + 1 < turns.length; i += 1) {
    const label = String(turns[i][2] ?? '');
    (held[label] ??= []).push(turns[i + 1][0] - turns[i][0]);
  }

  const plays = Object.values(zonesAtPlay).reduce((a, b) => a + b, 0);
  return {
    tapTileToZonesMs: stat(tapTileToZones),
    tapZoneToBoardMs: stat(tapZoneToBoard),
    opponentReplyMs: stat(opponentReply),
    opponentTileToMyTappableMs: stat(opponentTileToMyTappable),
    drawTapToHandMs: stat(drawTapToHand),
    flyingVisibleMs: stat(flying),
    turnLabelHeldMs: Object.fromEntries(Object.entries(held).map(([k, v]) => [k, stat(v)])),
    zonesAtPlay,
    singleZoneShare: plays === 0 ? 0 : (zonesAtPlay[1] ?? 0) / plays,
    plays,
  };
}

export function formatStat(name: string, s: Stat): string {
  return s.n === 0 ? `${name}: none` : `${name}: n=${s.n} p50=${s.p50.toFixed(0)}ms p95=${s.p95.toFixed(0)}ms max=${s.max.toFixed(0)}ms`;
}

export function formatPlayTraceReport(r: PlayTraceReport): string[] {
  return [
    formatStat('tap tile -> drop zones visible', r.tapTileToZonesMs),
    formatStat('tap zone -> tile on board', r.tapZoneToBoardMs),
    formatStat('my tile lands -> opponent tile lands', r.opponentReplyMs),
    formatStat('opponent tile lands -> my tiles tappable', r.opponentTileToMyTappableMs),
    formatStat('tap boneyard -> tile in my hand', r.drawTapToHandMs),
    formatStat('flying-tile overlay visible', r.flyingVisibleMs),
    ...Object.entries(r.turnLabelHeldMs)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([label, s]) => formatStat(`turn label "${label}" held`, s)),
    `legal drop zones at the moment of placing: ${JSON.stringify(r.zonesAtPlay)} (single-zone plays: ${(r.singleZoneShare * 100).toFixed(0)}%)`,
  ];
}
