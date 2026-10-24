/**
 * Daily Fritz verifier integrity: generated hands, three-way differential, reconstruction, tampering, ambiguity, versioning.
 *
 *   DF_VERIFIER_HANDS   random hands in the corpus   (default 48)
 *   DF_VERIFIER_SEED    seed namespace               (default "daily-fritz-verifier-v1")
 *
 * A failure message carries the spec id `<namespace>:<n>`; `makeSpec(namespace, n)` + `playHand(spec)` replays it exactly.
 * See server/test/support/dailyFritzVerifierOracle.ts for what is independent of the code under test.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDeterministicRandom, getDailyFritzAuthorityStateDigest, parseDailyFritzTranscript, type DailyFritzTranscript } from '@racehorse/game-core';
import { compareStates } from '../../packages/game-core/src/__tests__/support/engineHarness';
import {
  addCov, buildOracle, canon, countExplicitHistories, expectedHandResult, judge, makeSpec, newCov, okey, ownerSpec, playHand, productionInitialState,
  runClientLeg, runVerifier,
  type Cov, type JudgeAction, type Played, type Spec,
} from '../test/support/dailyFritzVerifierOracle';
import { buildDailyFritzChallengeId } from './dailyFritzIdentity';
import { getDailyFritzDrawWinner, getDailyFritzSeed } from './dailyFritz';
import { DailyFritzVerificationError } from './dailyFritzVerifier';
import { verifyAttemptHand } from './http/routes/dailyFritzVerificationGlue';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from './http/stores/dailyFritzStore';

export const HANDS = Number(process.env.DF_VERIFIER_HANDS ?? 48);
export const NS = process.env.DF_VERIFIER_SEED ?? 'daily-fritz-verifier-v1';
/** Minimum-volume floors are tuned for 150 hands and scale down for smaller corpora (never below 3). */
const scaled = (atLeast: number): number => Math.max(3, Math.floor((atLeast * Math.min(HANDS, 150)) / 150) - 1);

const REQUIRED_COVERAGE: Array<keyof Cov> = [
  'oneDrawThenPlay', 'longDrawChain', 'drawToExhaustionThenPass', 'multiDrawChain', 'lockedTilesAtPass', 'fritzDraw', 'humanDraw',
  'blockedAfterDrawChain', 'drawThenScoringPlay', 'finalDrawableTileDrawn', 'emptyDrawableAction', 'chainInsidePlay', 'embeddedPass',
  'gameEnding', 'blockedHand', 'outHand', 'branchPlay', 'doublePlay', 'scoringPlay', 'fritzPass', 'humanPass',
];

const keys = (tiles: readonly { low: number; high: number }[]): string[] => tiles.map(okey);
const toJudge = (t: DailyFritzTranscript): JudgeAction[] => t.actions.map((a) => ({
  actor: a.actor, kind: a.kind, ...(a.kind === 'play' ? { tile: a.tile, position: a.position } : {}),
}));

type Corpus = { hands: Played[]; coverage: Cov; coverSeeds: Record<string, string> };
let corpusMemo: Corpus | null = null;

/** The random corpus plus, for every required rule path the random hands missed, the first seed that exercises it. */
export function getCorpus(): Corpus {
  if (corpusMemo) return corpusMemo;
  const hands: Played[] = [];
  const coverage = newCov();
  for (let n = 0; n < HANDS; n += 1) {
    const played = playHand(makeSpec(NS, n));
    hands.push(played);
    addCov(coverage, played.cov);
  }
  const coverSeeds: Record<string, string> = {};
  for (const category of REQUIRED_COVERAGE) {
    if (coverage[category] > 0) continue;
    for (let k = 0; k < 6000; k += 1) {
      const spec = makeSpec(`${NS}:cover:${category}`, k);
      const probe = playHand(spec, { skipPolicyParity: true });
      if (probe.cov[category] > 0) {
        const played = playHand(spec); // full parity
        hands.push(played);
        addCov(coverage, played.cov);
        coverSeeds[category] = spec.id;
        break;
      }
    }
  }
  corpusMemo = { hands, coverage, coverSeeds };
  return corpusMemo;
}

/** Honest hand: the oracle, the real client path and the real verifier must all agree on everything. */
export function assertHonestHand(p: Played): { transcript: DailyFritzTranscript; verified: Extract<ReturnType<typeof runVerifier>, { ok: true }> } {
  const { spec } = p;
  const ctx = spec.id;
  // 0. the production initial state is the documented independent opening position
  compareStates(`${ctx}:initial`, productionInitialState(spec), buildOracle(spec), 28);

  // 1. the real client path produces the command list the oracle executed
  const { match, transcript } = runClientLeg(p);
  const sent = transcript.actions.map((a) => ({
    actor: a.actor, kind: a.kind, tile: a.kind === 'play' ? canon(a.tile) : undefined, position: a.kind === 'play' ? a.position : undefined,
  }));
  expect(sent, `${ctx}: client transcript vs oracle commands`).toEqual(p.cmds.map((c) => ({ actor: c.actor, kind: c.kind, tile: c.tile, position: c.position })));
  transcript.actions.forEach((a, i) => {
    if (a.actor === 'fritz') expect(a.preStateDigest, `${ctx}: fritz digest at ${i}`).toBe(p.fritzDigests.get(i));
  });

  // 2. client live state agrees with the oracle
  expect(match.handOver, `${ctx}: client handOver`).toBe(true);
  expect(match.players.you.score, `${ctx}: client player score`).toBe(p.oracle.scores.get('player'));
  expect(match.players.bot.score, `${ctx}: client fritz score`).toBe(p.oracle.scores.get('fritz'));
  expect(keys(match.players.you.hand), `${ctx}: client player hand`).toEqual(keys(p.oracle.hands.get('player')!));
  expect(keys(match.players.bot.hand), `${ctx}: client fritz hand`).toEqual(keys(p.oracle.hands.get('fritz')!));
  expect(keys(match.boneyard), `${ctx}: client boneyard`).toEqual(keys(p.oracle.boneyard));
  expect(match.gameOver, `${ctx}: client gameOver`).toBe(p.oracle.gameOver);

  // 3. the real verifier accepts it and reconstructs the oracle's terminal state
  const verified = runVerifier(spec, transcript);
  if (!verified.ok) throw new Error(`${ctx}: verifier rejected an honest transcript: ${verified.code} ${verified.message}`);
  const t = verified.terminalState;
  compareStates(`${ctx}:verifier-terminal`, t, p.oracle, 28);
  expect(keys(t.players.player.hand), `${ctx}: verifier player hand order`).toEqual(keys(p.oracle.hands.get('player')!));
  expect(keys(t.players.fritz.hand), `${ctx}: verifier fritz hand order`).toEqual(keys(p.oracle.hands.get('fritz')!));
  expect(keys(t.boneyard), `${ctx}: verifier boneyard consumption`).toEqual(keys(p.oracle.boneyard));
  expect(t.sequence, `${ctx}: final sequence`).toBe(p.engine.sequence);
  expect(getDailyFritzAuthorityStateDigest(t), `${ctx}: terminal digest vs lockstep engine`).toBe(getDailyFritzAuthorityStateDigest(p.engine));

  // 4. the derived result
  const exp = expectedHandResult(spec, p.oracle);
  const r = verified.result;
  expect({ b: [r.playerScoreBefore, r.fritzScoreBefore], a: [r.playerScoreAfter, r.fritzScoreAfter], reason: r.reason }, `${ctx}: result`)
    .toEqual({ b: [exp.playerBefore, exp.fritzBefore], a: [exp.playerAfter, exp.fritzAfter], reason: exp.reason });
  expect(r.pointsAwarded, `${ctx}: pointsAwarded`).toBe(Math.max(exp.handScoreDelta.player, exp.handScoreDelta.fritz));
  expect(r.actionCount).toBe(p.cmds.length);
  const gameWinner = p.oracle.winner === 'player' || p.oracle.winner === 'fritz' ? p.oracle.winner : null;
  expect(r.winner, `${ctx}: winner`).toBe(gameWinner ?? (exp.handScoreDelta.player > 0 ? 'player' : exp.handScoreDelta.fritz > 0 ? 'fritz' : null));

  // 5. the independent judge agrees it is a valid (and canonical) execution
  const verdict = judge(spec, toJudge(transcript), 'canonical');
  expect(verdict.valid, `${ctx}: judge ${verdict.valid ? '' : (verdict as { reason: string }).reason}`).toBe(true);
  return { transcript, verified };
}

describe(`Daily Fritz verifier: honest hands, client = server = oracle (${NS}, ${HANDS} random hands + targeted coverage)`, () => {
  let corpus: Corpus;
  beforeAll(() => { corpus = getCorpus(); }, 600_000);

  it('every honest generated hand agrees across oracle, real client path and real verifier', () => {
    let actions = 0;
    for (const hand of corpus.hands) {
      assertHonestHand(hand);
      actions += hand.cmds.length;
    }
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] honest differential: ${corpus.hands.length} hands, ${actions} actions, policy checks ${corpus.hands.reduce((s, h) => s + h.policyChecks, 0)}, targeted seeds ${JSON.stringify(corpus.coverSeeds)}`);
    expect(corpus.hands.length).toBeGreaterThanOrEqual(HANDS);
  }, 600_000);

  it('the corpus exercised every rule path the reconstruction contract depends on', () => {
    // eslint-disable-next-line no-console
    console.info('[df-verifier] coverage', JSON.stringify(corpus.coverage));
    for (const category of REQUIRED_COVERAGE) expect(corpus.coverage[category], `no generated hand covers "${category}"`).toBeGreaterThan(0);
  });
});

// ───────────────────────────── transcript surgery helpers ─────────────────────────────

type RawAction = Record<string, unknown>;
type RawTranscript = Record<string, unknown> & { actions: RawAction[] };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const reseq = (actions: RawAction[]): RawAction[] => actions.map((a, i) => ({ ...a, sequence: i }));
const withActions = (t: RawTranscript, actions: RawAction[]): RawTranscript => ({ ...t, actions: reseq(actions) });
const stripDigests = (t: RawTranscript): RawTranscript => withActions(t, t.actions.map((a) => { const { preStateDigest: _drop, ...rest } = a; void _drop; return rest; }));
const asRaw = (t: DailyFritzTranscript): RawTranscript => clone(t) as unknown as RawTranscript;

const ALL_TILES = Array.from({ length: 28 }, (_, i) => {
  let high = 0;
  let rest = i;
  while (rest > high) { rest -= high + 1; high += 1; }
  return { low: rest, high };
});
const POSITIONS = ['left', 'right', 'branch-0-0', 'branch-0-1', 'branch-1-0', 'branch-1-1', 'branch-2-0'];

// ───────────────────────────── omitted-draw reconstruction ─────────────────────────────

describe('Daily Fritz verifier: omitted mandatory draws reconstruct exactly the same tiles in the same order', () => {
  const variants: Array<{ name: string; omit: (a: RawAction, i: number, all: RawAction[]) => boolean }> = [
    { name: 'every explicit draw', omit: (a) => a.kind === 'draw' },
    { name: 'human draws only', omit: (a) => a.kind === 'draw' && a.actor === 'player' },
    { name: 'fritz draws only', omit: (a) => a.kind === 'draw' && a.actor === 'fritz' },
    { name: 'the last draw of each run', omit: (a, i, all) => a.kind === 'draw' && !(all[i + 1]?.kind === 'draw' && all[i + 1]?.actor === a.actor) },
  ];

  it('accepts every reduced variant and lands on the byte-identical terminal state', () => {
    let reducedCases = 0;
    let omittedDraws = 0;
    for (const hand of getCorpus().hands) {
      const { transcript, verified } = assertHonestHand(hand);
      const honest = asRaw(transcript);
      const honestDigest = getDailyFritzAuthorityStateDigest(verified.terminalState);
      for (const variant of variants) {
        const kept = honest.actions.filter((a, i, all) => !variant.omit(a, i, all));
        if (kept.length === honest.actions.length) continue;
        omittedDraws += honest.actions.length - kept.length;
        reducedCases += 1;
        const reduced = withActions(honest, kept);
        const out = runVerifier(hand.spec, reduced);
        if (!out.ok) throw new Error(`${hand.spec.id} [${variant.name}]: reduced transcript rejected: ${out.code} ${out.message}`);
        expect(getDailyFritzAuthorityStateDigest(out.terminalState), `${hand.spec.id} [${variant.name}] terminal digest`).toBe(honestDigest);
        expect(keys(out.terminalState.players.player.hand), `${hand.spec.id} [${variant.name}] player hand order`).toEqual(keys(verified.terminalState.players.player.hand));
        expect(keys(out.terminalState.players.fritz.hand), `${hand.spec.id} [${variant.name}] fritz hand order`).toEqual(keys(verified.terminalState.players.fritz.hand));
        expect(keys(out.terminalState.boneyard), `${hand.spec.id} [${variant.name}] boneyard`).toEqual(keys(verified.terminalState.boneyard));
        expect({ p: out.result.playerScoreAfter, f: out.result.fritzScoreAfter, reason: out.result.reason })
          .toEqual({ p: verified.result.playerScoreAfter, f: verified.result.fritzScoreAfter, reason: verified.result.reason });
      }
    }
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] omitted-draw reduced transcripts: ${reducedCases} cases, ${omittedDraws} omitted draws, all reconstructed identically`);
    expect(reducedCases).toBeGreaterThan(scaled(50));
  }, 600_000);

  it('a mixed run (some draws explicit, some omitted) reconstructs the same tiles when no Fritz digest pins the intermediate state', () => {
    let cases = 0;
    for (const hand of getCorpus().hands) {
      const { transcript, verified } = assertHonestHand(hand);
      const honest = stripDigests(asRaw(transcript));
      let toggle = false;
      const kept = honest.actions.filter((a, i, all) => {
        if (a.kind !== 'draw') { toggle = false; return true; }
        if (all[i - 1]?.kind === 'draw' && all[i - 1]?.actor === a.actor) toggle = !toggle; else toggle = false;
        return !toggle; // drop every second draw of a run
      });
      if (kept.length === honest.actions.length) continue;
      const out = runVerifier(hand.spec, withActions(honest, kept), { requireStateDigests: false });
      if (!out.ok) throw new Error(`${hand.spec.id}: mixed run rejected: ${out.code} ${out.message}`);
      expect(getDailyFritzAuthorityStateDigest(out.terminalState), `${hand.spec.id} mixed-run terminal digest`).toBe(getDailyFritzAuthorityStateDigest(verified.terminalState));
      cases += 1;
    }
    expect(cases).toBeGreaterThan(scaled(5));
  }, 600_000);

  it('never invents a pass: a pass recorded where the draw chain would produce a playable tile is rejected', () => {
    let tried = 0;
    for (const hand of getCorpus().hands) {
      const { transcript } = assertHonestHand(hand);
      const raw = stripDigests(asRaw(transcript));
      // find a draw run that is followed by a play of the same actor (the chain produced a playable tile)
      for (let i = 0; i < raw.actions.length; i += 1) {
        const a = raw.actions[i]!;
        if (a.kind !== 'draw') continue;
        let j = i;
        while (raw.actions[j]?.kind === 'draw' && raw.actions[j]?.actor === a.actor) j += 1;
        if (raw.actions[j]?.kind !== 'play' || raw.actions[j]?.actor !== a.actor) { i = j; continue; }
        const mutated = withActions(raw, [...raw.actions.slice(0, i), { actor: a.actor, kind: 'pass' }, ...raw.actions.slice(j)]);
        const out = runVerifier(hand.spec, mutated, { requireStateDigests: false });
        tried += 1;
        expect(out.ok, `${hand.spec.id}: pass substituted for a draw chain must not verify`).toBe(false);
        if (!out.ok) expect(out.code, `${hand.spec.id}: must be a typed rejection`).not.toBe('CRASH');
        break;
      }
    }
    expect(tried).toBeGreaterThan(scaled(20));
  }, 600_000);

  it('a pass at an exhausted drawable boneyard is accepted with or without the preceding explicit draws', () => {
    let seen = 0;
    for (const hand of getCorpus().hands) {
      const { transcript, verified } = assertHonestHand(hand);
      const honest = asRaw(transcript);
      const hasDrawThenPass = honest.actions.some((a, i, all) => a.kind === 'pass' && all[i - 1]?.kind === 'draw');
      if (!hasDrawThenPass) continue;
      const reduced = withActions(honest, honest.actions.filter((a) => a.kind !== 'draw'));
      const out = runVerifier(hand.spec, reduced);
      if (!out.ok) throw new Error(`${hand.spec.id}: ${out.code} ${out.message}`);
      expect(getDailyFritzAuthorityStateDigest(out.terminalState)).toBe(getDailyFritzAuthorityStateDigest(verified.terminalState));
      seen += 1;
    }
    expect(seen).toBeGreaterThan(0);
  }, 600_000);
});

// ───────────────────────────── tampered transcripts ─────────────────────────────

type Mutation = {
  name: string;
  /** semantic: judged by the independent oracle; structural: must reject; nonsemantic: must verify to the identical result */
  kind: 'semantic' | 'structural' | 'nonsemantic';
  run: (t: RawTranscript, p: Played, rnd: ReturnType<typeof createDeterministicRandom>) => RawTranscript | null;
};
const pickIndex = (rnd: ReturnType<typeof createDeterministicRandom>, indices: number[]): number | null => (indices.length === 0 ? null : indices[rnd.nextInt(indices.length)]!);
const indicesWhere = (t: RawTranscript, pred: (a: RawAction) => boolean): number[] => t.actions.flatMap((a, i) => (pred(a) ? [i] : []));
const otherActor = (actor: unknown) => (actor === 'player' ? 'fritz' : 'player');

const MUTATIONS: Mutation[] = [
  { name: 'remove a human action', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, indicesWhere(t, (a) => a.actor === 'player')); return i === null ? null : withActions(t, t.actions.filter((_, k) => k !== i)); } },
  { name: 'remove a fritz action', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, indicesWhere(t, (a) => a.actor === 'fritz')); return i === null ? null : withActions(t, t.actions.filter((_, k) => k !== i)); } },
  { name: 'remove a human play', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, indicesWhere(t, (a) => a.actor === 'player' && a.kind === 'play')); return i === null ? null : withActions(t, t.actions.filter((_, k) => k !== i)); } },
  { name: 'duplicate an action', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, t.actions.map((_, k) => k)); return i === null ? null : withActions(t, [...t.actions.slice(0, i + 1), clone(t.actions[i]!), ...t.actions.slice(i + 1)]); } },
  { name: 'reorder two adjacent actions', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, t.actions.slice(0, -1).map((_, k) => k)); if (i === null) return null; const a = [...t.actions]; [a[i], a[i + 1]] = [a[i + 1]!, a[i]!]; return withActions(t, a); } },
  { name: 'change a tile', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, indicesWhere(t, (a) => a.kind === 'play')); if (i === null) return null; const cur = okey(t.actions[i]!.tile as { low: number; high: number }); const choices = ALL_TILES.filter((x) => okey(x) !== cur); const a = clone(t.actions); a[i]!.tile = choices[rnd.nextInt(choices.length)]; return withActions(t, a); } },
  { name: 'claim a tile the opponent holds', kind: 'semantic', run: (t, p, rnd) => { const i = pickIndex(rnd, indicesWhere(t, (a) => a.kind === 'play')); if (i === null) return null; const actor = t.actions[i]!.actor as string; const theirs = actor === 'player' ? p.deal.fritz_tiles : p.deal.player_tiles; const a = clone(t.actions); a[i]!.tile = canon(theirs[rnd.nextInt(theirs.length)]!); return withActions(t, a); } },
  { name: 'change a placement', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, indicesWhere(t, (a) => a.kind === 'play')); if (i === null) return null; const choices = POSITIONS.filter((x) => x !== t.actions[i]!.position); const a = clone(t.actions); a[i]!.position = choices[rnd.nextInt(choices.length)]; return withActions(t, a); } },
  { name: 'remove a required pass', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, indicesWhere(t, (a) => a.kind === 'pass')); return i === null ? null : withActions(t, t.actions.filter((_, k) => k !== i)); } },
  { name: 'add an impossible pass', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, t.actions.map((_, k) => k)); return i === null ? null : withActions(t, [...t.actions.slice(0, i), { actor: t.actions[i]!.actor, kind: 'pass' }, ...t.actions.slice(i)]); } },
  { name: 'add an impossible draw', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, t.actions.map((_, k) => k)); return i === null ? null : withActions(t, [...t.actions.slice(0, i), { actor: t.actions[i]!.actor, kind: 'draw' }, ...t.actions.slice(i)]); } },
  { name: 'flip the actor of an action', kind: 'semantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, t.actions.map((_, k) => k)); if (i === null) return null; const a = clone(t.actions); a[i]!.actor = otherActor(a[i]!.actor); return withActions(t, a); } },
  { name: 'truncate the tail', kind: 'semantic', run: (t, _p, rnd) => { if (t.actions.length < 3) return null; const k = 1 + rnd.nextInt(Math.min(3, t.actions.length - 1)); return withActions(t, t.actions.slice(0, t.actions.length - k)); } },
  { name: 'append an action after the terminal state', kind: 'semantic', run: (t, _p, rnd) => { const last = t.actions[t.actions.length - 1]!; const kinds = ['pass', 'draw', 'play'] as const; const kind = kinds[rnd.nextInt(3)]!; return withActions(t, [...t.actions, kind === 'play' ? { actor: otherActor(last.actor), kind, tile: { low: 6, high: 6 }, position: 'left' } : { actor: otherActor(last.actor), kind }]); } },
  { name: 'alter the hand boundary (hand index)', kind: 'structural', run: (t) => ({ ...t, handIndex: Number(t.handIndex) + 1 }) },
  { name: 'alter the game number', kind: 'structural', run: (t) => ({ ...t, gameNumber: Number(t.gameNumber) === 3 ? 1 : Number(t.gameNumber) + 1 }) },
  { name: 'substitute another challenge identity', kind: 'structural', run: (t) => ({ ...t, challengeId: `${String(t.challengeId)}:other` }) },
  { name: 'substitute another attempt identity', kind: 'structural', run: (t) => ({ ...t, attemptId: `${String(t.attemptId)}:other` }) },
  { name: 'break the sequence numbering', kind: 'structural', run: (t) => ({ ...t, actions: t.actions.map((a, i) => ({ ...a, sequence: i === 0 ? 1 : i })) }) },
  { name: 'add an unknown transcript field', kind: 'structural', run: (t) => ({ ...t, claimedWinner: 'player' }) },
  { name: 'add an unknown action field', kind: 'structural', run: (t) => ({ ...t, actions: t.actions.map((a, i) => (i === 0 ? { ...a, claimedScore: 99 } : a)) }) },
  { name: 'flip a tile orientation (low/high)', kind: 'nonsemantic', run: (t, _p, rnd) => { const i = pickIndex(rnd, indicesWhere(t, (a) => a.kind === 'play')); if (i === null) return null; const a = clone(t.actions); const tile = a[i]!.tile as { low: number; high: number }; a[i]!.tile = { low: tile.high, high: tile.low }; return withActions(t, a); } },
  { name: 'add a digest to a human action (ignored)', kind: 'nonsemantic', run: (t) => withActions(t, t.actions.map((a) => (a.actor === 'player' ? { ...a, preStateDigest: 'df-state-v2:deadbeef' } : a))) },
  { name: 'reorder object keys', kind: 'nonsemantic', run: (t) => ({ actions: [...t.actions].map((a) => Object.fromEntries(Object.entries(a).reverse())), ...Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'actions').reverse()) }) as RawTranscript },
];

describe('Daily Fritz verifier: one-at-a-time tampering is rejected, or accepted only as a valid execution with identical semantics', () => {
  const tally = new Map<string, { applied: number; rejected: number; acceptedValid: number; codes: Record<string, number> }>();
  const bump = (name: string, field: 'applied' | 'rejected' | 'acceptedValid', code?: string) => {
    const row = tally.get(name) ?? { applied: 0, rejected: 0, acceptedValid: 0, codes: {} };
    row[field] += 1;
    if (code) row.codes[code] = (row.codes[code] ?? 0) + 1;
    tally.set(name, row);
  };

  it('every mutation outcome agrees with the independent oracle judge (no false accept, no false reject, no typed-error escape)', () => {
    const failures: string[] = [];
    for (const hand of getCorpus().hands) {
      const { transcript, verified: honestVerified } = assertHonestHand(hand);
      const honest = stripDigests(asRaw(transcript));
      const honestDigest = getDailyFritzAuthorityStateDigest(honestVerified.terminalState);
      const baseline = runVerifier(hand.spec, honest, { requireStateDigests: false });
      if (!baseline.ok) throw new Error(`${hand.spec.id}: digest-stripped honest transcript rejected: ${baseline.code}`);
      MUTATIONS.forEach((mutation, mi) => {
        const rnd = createDeterministicRandom(`${hand.spec.id}:mutation:${mi}`);
        const mutated = mutation.run(clone(honest), hand, rnd);
        if (!mutated) return;
        bump(mutation.name, 'applied');
        const out = runVerifier(hand.spec, mutated, { requireStateDigests: false });
        const label = `${hand.spec.id} [${mutation.name}]`;
        if (!out.ok && out.code === 'CRASH') { failures.push(`${label}: verifier crashed instead of rejecting: ${out.message}`); return; }

        if (mutation.kind === 'structural') {
          if (out.ok) failures.push(`${label}: structural tamper was ACCEPTED`);
          else bump(mutation.name, 'rejected', out.code);
          return;
        }
        if (mutation.kind === 'nonsemantic') {
          if (!out.ok) { failures.push(`${label}: non-semantic difference was rejected: ${out.code}`); return; }
          bump(mutation.name, 'acceptedValid');
          if (getDailyFritzAuthorityStateDigest(out.terminalState) !== honestDigest) failures.push(`${label}: non-semantic difference changed the result`);
          if (out.result.transcriptDigest !== baseline.result.transcriptDigest && mutation.name !== 'add a digest to a human action (ignored)') failures.push(`${label}: normalized transcript digest differs from the honest one`);
          return;
        }
        // semantic: the independent judge decides what the answer must be
        let parsed: DailyFritzTranscript | null = null;
        try { parsed = parseDailyFritzTranscript(mutated); } catch { parsed = null; }
        if (!parsed) { if (out.ok) failures.push(`${label}: unparseable transcript accepted`); else bump(mutation.name, 'rejected', out.code); return; }
        const verdict = judge(hand.spec, toJudge(parsed), 'canonical');
        if (out.ok && !verdict.valid) { failures.push(`${label}: FALSE ACCEPT (judge: ${verdict.reason})`); return; }
        if (!out.ok && verdict.valid) { failures.push(`${label}: FALSE REJECT (${out.code}: ${out.message}) of a valid execution`); return; }
        if (!out.ok) { bump(mutation.name, 'rejected', out.code); return; }
        bump(mutation.name, 'acceptedValid');
        try { compareStates(`${label}:accepted-vs-judge`, out.terminalState, (verdict as { oracle: ReturnType<typeof buildOracle> }).oracle, 28); }
        catch (error) { failures.push(`${label}: accepted a valid execution but reconstructed a DIFFERENT result: ${(error as Error).message}`); }
      });
    }
    const rows = [...tally.entries()].map(([name, r]) => `${name}: ${r.applied} applied, ${r.rejected} rejected, ${r.acceptedValid} accepted-as-valid-or-equivalent ${JSON.stringify(r.codes)}`);
    const totals = [...tally.values()].reduce((t, r) => ({ applied: t.applied + r.applied, rejected: t.rejected + r.rejected, acceptedValid: t.acceptedValid + r.acceptedValid }), { applied: 0, rejected: 0, acceptedValid: 0 });
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] tamper matrix\n${rows.join('\n')}`);
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] tamper totals: ${totals.applied} mutated transcripts (${MUTATIONS.length} kinds), ${totals.rejected} rejected, ${totals.acceptedValid} accepted (each confirmed a valid execution / identical semantics by the independent judge)`);
    const byKind = new Map<string, string[]>();
    for (const f of failures) {
      const kind = /FALSE ACCEPT/.test(f) ? 'false-accept' : /FALSE REJECT/.test(f) ? 'false-reject' : /DIFFERENT result/.test(f) ? 'different-result' : /crashed/.test(f) ? 'crash' : 'other';
      byKind.set(kind, [...(byKind.get(kind) ?? []), f]);
    }
    const summary = [...byKind.entries()].map(([k, v]) => `${k}: ${v.length}\n  ${v.slice(0, 6).join('\n  ')}`).join('\n');
    expect(failures, `${failures.length} divergence(s) by kind:\n${summary}\nReplay with makeSpec(<ns>,<n>) + playHand`).toEqual([]);
  }, 600_000);

  it('digest tampering: a missing or wrong Fritz fingerprint is rejected when the attempt requires state digests', () => {
    let missing = 0;
    let wrong = 0;
    for (const hand of getCorpus().hands) {
      const { transcript } = assertHonestHand(hand);
      const honest = asRaw(transcript);
      const fritzPlays = indicesWhere(honest, (a) => a.actor === 'fritz' && a.kind === 'play');
      const fritzAny = indicesWhere(honest, (a) => a.actor === 'fritz');
      if (fritzPlays.length === 0) continue;
      const rnd = createDeterministicRandom(`${hand.spec.id}:digest`);
      const dropAt = fritzPlays[rnd.nextInt(fritzPlays.length)]!;
      const dropped = clone(honest); delete dropped.actions[dropAt]!.preStateDigest;
      const droppedOut = runVerifier(hand.spec, dropped, { requireStateDigests: true });
      expect(droppedOut.ok, `${hand.spec.id}: missing Fritz play digest must be rejected`).toBe(false);
      if (!droppedOut.ok) expect(droppedOut.code).toBe('missing_fritz_state_digest');
      missing += 1;
      const wrongAt = fritzAny[rnd.nextInt(fritzAny.length)]!;
      const corrupted = clone(honest);
      const real = String(corrupted.actions[wrongAt]!.preStateDigest);
      corrupted.actions[wrongAt]!.preStateDigest = real === 'df-state-v2:00000000' ? 'df-state-v2:00000001' : 'df-state-v2:00000000';
      const wrongOut = runVerifier(hand.spec, corrupted, { requireStateDigests: true });
      expect(wrongOut.ok, `${hand.spec.id}: wrong Fritz digest must be rejected`).toBe(false);
      if (!wrongOut.ok) expect(wrongOut.code).toBe('fritz_state_mismatch');
      wrong += 1;
    }
    expect(missing).toBeGreaterThan(scaled(20));
    expect(wrong).toBeGreaterThan(scaled(20));
  }, 600_000);
});

// ───────────────────────────── omitted official Fritz turn ─────────────────────────────

describe('Daily Fritz verifier: one omitted official Fritz action is reconstructed exactly, whatever the player does next', () => {
  it('removing any single-action Fritz turn verifies to the identical terminal state (next player action: play, draw or pass)', () => {
    const nextKinds = new Map<string, number>();
    let cases = 0;
    for (const hand of getCorpus().hands) {
      const { transcript, verified } = assertHonestHand(hand);
      const honest = asRaw(transcript);
      const honestDigest = getDailyFritzAuthorityStateDigest(verified.terminalState);
      honest.actions.forEach((a, i, all) => {
        if (a.actor !== 'fritz') return;
        const prevIsFritz = all[i - 1]?.actor === 'fritz';
        const nextIsFritz = all[i + 1]?.actor === 'fritz';
        const next = all[i + 1];
        if (prevIsFritz || nextIsFritz || !next) return; // a single-action Fritz turn followed by a player action
        const reduced = withActions(honest, all.filter((_, k) => k !== i));
        const out = runVerifier(hand.spec, reduced);
        if (!out.ok) throw new Error(`${hand.spec.id}: omitting fritz action ${i} (${String(a.kind)}) before a player ${String(next.kind)} was rejected: ${out.code} ${out.message}`);
        expect(getDailyFritzAuthorityStateDigest(out.terminalState), `${hand.spec.id} omitted fritz ${i}`).toBe(honestDigest);
        nextKinds.set(`${String(a.kind)}->${String(next.kind)}`, (nextKinds.get(`${String(a.kind)}->${String(next.kind)}`) ?? 0) + 1);
        cases += 1;
      });
    }
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] omitted single Fritz action: ${cases} cases ${JSON.stringify([...nextKinds])}`);
    expect(cases).toBeGreaterThan(scaled(40));
    expect([...nextKinds.keys()].some((k) => k.endsWith('->draw')), 'must include a player draw directly after the omitted Fritz action').toBe(true);
  }, 600_000);
});

// ───────────────────────────── Fritz determinism ─────────────────────────────

describe('Daily Fritz verifier: Fritz policy is a pure function of the authoritative state', () => {
  const hands = () => getCorpus().hands.slice(0, Math.min(getCorpus().hands.length, 80)).map((h) => playHand(h.spec, { captureStates: true }));

  it('the same state yields the same decision: repeated, deep-cloned, key-reordered and hand-permuted', async () => {
    const { chooseOfficialFritzDecisionForVersion } = await import('@racehorse/game-core');
    let decisions = 0;
    for (const hand of hands()) {
      for (const { cmdIndex, state } of hand.fritzStates) {
        const tier = hand.spec.tier;
        const base = chooseOfficialFritzDecisionForVersion({ version: 3, state, participantId: 'fritz', tier });
        const again = chooseOfficialFritzDecisionForVersion({ version: 3, state, participantId: 'fritz', tier });
        const cloned = chooseOfficialFritzDecisionForVersion({ version: 3, state: clone(state), participantId: 'fritz', tier });
        const reversedHand = { ...state, players: { ...state.players, fritz: { ...state.players.fritz, hand: [...state.players.fritz.hand].reverse() } } };
        const permuted = chooseOfficialFritzDecisionForVersion({ version: 3, state: reversedHand, participantId: 'fritz', tier });
        const tag = `${hand.spec.id} cmd ${cmdIndex}`;
        expect(again, `${tag}: repeat`).toEqual(base);
        expect(cloned, `${tag}: deep clone`).toEqual(base);
        expect(permuted, `${tag}: Fritz hand order must not change the decision`).toEqual(base);
        decisions += 1;
      }
    }
    expect(decisions).toBeGreaterThan(scaled(200));
  }, 600_000);

  it('verification touches neither Math.random nor any wall clock after initialization', () => {
    const transcripts = getCorpus().hands.map((h) => ({ h, t: runClientLeg(h).transcript }));
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random read during verification'); });
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now read during verification'); });
    const perfNow = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('performance.now read during verification'); });
    try {
      for (const { h, t } of transcripts) {
        const out = runVerifier(h.spec, t); // `now` is injected: the only clock the verifier may use is stamping verifiedAt
        if (!out.ok) throw new Error(`${h.spec.id}: ${out.code} ${out.message}`);
      }
    } finally {
      random.mockRestore();
      dateNow.mockRestore();
      perfNow.mockRestore();
    }
  }, 600_000);

  it('policy v1 (seeded ties) is deterministic too: same state, same decision, no ambient randomness', async () => {
    const { chooseOfficialFritzDecisionForVersion } = await import('@racehorse/game-core');
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random read by policy v1'); });
    try {
      let n = 0;
      for (const hand of hands()) {
        for (const { state } of hand.fritzStates) {
          const a = chooseOfficialFritzDecisionForVersion({ version: 1, state, participantId: 'fritz', tier: hand.spec.tier });
          const b = chooseOfficialFritzDecisionForVersion({ version: 1, state: clone(state), participantId: 'fritz', tier: hand.spec.tier });
          expect(b).toEqual(a);
          n += 1;
        }
      }
      expect(n).toBeGreaterThan(scaled(200));
    } finally {
      random.mockRestore();
    }
  }, 600_000);
});

// ───────────────────────────── versioning ─────────────────────────────

describe('Daily Fritz verifier: transcript format versioning never silently reinterprets an incompatible shape', () => {
  const sample = (): { hand: Played; honest: RawTranscript; terminalDigest: string } => {
    const hand = getCorpus().hands.find((h) => h.cmds.some((c) => c.actor === 'fritz' && c.kind === 'play') && h.cmds.length > 6)!;
    const { transcript, verified } = assertHonestHand(hand);
    return { hand, honest: asRaw(transcript), terminalDigest: getDailyFritzAuthorityStateDigest(verified.terminalState) };
  };

  const rejected: Array<[string, (t: RawTranscript) => RawTranscript]> = [
    ['newer protocol version (3)', (t) => ({ ...t, protocolVersion: 3 })],
    ['protocol version as a string', (t) => ({ ...t, protocolVersion: '2' })],
    ['missing protocol version', (t) => { const { protocolVersion: _p, ...rest } = t; void _p; return rest as RawTranscript; }],
    ['different rules version', (t) => ({ ...t, rulesVersion: 2 })],
    ['missing rules version', (t) => { const { rulesVersion: _r, ...rest } = t; void _r; return rest as RawTranscript; }],
    ['unsupported newer Fritz policy version (4)', (t) => ({ ...t, fritzPolicyVersion: 4, fritzPolicyContract: undefined })],
    ['Fritz policy version 0', (t) => ({ ...t, fritzPolicyVersion: 0, fritzPolicyContract: undefined })],
    ['policy contract that does not belong to its version', (t) => ({ ...t, fritzPolicyContract: 'fritz-policy-v1-seeded-top-score' })],
    ['unsupported newer state digest version (3)', (t) => ({ ...t, stateDigestVersion: 3 })],
    ['unknown top-level field from a newer client', (t) => ({ ...t, futureField: { a: 1 } })],
    ['unknown action kind from a newer client', (t) => ({ ...t, actions: t.actions.map((a, i) => (i === 0 ? { ...a, kind: 'discard' } : a)) })],
    ['play action without a tile', (t) => ({ ...t, actions: t.actions.map((a) => { if (a.kind !== 'play') return a; const { tile: _t, ...rest } = a; void _t; return rest; }) })],
    ['tile pip out of range', (t) => ({ ...t, actions: t.actions.map((a) => (a.kind === 'play' ? { ...a, tile: { low: 0, high: 7 } } : a)) })],
    ['unknown placement', (t) => ({ ...t, actions: t.actions.map((a) => (a.kind === 'play' ? { ...a, position: 'middle' } : a)) })],
    ['malformed branch placement', (t) => ({ ...t, actions: t.actions.map((a) => (a.kind === 'play' ? { ...a, position: 'branch-x-0' } : a)) })],
    ['empty action list', (t) => ({ ...t, actions: [] })],
    ['more than the maximum action count', (t) => ({ ...t, actions: Array.from({ length: 513 }, (_, i) => ({ sequence: i, actor: 'player', kind: 'pass' })) })],
    ['malformed digest string', (t) => ({ ...t, actions: t.actions.map((a) => (a.actor === 'fritz' ? { ...a, preStateDigest: 'not-a-digest' } : a)) })],
    ['transcript that is not an object', () => 'transcript' as unknown as RawTranscript],
  ];
  for (const [name, mutate] of rejected) {
    it(`rejects: ${name}`, () => {
      const { hand, honest } = sample();
      const out = runVerifier(hand.spec, mutate(clone(honest)));
      expect(out.ok, name).toBe(false);
      if (!out.ok) expect(['malformed_transcript', 'fritz_policy_contract_mismatch']).toContain(out.code);
    });
  }

  it('older, sparser transcripts still verify to the same result: no contract, no digest version, no client release, no digests', () => {
    const { hand, honest, terminalDigest } = sample();
    const sparse = stripDigests({ ...honest, fritzPolicyContract: undefined, stateDigestVersion: undefined, clientRelease: undefined });
    const out = runVerifier(hand.spec, JSON.parse(JSON.stringify(sparse)), { requireStateDigests: false });
    if (!out.ok) throw new Error(`${out.code} ${out.message}`);
    expect(getDailyFritzAuthorityStateDigest(out.terminalState)).toBe(terminalDigest);
  });

  it('a transcript with no digest contract is rejected when the attempt requires state digests (never silently trusted)', () => {
    const { hand, honest } = sample();
    const out = runVerifier(hand.spec, stripDigests(honest), { requireStateDigests: true });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('missing_fritz_state_digest');
  });

  it('an unpinned digest version is read as v1, so v2 digests do not silently pass as v1', () => {
    const { hand, honest } = sample();
    const out = runVerifier(hand.spec, JSON.parse(JSON.stringify({ ...honest, stateDigestVersion: undefined })), { requireStateDigests: false });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('fritz_state_mismatch');
  });

  it('protocol 1 relabel of a journal transcript still verifies to the identical result (legacy skip never alters a clean transcript)', () => {
    let cases = 0;
    for (const hand of getCorpus().hands) {
      const { transcript, verified } = assertHonestHand(hand);
      const out = runVerifier(hand.spec, { ...asRaw(transcript), protocolVersion: 1 });
      if (!out.ok) throw new Error(`${hand.spec.id}: protocol 1: ${out.code} ${out.message}`);
      expect(getDailyFritzAuthorityStateDigest(out.terminalState)).toBe(getDailyFritzAuthorityStateDigest(verified.terminalState));
      cases += 1;
    }
    expect(cases).toBeGreaterThan(scaled(10));
  }, 600_000);

  it('historical Fritz policy v1 and v2 transcripts (generated by those policy versions) still verify and are valid executions', () => {
    let v1 = 0;
    let v2 = 0;
    for (let n = 0; n < Math.min(60, HANDS); n += 1) {
      const spec = makeSpec(`${NS}:historical`, n);
      for (const version of [1, 2] as const) {
        const played = playHand(spec, { fritzDriver: 'production', fritzVersion: version, skipPolicyParity: true });
        const { transcript } = runClientLeg(played, version);
        expect(transcript.fritzPolicyVersion).toBe(version);
        const out = runVerifier(spec, transcript);
        if (!out.ok) throw new Error(`${spec.id} policy v${version}: historical transcript rejected: ${out.code} ${out.message}`);
        compareStates(`${spec.id}:v${version}`, out.terminalState, played.oracle, 28);
        const verdict = judge(spec, toJudge(transcript), 'lenient');
        expect(verdict.valid, `${spec.id} v${version} judge`).toBe(true);
        if (version === 1) v1 += 1; else v2 += 1;
      }
    }
    expect(v1 + v2).toBeGreaterThan(scaled(20));
  }, 600_000);

  it('a policy version the attempt was not pinned to is rejected (deployment-skew protection)', async () => {
    const { verifyDailyFritzHand } = await import('./dailyFritzVerifier');
    const { productionInitialState } = await import('../test/support/dailyFritzVerifierOracle');
    const { hand, honest } = sample();
    expect(() => verifyDailyFritzHand({
      transcript: { ...honest, fritzPolicyVersion: 2, fritzPolicyContract: undefined },
      initialState: productionInitialState(hand.spec),
      expectedChallengeId: hand.spec.challengeId, expectedAttemptId: hand.spec.attemptId, expectedGameNumber: hand.spec.gameNumber,
      expectedHandIndex: hand.spec.handIndex, userId: 'u', fritzTier: hand.spec.tier, expectedFritzPolicyVersion: 3, now: () => '2026-01-01T00:00:00.000Z',
    })).toThrow(/different Fritz policy/);
  });
});

// ───────────────────────────── ambiguity: Fritz ties ─────────────────────────────

describe('Daily Fritz verifier: a Fritz play must be the official selection (policy v3); ties cannot be chosen by the client', () => {
  type Fork = { hand: Played; tie: Played['ties'][number]; alt: { tile: { low: number; high: number }; position: string }; fork: Played; transcript: DailyFritzTranscript; material: boolean };
  const forks = (): Fork[] => {
    const out: Fork[] = [];
    for (const hand of getCorpus().hands) {
      for (const tie of hand.ties) {
        const material = new Set(tie.materialAlternatives.map((m) => `${okey(m.tile)}@${m.position}`));
        const alts = tie.topSet.filter((c) => !(okey(c.tile) === okey(tie.canonical.tile) && c.position === tie.canonical.position)).slice(0, 2);
        for (const alt of alts) {
          const fork = playHand(hand.spec, { fritzOverride: (ctx) => (ctx.cmdIndex === tie.cmdIndex ? alt : null) });
          out.push({ hand, tie, alt, fork, transcript: runClientLeg(fork).transcript, material: material.has(`${okey(alt.tile)}@${alt.position}`) });
        }
      }
    }
    return out;
  };

  it('every alternative top-score Fritz play (non-equivalent ties AND equivalent sibling arms) is rejected under v3', () => {
    const all = forks();
    let material = 0;
    let differentOutcome = 0;
    let differentWinner = 0;
    for (const f of all) {
      const out = runVerifier(f.hand.spec, f.transcript);
      expect(out.ok, `${f.hand.spec.id} @cmd ${f.tie.cmdIndex}: a non-canonical Fritz play ${JSON.stringify(f.alt)} (canonical ${JSON.stringify(f.tie.canonical)}) must not verify`).toBe(false);
      if (!out.ok) expect(out.code).toBe('fritz_action_mismatch');
      if (f.material) {
        material += 1;
        const canonical = expectedHandResult(f.hand.spec, f.hand.oracle);
        const forked = expectedHandResult(f.hand.spec, f.fork.oracle);
        if (canonical.playerAfter !== forked.playerAfter || canonical.fritzAfter !== forked.fritzAfter) differentOutcome += 1;
        if ((canonical.playerAfter > canonical.fritzAfter) !== (forked.playerAfter > forked.fritzAfter)) differentWinner += 1;
      }
    }
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] fritz tie forks: ${all.length} alternatives (${material} material), ${differentOutcome} with a different final score, ${differentWinner} with a different winner: all rejected under v3`);
    expect(material).toBeGreaterThan(scaled(10));
    expect(differentOutcome, 'the corpus must contain forks whose final score differs, i.e. the tie freedom was material').toBeGreaterThan(0);
  }, 600_000);

  it('the same alternatives remain acceptable as pinned historical v1/v2 evidence (their ties cannot be re-derived exactly)', () => {
    let accepted = 0;
    for (const f of forks().slice(0, 60)) {
      for (const version of [1, 2] as const) {
        const raw = { ...asRaw(f.transcript), fritzPolicyVersion: version, fritzPolicyContract: `fritz-policy-v${version}-${version === 1 ? 'seeded-top-score' : 'deterministic-canonical-ties'}` };
        const out = runVerifier(f.hand.spec, raw);
        if (!out.ok) throw new Error(`${f.hand.spec.id} v${version}: historical top-score alternative rejected: ${out.code} ${out.message}`);
        const verdict = judge(f.hand.spec, toJudge(parseDailyFritzTranscript(raw)), 'lenient');
        expect(verdict.valid).toBe(true);
        accepted += 1;
      }
    }
    expect(accepted).toBeGreaterThan(scaled(20));
  }, 600_000);

  it('an omitted Fritz action is only ever reconstructed as the official play, and an accepted result is exactly a valid execution', () => {
    let omitted = 0;
    let acceptedAsCanonical = 0;
    let differsFromClientBranch = 0;
    for (const f of forks()) {
      const raw = asRaw(f.transcript);
      const at = f.tie.cmdIndex;
      if (!(raw.actions[at]?.actor === 'fritz' && raw.actions[at - 1]?.actor !== 'fritz' && raw.actions[at + 1]?.actor === 'player')) continue;
      omitted += 1;
      const reduced = withActions(raw, raw.actions.filter((_, k) => k !== at));
      const out = runVerifier(f.hand.spec, reduced);
      if (!out.ok) continue; // fail closed
      // accepted => the independent judge (official Fritz recovered canonically) agrees it is a valid execution with the SAME result
      const verdict = judge(f.hand.spec, toJudge(parseDailyFritzTranscript(reduced)), 'canonical');
      expect(verdict.valid, `${f.hand.spec.id} @${at}: accepted a reduced transcript that is not a valid execution`).toBe(true);
      compareStates(`${f.hand.spec.id}:omitted-fork-vs-judge`, out.terminalState, (verdict as { oracle: ReturnType<typeof buildOracle> }).oracle, 28);
      acceptedAsCanonical += 1;
      try { compareStates(`${f.hand.spec.id}:omitted-fork`, out.terminalState, f.fork.oracle, 28); } catch { differsFromClientBranch += 1; }
    }
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] omitted non-canonical Fritz action: ${omitted} cases, ${acceptedAsCanonical} accepted as the canonical valid execution (${differsFromClientBranch} differ from the branch the client claimed to play: the client's branch is discarded, never credited)`);
    expect(omitted).toBeGreaterThan(scaled(5));
  }, 600_000);

  it('the real client Fritz policy picks exactly the independent oracle\'s canonical play at every decision', () => {
    let checked = 0;
    for (const hand of getCorpus().hands) { runClientLeg(hand); checked += hand.ties.length; }
    expect(checked).toBeGreaterThan(scaled(200));
  }, 600_000);
});

// ───────────────────────────── ambiguity: exhaustive draw-count search ─────────────────────────────

describe('Daily Fritz verifier: a reduced transcript maps to exactly one valid history', () => {
  it('for every reduced transcript (all draws omitted), enumerating every possible draw count before every action finds exactly one valid hand and one outcome', () => {
    let reduced = 0;
    let maxDraws = 0;
    for (const hand of getCorpus().hands) {
      const { transcript } = assertHonestHand(hand);
      const withoutDraws = toJudge(transcript).filter((a) => a.kind !== 'draw');
      maxDraws = Math.max(maxDraws, transcript.actions.length - withoutDraws.length);
      const { histories, outcomes } = countExplicitHistories(hand.spec, withoutDraws);
      expect({ id: hand.spec.id, histories, outcomes }, `${hand.spec.id}: the reduced transcript is ambiguous`).toEqual({ id: hand.spec.id, histories: 1, outcomes: 1 });
      reduced += 1;
    }
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] ambiguity search: ${reduced} reduced transcripts, every one maps to exactly 1 valid history (max ${maxDraws} omitted draws in one hand)`);
    expect(reduced).toBeGreaterThan(scaled(40));
  }, 600_000);

  it('the search has teeth: with an extra optional action allowed it WOULD find a second history (control)', () => {
    // Control: a reduced transcript from which a PLAY is also removed is not unique at all (the search must see >1 or 0, never silently 1).
    let sawNonUnique = false;
    for (const hand of getCorpus().hands.slice(0, 20)) {
      const { transcript } = assertHonestHand(hand);
      const actions = toJudge(transcript).filter((a) => a.kind !== 'draw');
      const cut = actions.findIndex((a) => a.kind === 'play' && a.actor === 'player');
      if (cut < 0) continue;
      const { histories } = countExplicitHistories(hand.spec, actions.filter((_, i) => i !== cut));
      if (histories !== 1) { sawNonUnique = true; break; }
    }
    expect(sawNonUnique).toBe(true);
  }, 600_000);
});

// ───────────────────────────── ownership / challenge binding ─────────────────────────────

describe('Daily Fritz verifier: the reconstruction is bound to the actual challenge, seed, attempt and configuration', () => {
  const buildRun = (spec: Spec, over: Record<string, unknown> = {}) => ({
    runDate: spec.runDate, seed: getDailyFritzSeed(spec.runDate), fritzTier: spec.tier, dealSize: spec.dealSize, winningScore: spec.winningScore,
    status: 'live', handDeals: [], generatedAt: '2026-01-01T00:00:00.000Z', invalidatedAt: null, metadata: null, ...over,
  }) as unknown as DailyFritzRunRecord;
  const buildAttempt = (spec: Spec, over: Record<string, unknown> = {}) => ({
    id: spec.attemptId, runDate: spec.runDate, userId: 'user-suite', status: 'started', currentHandIndex: 0, currentGameNumber: spec.gameNumber,
    revision: 1, challengeId: spec.challengeId, result: null, ...over,
  }) as unknown as DailyFritzAttemptRecord;
  const verify = (spec: Spec, transcript: unknown, run: DailyFritzRunRecord, attempt: DailyFritzAttemptRecord) => {
    try {
      return { ok: true as const, v: verifyAttemptHand({ transcript, attempt, run, userId: 'user-suite', gameNumber: spec.gameNumber, handIndex: 0, publishedChallenge: null }) };
    } catch (error) {
      if (error instanceof DailyFritzVerificationError) return { ok: false as const, code: error.code };
      throw error;
    }
  };
  const specs = (count: number): Spec[] => Array.from({ length: count }, (_, n) => ownerSpec(`${NS}:owner`, n));
  const otherDate = (spec: Spec): string => { const day = Number(spec.runDate.slice(8)); return `${spec.runDate.slice(0, 8)}${String(day === 28 ? 1 : day + 1).padStart(2, '0')}`; };

  it('an honest hand verifies through verifyAttemptHand and equals the oracle (the route path rebuilds everything from the run)', () => {
    for (const spec of specs(24)) {
      const played = playHand(spec);
      const { transcript } = runClientLeg(played);
      const out = verify(spec, transcript, buildRun(spec), buildAttempt(spec));
      if (!out.ok) throw new Error(`${spec.id}: ${out.code}`);
      compareStates(`${spec.id}:route-path`, out.v.terminalState, played.oracle, 28);
      expect(out.v.result.userId).toBe('user-suite');
      expect(out.v.result.attemptId).toBe(spec.attemptId);
      expect(out.v.result.challengeId).toBe(spec.challengeId);
    }
  }, 600_000);

  it('a valid transcript from challenge A is never accepted as challenge B', () => {
    let relabeledAccepted = 0;
    for (const spec of specs(24)) {
      const played = playHand(spec);
      const raw = asRaw(runClientLeg(played).transcript);
      const dateB = otherDate(spec);
      const specB: Spec = { ...spec, runDate: dateB, drawWinner: getDailyFritzDrawWinner(dateB, spec.gameNumber), challengeId: buildDailyFritzChallengeId(dateB) };
      // 1. as submitted: A's challenge id against B's run
      const asIs = verify(specB, raw, buildRun(specB), buildAttempt(specB, { id: spec.attemptId }));
      expect(asIs.ok, `${spec.id}: A's transcript accepted for B`).toBe(false);
      if (!asIs.ok) expect(asIs.code).toBe('challenge_mismatch');
      // 2. relabeled to B's identity: must replay validly on B's deal, so it is rejected unless the oracle agrees it is valid there
      const relabeled = { ...raw, challengeId: specB.challengeId };
      const out = verify(specB, relabeled, buildRun(specB), buildAttempt(specB, { id: spec.attemptId }));
      if (out.ok) {
        relabeledAccepted += 1;
        const verdict = judge(specB, toJudge(parseDailyFritzTranscript(relabeled)), 'canonical');
        expect(verdict.valid, `${spec.id}: relabeled transcript accepted for B but not a valid execution of B's deal`).toBe(true);
      }
    }
    // eslint-disable-next-line no-console
    console.info(`[df-verifier] challenge relabeling: ${relabeledAccepted} of 24 relabeled transcripts happened to be valid on the other day's deal (each confirmed by the oracle)`);
  }, 600_000);

  it('another attempt id, another run seed, another tier and another hand are all refused', () => {
    for (const spec of specs(12)) {
      const played = playHand(spec);
      const t = runClientLeg(played).transcript;
      const wrongAttempt = verify(spec, t, buildRun(spec), buildAttempt(spec, { id: `${spec.attemptId}:other` }));
      expect(wrongAttempt.ok).toBe(false);
      if (!wrongAttempt.ok) expect(wrongAttempt.code).toBe('attempt_mismatch');
      const wrongSeed = verify(spec, t, buildRun(spec, { seed: 'daily-fritz-1999-01-01' }), buildAttempt(spec));
      expect(wrongSeed.ok).toBe(false);
      if (!wrongSeed.ok) expect(wrongSeed.code).toBe('challenge_mismatch');
      const otherTier = (['rookie', 'standard', 'elite', 'master'] as const).find((x) => x !== spec.tier)!;
      const wrongTier = verify(spec, t, buildRun(spec, { fritzTier: otherTier }), buildAttempt(spec));
      // a different tier can only verify if Fritz would have made the very same decisions under it: confirm with the oracle
      if (wrongTier.ok) expect(judge({ ...spec, tier: otherTier }, toJudge(t), 'canonical').valid).toBe(true);
      const wrongHand = verify(spec, t, buildRun(spec), buildAttempt(spec));
      expect(wrongHand.ok).toBe(true);
      let wrongHandIndex: ReturnType<typeof verify>;
      try {
        wrongHandIndex = { ok: true, v: verifyAttemptHand({ transcript: t, attempt: buildAttempt(spec), run: buildRun(spec), userId: 'user-suite', gameNumber: spec.gameNumber, handIndex: 1, publishedChallenge: null }) };
      } catch (error) { wrongHandIndex = { ok: false, code: (error as { code?: string }).code ?? 'ERR' }; }
      expect(wrongHandIndex.ok, 'a hand-0 transcript must not verify as hand 1').toBe(false);
    }
  }, 600_000);

  it('a failed verification leaves the attempt object untouched (the verifier is pure)', () => {
    for (const spec of specs(10)) {
      const t = asRaw(runClientLeg(playHand(spec)).transcript);
      const attempt = buildAttempt(spec);
      const before = JSON.stringify(attempt);
      const tampered = withActions(t, t.actions.slice(0, -1));
      expect(verify(spec, tampered, buildRun(spec), attempt).ok).toBe(false);
      expect(JSON.stringify(attempt)).toBe(before);
    }
  });
});

export type { Spec };
void vi;
