import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  applyGameCommand,
  canonicalizeDailyFritzAuthorityStateV2,
  chooseOfficialFritzDecisionForVersion,
  getDailyFritzAuthorityStateDigest,
  getFritzPolicyContract,
  getLegalMoves,
  type DailyFritzTranscript,
  type GameCommand,
  type GameState,
} from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand } from './dailyFritz';
import { createOfficialDailyFritzHandState, verifyDailyFritzHand } from './dailyFritzVerifier';
import { replayVerifiedDailyFritzHand } from './dailyFritzHandReplay';

const RUN_DATE = '2026-11-02';
const CHALLENGE_ID = 'daily-fritz:2026-11-02';
const ATTEMPT_ID = 'attempt-replay';
const TIER = 'elite' as const;
const DEAL_SIZE = 7 as const;
const NOW = () => '2026-11-02T00:00:00.000Z';

function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

type Action = DailyFritzTranscript['actions'][number];

/** An honest server-authored driver: one transcript action per engine command. Fritz plays the official policy; the player plays a random legal tile. */
function playHand(handIndex: number, seed: number): { initialState: GameState; actions: Action[]; terminal: GameState } {
  const deal = generateSingleDailyFritzGameHand(RUN_DATE, 1, handIndex, DEAL_SIZE);
  const initialState = createOfficialDailyFritzHandState({
    deal, handIndex, drawWinner: handIndex % 2 === 0 ? 'you' : 'fritz', winningScore: 60, dealSize: DEAL_SIZE, playerScore: 0, fritzScore: 0,
  });
  const rng = makeRng(seed);
  const actions: Action[] = [];
  let state = initialState;
  for (let sequence = 0; sequence < 400 && !state.handOver && !state.gameOver; sequence += 1) {
    const actor = state.playerIds[state.currentPlayerIndex] as 'player' | 'fritz';
    const official = chooseOfficialFritzDecisionForVersion({ version: FRITZ_POLICY_VERSION, state, participantId: actor, tier: TIER });
    let action: Action;
    if (official.kind !== 'play') {
      action = { sequence, actor, kind: official.kind };
    } else if (actor === 'fritz') {
      action = { sequence, actor, kind: 'play', tile: official.tile, position: official.position, preStateDigest: getDailyFritzAuthorityStateDigest(state, 2) };
    } else {
      const plays = getLegalMoves(state, actor).filter((m) => m.type === 'play');
      const pick = plays[Math.floor(rng() * plays.length)]!;
      action = { sequence, actor, kind: 'play', tile: pick.tile, position: pick.position };
    }
    const command: GameCommand = action.kind === 'play'
      ? { version: 1, commandId: `drv:${sequence}`, sequence: state.sequence, actorId: actor, kind: 'play', tile: action.tile, position: action.position }
      : { version: 1, commandId: `drv:${sequence}`, sequence: state.sequence, actorId: actor, kind: action.kind };
    state = applyGameCommand(state, command).state;
    actions.push(action);
  }
  return { initialState, actions, terminal: state };
}

function transcriptOf(handIndex: number, actions: Action[]): DailyFritzTranscript {
  return {
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    rulesVersion: 1,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
    stateDigestVersion: 2,
    challengeId: CHALLENGE_ID,
    attemptId: ATTEMPT_ID,
    gameNumber: 1,
    handIndex,
    actions: actions.map((a, index) => ({ ...a, sequence: index })),
  } as DailyFritzTranscript;
}

const inputFor = (handIndex: number, initialState: GameState, transcript: unknown) => ({
  transcript,
  initialState,
  expectedChallengeId: CHALLENGE_ID,
  expectedAttemptId: ATTEMPT_ID,
  expectedGameNumber: 1 as const,
  expectedHandIndex: handIndex,
  userId: 'user-replay',
  fritzTier: TIER,
  now: NOW,
});

const hands = Array.from({ length: 12 }, (_, i) => ({ handIndex: i, ...playHand(i, i * 7919 + 13) })).filter((h) => h.terminal.handOver);

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
