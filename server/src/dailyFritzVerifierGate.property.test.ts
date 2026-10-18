/**
 * Independent integration-gate checks for the Daily Fritz verifier (written separately from the integrity suite, with its
 * own seed namespace). Same independent oracle, different questions:
 *
 *  1. TIE EXPLOIT: fork every Fritz decision that has other top-score legal plays; every fork must be rejected under v3, and
 *     the forks must be material (different final score, and where it occurs a different winner), i.e. the freedom was real.
 *  2. DOWNGRADE: the policy version comes from the attempt's server-written contract, never from the transcript.
 *  3. RECOVERY: whole omitted Fritz turns (any next player action), and an omitted terminal Fritz action.
 *
 *   DF_GATE_HANDS  hands per section (default 90)    DF_GATE_SEED  seed namespace (default "df-gate-20261017")
 */
import { describe, expect, it } from 'vitest';
import { getDailyFritzAuthorityStateDigest, parseDailyFritzTranscript, type DailyFritzTranscript } from '@racehorse/game-core';
import { compareStates } from '../../packages/game-core/src/__tests__/support/engineHarness';
import {
  expectedHandResult, judge, makeSpec, okey, ownerSpec, playHand, runClientLeg, runVerifier,
  type JudgeAction, type Played, type Spec,
} from '../test/support/dailyFritzVerifierOracle';
import { DailyFritzVerificationError } from './dailyFritzVerifier';
import { getDailyFritzSeed } from './dailyFritz';
import { verifyAttemptHand } from './http/routes/dailyFritzVerificationGlue';
import { buildDailyFritzAuthorityContract, writeDailyFritzAuthorityContract } from './http/routes/dailyFritzVerificationPolicy';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from './http/stores/dailyFritzStore';

const HANDS = Number(process.env.DF_GATE_HANDS ?? 90);
const NS = process.env.DF_GATE_SEED ?? 'df-gate-20261017';

type RawAction = Record<string, unknown>;
type RawTranscript = Record<string, unknown> & { actions: RawAction[] };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const asRaw = (t: DailyFritzTranscript): RawTranscript => clone(t) as unknown as RawTranscript;
const withActions = (t: RawTranscript, actions: RawAction[]): RawTranscript => ({ ...t, actions: actions.map((a, i) => ({ ...a, sequence: i })) });
const toJudge = (t: DailyFritzTranscript): JudgeAction[] => t.actions.map((a) => ({
  actor: a.actor, kind: a.kind, ...(a.kind === 'play' ? { tile: a.tile, position: a.position } : {}),
}));

const samePlay = (a: { tile: { low: number; high: number }; position: string }, b: { tile: { low: number; high: number }; position: string }) =>
  okey(a.tile) === okey(b.tile) && a.position === b.position;

type Fork = { spec: Spec; played: Played; cmdIndex: number; alt: { tile: { low: number; high: number }; position: string }; fork: Played; transcript: DailyFritzTranscript; material: boolean };

function forksFor(spec: Spec, limit = 3): Fork[] {
  const played = playHand(spec);
  const out: Fork[] = [];
  for (const tie of played.ties) {
    const material = new Set(tie.materialAlternatives.map((m) => `${okey(m.tile)}@${m.position}`));
    const alts = tie.topSet.filter((c) => !samePlay(c, tie.canonical)).slice(0, 2);
    for (const alt of alts) {
      if (out.length >= limit) return out;
      const fork = playHand(spec, { fritzOverride: (ctx) => (ctx.cmdIndex === tie.cmdIndex ? alt : null) });
      out.push({ spec, played, cmdIndex: tie.cmdIndex, alt, fork, transcript: runClientLeg(fork).transcript, material: material.has(`${okey(alt.tile)}@${alt.position}`) });
    }
  }
  return out;
}

// ───────────────────────────── 1. the tie exploit ─────────────────────────────

describe('gate: a client cannot choose among tied Fritz plays (policy v3)', () => {
  it('every non-canonical tied Fritz play is rejected, and the freedom it would have given was material', () => {
    let forks = 0;
    let material = 0;
    let differentScore = 0;
    let differentHandWinner = 0;
    let decisionsWithTies = 0;
    const examples: string[] = [];
    for (let n = 0; n < HANDS; n += 1) {
      const spec = makeSpec(`${NS}:tie`, n);
      const played = playHand(spec, { skipPolicyParity: true });
      decisionsWithTies += played.ties.filter((t) => t.topSet.length > 1).length;
      for (const f of forksFor(spec, 2)) {
        forks += 1;
        const out = runVerifier(spec, f.transcript);
        expect(out.ok, `${spec.id} @cmd ${f.cmdIndex}: non-canonical Fritz play ${JSON.stringify(f.alt)} must not verify`).toBe(false);
        if (!out.ok) expect(out.code).toBe('fritz_action_mismatch');
        if (!f.material) continue;
        material += 1;
        const a = expectedHandResult(spec, f.played.oracle);
        const b = expectedHandResult(spec, f.fork.oracle);
        if (a.playerAfter !== b.playerAfter || a.fritzAfter !== b.fritzAfter) {
          differentScore += 1;
          if (examples.length < 3) examples.push(`${spec.id}@${f.cmdIndex}: canonical ${a.playerAfter}-${a.fritzAfter} vs fork ${b.playerAfter}-${b.fritzAfter}`);
        }
        if ((a.playerAfter > a.fritzAfter) !== (b.playerAfter > b.fritzAfter)) differentHandWinner += 1;
      }
    }
    process.stdout.write(`[df-gate] tie forks: hands=${HANDS} tiedDecisions=${decisionsWithTies} forks=${forks} material=${material} differentFinalScore=${differentScore} differentHandWinner=${differentHandWinner} e.g. ${examples.join(' | ')}\n`);
    expect(forks).toBeGreaterThan(20);
    expect(material).toBeGreaterThan(5);
    expect(differentScore, 'the tie freedom must have been able to change the score').toBeGreaterThan(0);
  }, 900_000);
});

// ───────────────────────────── 2. policy downgrade ─────────────────────────────

describe('gate: the Fritz policy version comes from the attempt, never from the transcript', () => {
  const run = (spec: Spec) => ({
    runDate: spec.runDate, seed: getDailyFritzSeed(spec.runDate), fritzTier: spec.tier, dealSize: spec.dealSize, winningScore: spec.winningScore,
    status: 'live', handDeals: [], generatedAt: '2026-01-01T00:00:00.000Z', invalidatedAt: null, metadata: null,
  }) as unknown as DailyFritzRunRecord;
  const attempt = (spec: Spec, pinned: 1 | 2 | 3 | null) => ({
    id: spec.attemptId, runDate: spec.runDate, userId: 'user-suite', status: 'started', currentHandIndex: 0, currentGameNumber: spec.gameNumber,
    revision: 1, challengeId: spec.challengeId,
    result: pinned === null ? null : writeDailyFritzAuthorityContract(null, buildDailyFritzAuthorityContract({
      fritzPolicyVersion: pinned, challengeId: spec.challengeId, runFingerprint: 'gate-fingerprint', stateDigestRequired: false,
    })),
  }) as unknown as DailyFritzAttemptRecord;
  const verify = (spec: Spec, transcript: unknown, pinned: 1 | 2 | 3 | null) => {
    try {
      return { ok: true as const, v: verifyAttemptHand({ transcript, attempt: attempt(spec, pinned), run: run(spec), userId: 'user-suite', gameNumber: spec.gameNumber, handIndex: 0, publishedChallenge: null }) };
    } catch (error) {
      if (error instanceof DailyFritzVerificationError) return { ok: false as const, code: error.code };
      throw error;
    }
  };
  const relabel = (t: RawTranscript, version: 1 | 2): RawTranscript => ({
    ...t, fritzPolicyVersion: version,
    fritzPolicyContract: version === 1 ? 'fritz-policy-v1-seeded-top-score' : 'fritz-policy-v2-deterministic-canonical-ties',
  });
  const stripDigest = (t: RawTranscript): RawTranscript => ({ ...t, actions: t.actions.map(({ preStateDigest: _d, ...rest }) => { void _d; return rest; }) });

  it('a tied non-canonical play on a v3-pinned attempt is rejected however the transcript labels its policy', () => {
    let checked = 0;
    for (let n = 0; n < HANDS && checked < 24; n += 1) {
      const spec = ownerSpec(`${NS}:owner`, n);
      for (const f of forksFor(spec, 1)) {
        const raw = stripDigest(asRaw(f.transcript));
        const asV3 = verify(spec, raw, 3);
        expect(asV3.ok, `${spec.id}: honest v3 label`).toBe(false);
        if (!asV3.ok) expect(asV3.code).toBe('fritz_action_mismatch');
        for (const version of [1, 2] as const) {
          const downgraded = verify(spec, relabel(raw, version), 3);
          expect(downgraded.ok, `${spec.id}: relabeled to v${version} to regain tie freedom`).toBe(false);
          if (!downgraded.ok) expect(downgraded.code).toBe('fritz_policy_version_mismatch');
        }
        // a transcript that omits its policy fields entirely cannot fall back to an older rule either
        const { fritzPolicyVersion: _v, fritzPolicyContract: _c, ...bare } = raw;
        void _v; void _c;
        const missing = verify(spec, bare, 3);
        expect(missing.ok, `${spec.id}: no policy fields`).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  }, 900_000);

  it('an attempt pinned to v1/v2 (started before v3) can no longer earn verified results, even with matching historical evidence', () => {
    let refused = 0;
    for (let n = 0; n < HANDS && refused < 12; n += 1) {
      const spec = ownerSpec(`${NS}:owner-hist`, n);
      for (const f of forksFor(spec, 1)) {
        for (const version of [1, 2] as const) {
          const out = verify(spec, stripDigest(relabel(asRaw(f.transcript), version)), version);
          expect(out.ok, `${spec.id} v${version}: a retired-policy attempt must not verify new evidence`).toBe(false);
          if (!out.ok) expect(out.code).toBe('fritz_policy_version_mismatch');
          // the pure verifier keeps the historical rule for already-recorded evidence
          expect(runVerifier(spec, relabel(asRaw(f.transcript), version)).ok, `${spec.id} v${version}: historical evidence`).toBe(true);
          refused += 1;
        }
      }
    }
    expect(refused).toBeGreaterThan(5);
  }, 900_000);

  it('the cross-version pin holds in every direction: a v1/v2-pinned attempt does not accept v3 evidence either', () => {
    const spec = ownerSpec(`${NS}:owner-cross`, 0);
    const honest = stripDigestSafe(asRaw(runClientLeg(playHand(spec)).transcript));
    for (const pinned of [1, 2] as const) {
      const out = verify(spec, honest, pinned);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe('fritz_policy_version_mismatch');
    }
    function stripDigestSafe(t: RawTranscript): RawTranscript { return stripDigest(t); }
  });
});

// ───────────────────────────── 3. omitted-action recovery ─────────────────────────────

describe('gate: omitted Fritz action recovery reconstructs exactly the official turn and nothing else', () => {
  type Run = { start: number; end: number };
  const fritzRuns = (t: RawTranscript): Run[] => {
    const runs: Run[] = [];
    let i = 0;
    while (i < t.actions.length) {
      if (t.actions[i]!.actor !== 'fritz') { i += 1; continue; }
      let j = i;
      while (j < t.actions.length && t.actions[j]!.actor === 'fritz') j += 1;
      runs.push({ start: i, end: j });
      i = j;
    }
    return runs;
  };

  it('omitting a whole Fritz turn (draws and the final play/pass) before any player action verifies to the identical terminal state', () => {
    const seen = new Map<string, number>();
    let cases = 0;
    for (let n = 0; n < HANDS; n += 1) {
      const spec = makeSpec(`${NS}:recover`, n);
      const played = playHand(spec);
      const { transcript } = { transcript: runClientLeg(played).transcript };
      const honest = asRaw(transcript);
      const honestOut = runVerifier(spec, honest);
      if (!honestOut.ok) throw new Error(`${spec.id}: honest rejected ${honestOut.code}`);
      const honestDigest = getDailyFritzAuthorityStateDigest(honestOut.terminalState);
      for (const { start, end } of fritzRuns(honest)) {
        const next = honest.actions[end];
        if (!next) continue; // terminal Fritz turn: covered below
        const reduced = withActions(honest, [...honest.actions.slice(0, start), ...honest.actions.slice(end)]);
        const out = runVerifier(spec, reduced);
        const kinds = honest.actions.slice(start, end).map((a) => String(a.kind)).join('+');
        const label = `${spec.id} omit fritz[${kinds}] -> player ${String(next.kind)}`;
        // Independent judge decides whether this reduced transcript is a valid execution of the contract.
        const verdict = judge(spec, toJudge(parseDailyFritzTranscript(reduced)), 'canonical');
        expect(out.ok, `${label}: verifier vs judge (${verdict.valid ? 'valid' : (verdict as { reason: string }).reason})`).toBe(verdict.valid);
        if (!out.ok) continue;
        expect(getDailyFritzAuthorityStateDigest(out.terminalState), label).toBe(honestDigest);
        compareStates(`${label}:vs-oracle`, out.terminalState, played.oracle, 28);
        const key = `${kinds.endsWith('play') ? 'play' : kinds.endsWith('pass') ? 'pass' : 'draw'}${kinds.includes('draw') && !kinds.startsWith('draw') ? '' : kinds.startsWith('draw') ? '(draws first)' : ''}->${String(next.kind)}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        cases += 1;
      }
    }
    process.stdout.write(`[df-gate] omitted whole Fritz turn: ${cases} accepted-identical cases ${JSON.stringify([...seen])}\n`);
    expect(cases).toBeGreaterThan(40);
    const keys = [...seen.keys()];
    expect(keys.some((k) => k.startsWith('play') && k.endsWith('->play')), 'omitted Fritz play -> human play').toBe(true);
    expect(keys.some((k) => k.startsWith('play') && k.endsWith('->draw')), 'omitted Fritz play -> human draw (the repaired case)').toBe(true);
  }, 900_000);

  it('an omitted Fritz play before a human draw verifies, and the same hand with the human draw omitted too still verifies identically', () => {
    let both = 0;
    for (let n = 0; n < HANDS * 3 && both < 6; n += 1) {
      const spec = makeSpec(`${NS}:recover-draw`, n);
      const played = playHand(spec);
      const honest = asRaw(runClientLeg(played).transcript);
      const honestOut = runVerifier(spec, honest);
      if (!honestOut.ok) throw new Error(`${spec.id}: honest rejected`);
      for (let i = 1; i < honest.actions.length - 1; i += 1) {
        const a = honest.actions[i]!;
        const next = honest.actions[i + 1]!;
        if (!(a.actor === 'fritz' && a.kind === 'play' && honest.actions[i - 1]!.actor !== 'fritz' && next.actor === 'player' && next.kind === 'draw')) continue;
        // (a) omit only the Fritz play
        const out1 = runVerifier(spec, withActions(honest, honest.actions.filter((_, k) => k !== i)));
        expect(out1.ok, `${spec.id}@${i}: omitted Fritz play then human draw`).toBe(true);
        // (b) additionally omit the human's explicit draw run (mandatory draws are reconstructed)
        const drawEnd = honest.actions.findIndex((x, k) => k > i && !(x.actor === 'player' && x.kind === 'draw'));
        const out2 = runVerifier(spec, withActions(honest, honest.actions.filter((_, k) => k !== i && !(k > i && k < drawEnd))));
        expect(out2.ok, `${spec.id}@${i}: omitted Fritz play and the human draw run`).toBe(true);
        if (out1.ok && out2.ok) {
          expect(getDailyFritzAuthorityStateDigest(out1.terminalState)).toBe(getDailyFritzAuthorityStateDigest(honestOut.terminalState));
          expect(getDailyFritzAuthorityStateDigest(out2.terminalState)).toBe(getDailyFritzAuthorityStateDigest(honestOut.terminalState));
        }
        both += 1;
        break;
      }
    }
    expect(both).toBeGreaterThan(2);
  }, 900_000);

  it('an omitted Fritz turn before a legal human PASS: a single official turn verifies identically; more than one is refused (judge agrees)', () => {
    let accepted = 0;
    let refused = 0;
    const where: string[] = [];
    for (let n = 0; n < 1500 && accepted < 4; n += 1) {
      const spec = makeSpec(`${NS}:recover-pass`, n);
      const played = playHand(spec, { skipPolicyParity: true });
      const honest = asRaw(runClientLeg(played).transcript);
      for (const { start, end } of fritzRuns(honest)) {
        const next = honest.actions[end];
        if (!next || next.actor !== 'player' || next.kind !== 'pass') continue;
        const reduced = withActions(honest, [...honest.actions.slice(0, start), ...honest.actions.slice(end)]);
        const out = runVerifier(spec, reduced);
        const verdict = judge(spec, toJudge(parseDailyFritzTranscript(reduced)), 'canonical');
        // A run of several Fritz plays means the human passed in between: omitting all of them is more than the contract's
        // one omitted turn, and both the verifier and the judge must refuse it.
        expect(out.ok, `${spec.id}: verifier vs judge (${verdict.valid ? 'valid' : (verdict as { reason: string }).reason})`).toBe(verdict.valid);
        if (out.ok) {
          compareStates(`${spec.id}:omitted->pass`, out.terminalState, played.oracle, 28);
          accepted += 1;
          where.push(spec.id);
        } else {
          expect(out.code).not.toBe('CRASH');
          refused += 1;
        }
        break;
      }
    }
    process.stdout.write(`[df-gate] omitted Fritz turn -> human pass: ${accepted} accepted-identical (${where.join(',')}), ${refused} refused as multi-turn\n`);
    expect(accepted, 'no generated hand reached a human pass directly after a single Fritz turn').toBeGreaterThan(0);
  }, 900_000);

  it('an omitted TERMINAL Fritz action is never reconstructed: the hand is incomplete and the transcript is rejected', () => {
    let tried = 0;
    for (let n = 0; n < HANDS * 3 && tried < 12; n += 1) {
      const spec = makeSpec(`${NS}:terminal`, n);
      const honest = asRaw(runClientLeg(playHand(spec)).transcript);
      const runs = fritzRuns(honest);
      const last = runs[runs.length - 1];
      if (!last || last.end !== honest.actions.length) continue; // the hand did not end on a Fritz action
      for (const cut of [last.start, honest.actions.length - 1]) {
        const reduced = withActions(honest, honest.actions.slice(0, cut));
        if (reduced.actions.length === 0) continue;
        const out = runVerifier(spec, reduced);
        expect(out.ok, `${spec.id}: transcript missing its terminal Fritz action (cut at ${cut}) must not verify`).toBe(false);
        if (!out.ok) expect(out.code).not.toBe('CRASH');
        tried += 1;
      }
    }
    expect(tried).toBeGreaterThan(4);
  }, 900_000);

  it('recovery never skips a human obligation: removing a human action next to an omitted Fritz turn is still rejected', () => {
    let tried = 0;
    for (let n = 0; n < HANDS && tried < 30; n += 1) {
      const spec = makeSpec(`${NS}:skip`, n);
      const honest = asRaw(runClientLeg(playHand(spec)).transcript);
      for (let i = 1; i < honest.actions.length - 1; i += 1) {
        const a = honest.actions[i]!;
        if (!(a.actor === 'player' && (a.kind === 'play' || a.kind === 'pass') && honest.actions[i - 1]!.actor === 'fritz')) continue;
        // drop the Fritz run before AND the human action itself
        let s = i - 1;
        while (s > 0 && honest.actions[s - 1]!.actor === 'fritz') s -= 1;
        const reduced = withActions(honest, [...honest.actions.slice(0, s), ...honest.actions.slice(i + 1)]);
        const verdict = judge(spec, toJudge(parseDailyFritzTranscript(reduced)), 'canonical');
        const out = runVerifier(spec, reduced);
        expect(out.ok, `${spec.id}@${i}: ${verdict.valid ? 'judge says valid' : (verdict as { reason: string }).reason}`).toBe(verdict.valid);
        if (!out.ok) expect(out.code).not.toBe('CRASH');
        tried += 1;
        break;
      }
    }
    expect(tried).toBeGreaterThan(10);
  }, 900_000);
});
