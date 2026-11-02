import { describe, expect, it } from 'vitest';
import { replayVerifiedDailyFritzHand } from '../dailyFritzHandReplay';
import { inputFor, playGame, transcriptOf } from '../dailyFritzHand.testkit';
import { buildDailyFritzGameRecord, type OkHandReplay } from './dailyFritzGameRecord';
import { replayMultiplayerRecord } from './multiplayerReplay';

function replaysOf(game: ReturnType<typeof playGame>): OkHandReplay[] {
  return game.hands.map(({ handIndex, initialState, actions }) => {
    const replay = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, actions)));
    if (!replay.ok) throw new Error(`hand ${handIndex}: ${replay.code} ${replay.message}`);
    return replay;
  });
}

const games = Array.from({ length: 16 }, (_, i) => ({ seed: i + 1, game: playGame(i + 1) })).filter((g) => g.game.finished);

describe('buildDailyFritzGameRecord', () => {
  it('has finished games to test against', () => {
    expect(games.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...games.map((g) => g.game.hands.length))).toBeGreaterThan(3);
  });

  it('every game becomes a record the multiplayer format\'s own pure replay accepts, to the same scores and winner', () => {
    for (const { seed, game } of games) {
      const built = buildDailyFritzGameRecord(replaysOf(game));
      if (!built.ok) throw new Error(`seed ${seed}: ${built.reason}`);
      const replayed = replayMultiplayerRecord(built.record);
      if (!replayed.ok) throw new Error(`seed ${seed}: replay said ${replayed.reason}`);
      const last = game.hands.at(-1)!.terminal;
      expect(replayed.finalScores).toEqual({ you: last.players.player.score, opponent: last.players.fritz.score });
      expect(replayed.winnerId).toBe(last.winnerId === 'player' ? 'you' : 'opponent');
      expect(replayed.handScores.length).toBe(game.hands.length);
      expect(built.inferredStepCount).toBe(0);
    }
  });

  it('works for games Fritz starts, and for 14-tile deals (no dead tiles)', () => {
    const variants = [
      playGame(3, { drawWinner: 'bot' }),
      playGame(4, { drawWinner: 'bot' }),
      playGame(5, { dealSize: 14 }),
      playGame(6, { dealSize: 14, drawWinner: 'bot' }),
    ].filter((g) => g.finished);
    expect(variants.length).toBeGreaterThanOrEqual(3);
    for (const game of variants) {
      const built = buildDailyFritzGameRecord(replaysOf(game));
      if (!built.ok) throw new Error(built.reason);
      const replayed = replayMultiplayerRecord(built.record);
      if (!replayed.ok) throw new Error(replayed.reason);
    }
  });

  it('the record names no account or attempt: only "you" and "opponent"', () => {
    const built = buildDailyFritzGameRecord(replaysOf(games[0]!.game));
    if (!built.ok) throw new Error(built.reason);
    const { record } = built;
    const text = JSON.stringify(record);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); // no account or attempt id
    expect(text).not.toMatch(/daily-fritz|attempt|challenge/i);
    expect(record.players).toEqual(['you', 'opponent']);
    const seats = new Set<string>();
    for (const hand of record.hands) {
      seats.add(hand.starterId);
      Object.keys(hand.deals).forEach((s) => seats.add(s));
      hand.actions.forEach((a) => seats.add(a.seat));
      Object.keys(hand.endScores ?? {}).forEach((s) => seats.add(s));
    }
    Object.keys(record.finalScores).forEach((s) => seats.add(s));
    expect([...seats].sort()).toEqual(['opponent', 'you']); // the engine's own names ("player", "fritz") never reach the record
  });

  it('folds a run of draws into one DRAW and does not repeat the pass that ends it', () => {
    let sawDrawRun = false;
    let sawDrawThenPass = false;
    for (const { game } of games) {
      const replays = replaysOf(game);
      const built = buildDailyFritzGameRecord(replays);
      if (!built.ok) throw new Error(built.reason);
      replays.forEach((replay, h) => {
        const commands = replay.steps.map((s) => `${s.command.actorId}:${s.command.kind}`);
        const drawsInRun = commands.some((c, i) => c.endsWith(':draw') && commands[i + 1] === c);
        if (drawsInRun) sawDrawRun = true;
        if (commands.some((c, i) => c.endsWith(':draw') && commands[i + 1]?.endsWith(':pass') && commands[i + 1]!.split(':')[0] === c.split(':')[0])) sawDrawThenPass = true;
        const rawDraws = commands.filter((c) => c.endsWith(':draw')).length;
        const folded = built.record.hands[h]!.actions.filter((a) => a.type === 'DRAW').length;
        expect(folded).toBeLessThanOrEqual(rawDraws);
      });
    }
    expect(sawDrawRun).toBe(true);
    expect(sawDrawThenPass).toBe(true);
  });

  it('a game whose client lost a draw observation still becomes a valid record, and the inferred step is counted', () => {
    let covered = 0;
    for (const { game } of games) {
      const target = game.hands.findIndex(({ actions }) => actions.some((a, k) => a.actor === 'player' && a.kind === 'draw' && actions[k + 1]?.actor === 'player'));
      if (target < 0) continue;
      const replays = game.hands.map(({ handIndex, initialState, actions }, h) => {
        const lost = h === target ? actions.findIndex((a, k) => a.actor === 'player' && a.kind === 'draw' && actions[k + 1]?.actor === 'player') : -1;
        const degraded = lost >= 0 ? actions.filter((_, k) => k !== lost) : actions;
        const replay = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, degraded)));
        if (!replay.ok) throw new Error(`hand ${handIndex}: ${replay.code}`);
        return replay;
      });
      const built = buildDailyFritzGameRecord(replays);
      if (!built.ok) throw new Error(built.reason);
      expect(built.inferredStepCount).toBeGreaterThanOrEqual(1);
      expect(replayMultiplayerRecord(built.record).ok).toBe(true);
      covered += 1;
    }
    expect(covered).toBeGreaterThan(0);
  });

  it('refuses what is not one contiguous finished game, with a reason and no throw', () => {
    const game = games.find((g) => g.game.hands.length >= 4)!.game;
    const replays = replaysOf(game);
    expect(buildDailyFritzGameRecord([])).toEqual({ ok: false, reason: 'no_hands' });
    expect(buildDailyFritzGameRecord(replays.slice(1))).toMatchObject({ ok: false });
    expect(buildDailyFritzGameRecord([replays[0]!, ...replays.slice(2)])).toMatchObject({ ok: false, reason: 'hand_gap:2' });
    expect(buildDailyFritzGameRecord(replays.slice(0, -1))).toMatchObject({ ok: false, reason: 'game_not_over' });
  });
});
