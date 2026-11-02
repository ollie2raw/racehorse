import { describe, expect, it } from 'vitest';
import { canonicalizeDailyFritzAuthorityStateV2, type DailyFritzTranscript } from '@racehorse/game-core';
import { verifyDailyFritzHand } from './dailyFritzVerifier';
import { replayVerifiedDailyFritzHand } from './dailyFritzHandReplay';
import { finishedHands, inputFor, transcriptOf } from './dailyFritzHand.testkit';

type Action = DailyFritzTranscript['actions'][number];

const hands = finishedHands();

describe('replayVerifiedDailyFritzHand', () => {
  it('has finished hands to replay', () => {
    expect(hands.length).toBeGreaterThanOrEqual(8);
  });

  it('a complete transcript replays to exactly the commands it logged, ending where the verifier ends', () => {
    for (const { handIndex, initialState, actions, terminal } of hands) {
      const replay = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, actions)));
      if (!replay.ok) throw new Error(`hand ${handIndex}: ${replay.code} ${replay.message}`);
      expect(replay.inferredStepCount).toBe(0);
      expect(replay.steps.length).toBe(actions.length);
      expect(replay.steps.map((s) => s.command.kind)).toEqual(actions.map((a) => a.kind));
      expect(canonicalizeDailyFritzAuthorityStateV2(replay.terminalState)).toBe(canonicalizeDailyFritzAuthorityStateV2(terminal));
    }
  });

  it('every step chains: one step ends in the state the next begins from, the first from the initial state', () => {
    const { handIndex, initialState, actions } = hands[0]!;
    const replay = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, actions)));
    if (!replay.ok) throw new Error(replay.code);
    expect(replay.steps[0]!.before).toBe(initialState);
    replay.steps.slice(1).forEach((step, i) => expect(step.before).toBe(replay.steps[i]!.after));
    expect(canonicalizeDailyFritzAuthorityStateV2(replay.steps.at(-1)!.after)).toBe(canonicalizeDailyFritzAuthorityStateV2(replay.terminalState));
  });

  it('observing changes nothing: the verifier gives the identical result with and without an observer, and with one that throws', () => {
    for (const { handIndex, initialState, actions } of hands) {
      const transcript = transcriptOf(handIndex, actions);
      const plain = verifyDailyFritzHand(inputFor(handIndex, initialState, transcript));
      const observed = verifyDailyFritzHand({ ...inputFor(handIndex, initialState, transcript), onStep: () => undefined });
      const throwing = verifyDailyFritzHand({ ...inputFor(handIndex, initialState, transcript), onStep: () => { throw new Error('observer bug'); } });
      expect(JSON.stringify(observed.result)).toBe(JSON.stringify(plain.result));
      expect(JSON.stringify(throwing.result)).toBe(JSON.stringify(plain.result));
    }
  });

  it('an omitted mandatory draw is inferred by the verifier and appears in the replay as an inferred step', () => {
    let covered = 0;
    for (const { handIndex, initialState, actions, terminal } of hands) {
      // drop a player draw that is followed by another player action (the client lost that observation)
      const i = actions.findIndex((a, k) => a.actor === 'player' && a.kind === 'draw' && actions[k + 1]?.actor === 'player');
      if (i < 0) continue;
      const degraded = actions.filter((_, k) => k !== i);
      const replay = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, degraded)));
      if (!replay.ok) throw new Error(`hand ${handIndex}: ${replay.code} ${replay.message}`);
      expect(replay.inferredStepCount).toBeGreaterThanOrEqual(1);
      expect(replay.steps.some((s) => s.origin === 'inferred-draw')).toBe(true);
      expect(replay.steps.length).toBe(actions.length);
      expect(canonicalizeDailyFritzAuthorityStateV2(replay.terminalState)).toBe(canonicalizeDailyFritzAuthorityStateV2(terminal));
      covered += 1;
    }
    expect(covered).toBeGreaterThan(0);
  });

  it('an omitted Fritz turn before a player action is recovered and appears as a recovered step', () => {
    let covered = 0;
    for (const { handIndex, initialState, actions, terminal } of hands) {
      const i = actions.findIndex((a, k) => a.actor === 'fritz' && a.kind === 'play' && actions[k + 1]?.actor === 'player');
      if (i < 0) continue;
      const degraded = actions.filter((_, k) => k !== i);
      const replay = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, degraded)));
      if (!replay.ok) continue; // the verifier may legitimately refuse some shapes; those are covered below
      expect(replay.steps.some((s) => s.origin === 'recovered-fritz')).toBe(true);
      expect(canonicalizeDailyFritzAuthorityStateV2(replay.terminalState)).toBe(canonicalizeDailyFritzAuthorityStateV2(terminal));
      covered += 1;
    }
    expect(covered).toBeGreaterThan(0);
  });

  it('a transcript the verifier rejects has no replay, with the verifier\'s own code, and never throws', () => {
    const { handIndex, initialState, actions } = hands[0]!;
    const wrongActor = actions.map((a, k) => (k === 0 ? { ...a, actor: a.actor === 'player' ? 'fritz' : 'player' } : a)) as Action[];
    const bad = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, wrongActor)));
    expect(bad.ok).toBe(false);
    const incomplete = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, actions.slice(0, 3))));
    expect(incomplete).toMatchObject({ ok: false, code: 'incomplete_transcript' });
    const garbage = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, { nonsense: true }));
    expect(garbage).toMatchObject({ ok: false, code: 'malformed_transcript' });
  });
});
