/**
 * Independent harness for the Daily Fritz verifier integrity suite.
 *
 * What is independent of the code under test
 *  - RULES: `OGame` / `OBoard` (packages/game-core/src/__tests__/support/engineOracle.ts) share no code with engine.ts / scoring.ts.
 *  - FRITZ POLICY: `fritzChoices` below re-implements the documented official score
 *      score = immediate*100000 + mobility*(8+tierWeight)*1000 + doubleSupport*4000 + unload*1000 + openEndsSum
 *    on the oracle's board, with the documented tie-break (UTF-16 code-unit order of `low|high@position`) and the symmetric
 *    empty-arm collapse. It never calls fritzPolicy.ts; production is only compared against it.
 *  - JUDGE: `judge` decides, from the rules alone, whether a transcript is a valid execution under the verifier CONTRACT
 *    (explicit commands, plus the two documented reconstructions: omitted mandatory draws and one omitted official Fritz turn).
 *
 * What is the real production path
 *  - the client leg replays the commands through the REAL client engine + journal + `buildDailyFritzTranscript`;
 *  - the server leg is the REAL `verifyDailyFritzHand` / `verifyAttemptHand`.
 *
 * Every generated hand is reproducible from its `Spec.id` (`<namespace>:<n>`).
 */
import {
  DEFAULT_CONFIG,
  FRITZ_POLICY_VERSION,
  applyGameCommand,
  chooseOfficialFritzDecisionForVersion,
  createDeterministicRandom,
  getDailyFritzAuthorityStateDigest,
  type DailyFritzTranscript,
  type FritzPolicyVersion,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand, getDailyFritzDrawWinner, type DailyFritzDrawWinner, type DailyFritzHandDeal, type DailyFritzTier } from '../../src/dailyFritz';
import { buildDailyFritzChallengeId } from '../../src/dailyFritzIdentity';
import {
  DailyFritzVerificationError,
  createOfficialDailyFritzHandState,
  verifyDailyFritzHand,
} from '../../src/dailyFritzVerifier';
import { OBoard, OGame, canon, oIsDouble, okey, opips, type OAction, type OConfig, type OEvent, type OTile } from '../../../packages/game-core/src/__tests__/support/engineOracle';
import { chooseAction, type Policy } from '../../../packages/game-core/src/__tests__/support/engineHarness';
import { applyPlayMove, createFixedBotHand, drawOne, passTurn, type BotMatchState } from '../../../client/src/modules/match/runtime/botEngine.ts';
import { buildDailyFritzTranscript } from '../../../client/src/dailyFritz/dailyFritzTranscript.ts';
import { chooseOfficialFritzBotChoice } from '../../../client/src/modules/match/runtime/gameCoreAdapter.ts';

export type Actor = 'player' | 'fritz';
export type Cmd = { actor: Actor; kind: 'play' | 'draw' | 'pass'; tile?: OTile; position?: string };
export type PlayChoice = { tile: OTile; position: string };

export const CHALLENGE_PREFIX = 'daily-fritz:verifier-suite';

export type Spec = {
  id: string;
  runDate: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  dealSize: 7 | 14;
  tier: DailyFritzTier;
  drawWinner: DailyFritzDrawWinner;
  winningScore: number;
  start: { player: number; fritz: number };
  human: Policy;
  challengeId: string;
  attemptId: string;
};

const TIERS: DailyFritzTier[] = ['rookie', 'standard', 'elite', 'master'];
const HUMANS: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch', 'lowScore'];

export function makeSpec(namespace: string, n: number): Spec {
  const id = `${namespace}:${n}`;
  const rnd = createDeterministicRandom(id);
  const month = String(1 + rnd.nextInt(12)).padStart(2, '0');
  const day = String(1 + rnd.nextInt(28)).padStart(2, '0');
  const winningScore = [25, 60, 100][rnd.nextInt(3)]!;
  const nearEnd = rnd.nextInt(10) < 3;
  const startScore = () => (nearEnd ? Math.max(0, winningScore - 1 - rnd.nextInt(15)) : rnd.nextInt(winningScore));
  return {
    id,
    runDate: `2026-${month}-${day}`,
    gameNumber: (1 + rnd.nextInt(3)) as 1 | 2 | 3,
    handIndex: rnd.nextInt(10),
    dealSize: rnd.nextInt(6) === 0 ? 14 : 7,
    tier: TIERS[rnd.nextInt(4)]!,
    drawWinner: rnd.nextInt(2) === 0 ? 'you' : 'fritz',
    winningScore,
    start: { player: startScore(), fritz: startScore() },
    human: HUMANS[rnd.nextInt(HUMANS.length)]!,
    challengeId: `${CHALLENGE_PREFIX}:${id}`,
    attemptId: `attempt:${id}`,
  };
}

/**
 * A first-hand spec bound to the real server identity rules (challenge id derived from the date, draw winner derived from
 * the date + game), so it can be sent through `verifyAttemptHand` / the routes, which rebuild everything from the run.
 */
export function ownerSpec(namespace: string, n: number): Spec {
  const base = makeSpec(namespace, n);
  return {
    ...base,
    handIndex: 0,
    start: { player: 0, fritz: 0 },
    winningScore: 100, // a single hand cannot end the game, so the hand advances through next-hand
    drawWinner: getDailyFritzDrawWinner(base.runDate, base.gameNumber),
    challengeId: buildDailyFritzChallengeId(base.runDate),
  };
}

export const dealFor = (spec: Spec): DailyFritzHandDeal =>
  generateSingleDailyFritzGameHand(spec.runDate, spec.gameNumber, spec.handIndex, spec.dealSize);

export function productionInitialState(spec: Spec, deal: DailyFritzHandDeal = dealFor(spec)): GameState {
  return createOfficialDailyFritzHandState({
    deal,
    handIndex: spec.handIndex,
    drawWinner: spec.drawWinner,
    winningScore: spec.winningScore,
    dealSize: spec.dealSize,
    playerScore: spec.start.player,
    fritzScore: spec.start.fritz,
  });
}

export function oracleConfig(spec: Spec, deal: DailyFritzHandDeal): OConfig {
  return {
    maxPips: 6,
    tilesPerPlayer: spec.dealSize,
    deadTileCount: spec.dealSize === 14 ? 0 : deal.locked.length,
    scoringMultiple: DEFAULT_CONFIG.scoringMultiple,
    blockedHandRule: DEFAULT_CONFIG.blockedHandRule,
    endHandBonus: DEFAULT_CONFIG.endHandBonus,
    winningScore: spec.winningScore,
  };
}

/** The oracle's own opening position for a hand, derived from the documented deal + starter rules. */
export function buildOracle(spec: Spec, deal: DailyFritzHandDeal = dealFor(spec)): OGame {
  const o = new OGame(['player', 'fritz'], oracleConfig(spec, deal));
  o.scores.set('player', spec.start.player);
  o.scores.set('fritz', spec.start.fritz);
  const matchStarter: Actor = spec.drawWinner === 'you' ? 'player' : 'fritz';
  const starter: Actor = spec.handIndex % 2 === 0 ? matchStarter : matchStarter === 'player' ? 'fritz' : 'player';
  o.handNumber = spec.handIndex; // dealHand increments: production numbers hands handIndex + 1
  o.dealHand([...deal.player_tiles, ...deal.fritz_tiles, ...deal.boneyard], starter);
  return o;
}

// ───────────────────────── independent Fritz policy ─────────────────────────

export const codeUnitCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const moveKey = (p: PlayChoice): string => `${Math.min(p.tile.low, p.tile.high)}|${Math.max(p.tile.low, p.tile.high)}@${p.position}`;
const sameChoice = (a: PlayChoice, b: PlayChoice): boolean => okey(a.tile) === okey(b.tile) && a.position === b.position;

function scoreChoice(o: OGame, p: PlayChoice, tier: DailyFritzTier): number {
  const board = o.handOpen ? o.board.clone() : OBoard.empty();
  board.place(p.tile, p.position);
  const immediate = board.score(o.cfg.scoringMultiple);
  const ends = new Set(board.ports().map((port) => port.pip));
  const hand = o.hands.get('fritz')!;
  const at = hand.findIndex((t) => okey(t) === okey(p.tile));
  const remaining = hand.filter((_, i) => i !== at);
  const mobility = remaining.filter((t) => ends.has(t.low) || ends.has(t.high)).length;
  const unload = p.tile.low + p.tile.high;
  const doubleSupport = oIsDouble(p.tile) ? remaining.filter((t) => t.low === p.tile.low || t.high === p.tile.high).length : 0;
  const tierWeight = tier === 'master' ? 4 : tier === 'elite' ? 3 : tier === 'standard' ? 2 : 1;
  return immediate * 100_000 + mobility * (8 + tierWeight) * 1_000 + doubleSupport * 4_000 + unload * 1_000 + board.openEndsSum();
}

function armEmpty(o: OGame, position: string): boolean {
  const m = /^branch-(\d+)-([01])$/.exec(position);
  return m ? o.board.armTip(Number(m[1]), Number(m[2])) === null : false;
}

/** Same tile, same position, or the two empty sibling arms of one hub: the same strategic play. */
export function equivalentPlays(o: OGame, a: PlayChoice, b: PlayChoice): boolean {
  if (okey(a.tile) !== okey(b.tile)) return false;
  if (a.position === b.position) return true;
  const ma = /^branch-(\d+)-([01])$/.exec(a.position);
  const mb = /^branch-(\d+)-([01])$/.exec(b.position);
  return Boolean(ma && mb && ma[1] === mb[1] && armEmpty(o, a.position) && armEmpty(o, b.position));
}

export type FritzChoices =
  | { kind: 'play'; canonical: PlayChoice; topSet: PlayChoice[]; materialAlternatives: PlayChoice[] }
  | { kind: 'draw' }
  | { kind: 'pass' };

export function fritzChoices(o: OGame, tier: DailyFritzTier): FritzChoices {
  const plays: PlayChoice[] = o.plays('fritz').map((p) => ({ tile: canon(p.tile), position: p.position }));
  if (plays.length === 0) return o.canDraw('fritz') ? { kind: 'draw' } : { kind: 'pass' };
  // top-score set over ALL legal plays (what the verifier is documented to accept for a recorded Fritz play)
  const scored = plays.map((p) => ({ p, s: scoreChoice(o, p, tier) }));
  const top = Math.max(...scored.map((e) => e.s));
  const topSet = scored.filter((e) => e.s === top).map((e) => e.p);
  // canonical selection (policy v2/v3): collapse symmetric empty arms to the lower arm, then best score, then code-unit key
  const collapsed = new Map<string, PlayChoice>();
  for (const p of plays) {
    const m = /^branch-(\d+)-([01])$/.exec(p.position);
    if (!m || !armEmpty(o, p.position)) { collapsed.set(`unique:${moveKey(p)}`, p); continue; }
    const key = `empty-branch:${m[1]}:${okey(p.tile)}`;
    const existing = collapsed.get(key);
    if (!existing || Number(m[2]) < Number(/-(\d)$/.exec(existing.position)![1])) collapsed.set(key, p);
  }
  const ranked = [...collapsed.values()]
    .map((p) => ({ p, s: scoreChoice(o, p, tier) }))
    .sort((l, r) => r.s - l.s || codeUnitCompare(moveKey(l.p), moveKey(r.p)));
  const canonical = ranked[0]!.p;
  return { kind: 'play', canonical, topSet, materialAlternatives: topSet.filter((p) => !equivalentPlays(o, p, canonical)) };
}

// ───────────────────────────── generated play ─────────────────────────────

export type Cov = Record<
  | 'oneDrawThenPlay' | 'longDrawChain' | 'drawToExhaustionThenPass' | 'multiDrawChain' | 'lockedTilesAtPass' | 'fritzDraw' | 'humanDraw'
  | 'blockedAfterDrawChain' | 'drawThenScoringPlay' | 'finalDrawableTileDrawn' | 'emptyDrawableAction' | 'chainInsidePlay' | 'embeddedPass'
  | 'gameEnding' | 'blockedHand' | 'outHand' | 'branchPlay' | 'doublePlay' | 'scoringPlay' | 'fritzPass' | 'humanPass' | 'tiedTopScore' | 'materialTie',
  number
>;
export const newCov = (): Cov => ({
  oneDrawThenPlay: 0, longDrawChain: 0, drawToExhaustionThenPass: 0, multiDrawChain: 0, lockedTilesAtPass: 0, fritzDraw: 0, humanDraw: 0,
  blockedAfterDrawChain: 0, drawThenScoringPlay: 0, finalDrawableTileDrawn: 0, emptyDrawableAction: 0, chainInsidePlay: 0, embeddedPass: 0,
  gameEnding: 0, blockedHand: 0, outHand: 0, branchPlay: 0, doublePlay: 0, scoringPlay: 0, fritzPass: 0, humanPass: 0, tiedTopScore: 0, materialTie: 0,
});
export function addCov(into: Cov, from: Cov): void {
  for (const key of Object.keys(from) as Array<keyof Cov>) into[key] += from[key];
}

export type TieInfo = { cmdIndex: number; canonical: PlayChoice; topSet: PlayChoice[]; materialAlternatives: PlayChoice[] };

export type Played = {
  spec: Spec;
  deal: DailyFritzHandDeal;
  cmds: Cmd[];
  oracle: OGame;
  /** Production engine driven in lockstep by explicit commands (independent of every verifier reconstruction). */
  engine: GameState;
  /** Authority digest of the production engine state before each Fritz command (what an honest client records). */
  fritzDigests: Map<number, string>;
  events: OEvent[];
  ties: TieInfo[];
  cov: Cov;
  handEnd: 'out' | 'blocked';
  policyChecks: number;
  /** Production engine state immediately before each Fritz decision (only with `captureStates`). */
  fritzStates: Array<{ cmdIndex: number; state: GameState }>;
};

export type FritzOverride = (ctx: { cmdIndex: number; canonical: PlayChoice; topSet: PlayChoice[]; materialAlternatives: PlayChoice[] }) => PlayChoice | null;

export function playHand(
  spec: Spec,
  opts: {
    fritzOverride?: FritzOverride;
    fritzVersion?: FritzPolicyVersion;
    skipPolicyParity?: boolean;
    captureStates?: boolean;
    /** 'production': Fritz acts as the pinned production policy version decides (historical-transcript generation); the oracle only checks the rules. */
    fritzDriver?: 'oracle' | 'production';
  } = {},
): Played {
  const deal = dealFor(spec);
  const o = buildOracle(spec, deal);
  let engine = productionInitialState(spec, deal);
  const rnd = createDeterministicRandom(`${spec.id}:human`);
  const cmds: Cmd[] = [];
  const events: OEvent[] = [];
  const ties: TieInfo[] = [];
  const cov = newCov();
  const fritzDigests = new Map<number, string>();
  const fritzStates: Array<{ cmdIndex: number; state: GameState }> = [];
  let policyChecks = 0;
  let handEnd: 'out' | 'blocked' = 'blocked';
  let streak = { actor: '' as string, draws: 0, scoredAfter: false };

  const flushStreak = (next: Cmd | null, ev: OEvent | null, drawableBefore: number) => {
    // classify a finished run of explicit draws by one actor
    if (streak.draws === 0) return;
    if (next?.kind === 'play') {
      if (streak.draws === 1) cov.oneDrawThenPlay += 1;
      if (streak.draws >= 3) cov.longDrawChain += 1;
      if (streak.draws >= 2) cov.multiDrawChain += 1;
      if ((ev?.playScore ?? 0) > 0) cov.drawThenScoringPlay += 1;
    }
    if (next?.kind === 'pass') {
      cov.drawToExhaustionThenPass += 1;
      if (streak.draws >= 2) cov.multiDrawChain += 1;
    }
    void drawableBefore;
  };

  for (let guard = 0; guard < 4000 && !o.handOver; guard += 1) {
    const actor = o.actor as Actor;
    let action: OAction;
    let tie: TieInfo | null = null;
    if (actor === 'player') {
      action = chooseAction(o, spec.human, rnd);
    } else {
      const ch = fritzChoices(o, spec.tier);
      if (opts.captureStates) fritzStates.push({ cmdIndex: cmds.length, state: engine });
      if (opts.fritzDriver === 'production') {
        const prod = chooseOfficialFritzDecisionForVersion({ version: opts.fritzVersion ?? FRITZ_POLICY_VERSION, state: engine, participantId: 'fritz', tier: spec.tier });
        action = prod.kind === 'play' ? { kind: 'play', actor, tile: canon(prod.tile), position: prod.position } : { kind: prod.kind, actor };
        if (ch.kind === 'play') ties.push({ cmdIndex: cmds.length, canonical: ch.canonical, topSet: ch.topSet, materialAlternatives: ch.materialAlternatives });
      } else if (ch.kind === 'play') {
        let pick = ch.canonical;
        tie = { cmdIndex: cmds.length, canonical: ch.canonical, topSet: ch.topSet, materialAlternatives: ch.materialAlternatives };
        if (ch.topSet.length > 1) cov.tiedTopScore += 1;
        if (ch.materialAlternatives.length > 0) cov.materialTie += 1;
        const override = opts.fritzOverride?.({ cmdIndex: cmds.length, canonical: ch.canonical, topSet: ch.topSet, materialAlternatives: ch.materialAlternatives });
        if (override) pick = override;
        action = { kind: 'play', actor, tile: pick.tile, position: pick.position };
        if (!override && !opts.skipPolicyParity) {
          const prod = chooseOfficialFritzDecisionForVersion({ version: opts.fritzVersion ?? FRITZ_POLICY_VERSION, state: engine, participantId: 'fritz', tier: spec.tier });
          policyChecks += 1;
          if (prod.kind !== 'play' || okey(prod.tile) !== okey(ch.canonical.tile) || prod.position !== ch.canonical.position) {
            throw new Error(`[${spec.id}] Fritz policy parity: production ${JSON.stringify(prod)} vs independent oracle ${JSON.stringify(ch.canonical)} at cmd ${cmds.length}`);
          }
        }
        if (tie) ties.push(tie);
      } else {
        action = { kind: ch.kind, actor };
        if (!opts.skipPolicyParity) {
          const prod = chooseOfficialFritzDecisionForVersion({ version: opts.fritzVersion ?? FRITZ_POLICY_VERSION, state: engine, participantId: 'fritz', tier: spec.tier });
          policyChecks += 1;
          if (prod.kind !== ch.kind) throw new Error(`[${spec.id}] Fritz policy parity: production ${prod.kind} vs oracle ${ch.kind} at cmd ${cmds.length}`);
        }
      }
    }

    const drawableBefore = o.drawable();
    const boneyardBefore = o.boneyard.length;
    // pre-apply coverage
    if (action.kind === 'draw') {
      if (actor === 'fritz') cov.fritzDraw += 1; else cov.humanDraw += 1;
      if (drawableBefore === 1) cov.finalDrawableTileDrawn += 1;
    }
    if (action.kind === 'pass') {
      if (actor === 'fritz') cov.fritzPass += 1; else cov.humanPass += 1;
      if (drawableBefore === 0 && boneyardBefore > 0) cov.lockedTilesAtPass += 1;
    }
    if ((action.kind === 'play' || action.kind === 'pass') && drawableBefore === 0) cov.emptyDrawableAction += 1;

    const cmd: Cmd = action.kind === 'play'
      ? { actor, kind: 'play', tile: canon(action.tile), position: action.position }
      : { actor, kind: action.kind };

    if (actor === 'fritz') fritzDigests.set(cmds.length, getDailyFritzAuthorityStateDigest(engine, 2));
    const ev = o.apply(action);
    engine = applyGameCommand(engine, {
      version: 1,
      commandId: `gen:${cmds.length}`,
      sequence: engine.sequence,
      actorId: actor,
      kind: cmd.kind,
      ...(cmd.kind === 'play' ? { tile: cmd.tile as Tile, position: cmd.position as never } : {}),
    } as never).state;
    cmds.push(cmd);
    events.push(ev);

    // streak bookkeeping (explicit draws only; chain draws inside a play are counted by the event)
    if (cmd.kind === 'draw') {
      streak = streak.actor === actor ? { ...streak, draws: streak.draws + 1 } : { actor, draws: 1, scoredAfter: false };
    } else {
      flushStreak(cmd, ev, drawableBefore);
      streak = { actor: '', draws: 0, scoredAfter: false };
    }
    if (ev.forcedDraws > 0) cov.chainInsidePlay += 1;
    if (ev.chainPassed) cov.embeddedPass += 1;
    if (cmd.kind === 'play') {
      if (cmd.position?.startsWith('branch-')) cov.branchPlay += 1;
      if (oIsDouble(cmd.tile!)) cov.doublePlay += 1;
      if ((ev.playScore ?? 0) > 0) cov.scoringPlay += 1;
    }
    if (ev.handEnd) {
      handEnd = ev.handEnd;
      if (ev.handEnd === 'blocked') {
        cov.blockedHand += 1;
        // the hand was closed by a pass that itself followed a draw chain (explicit or embedded in the last play)
        if (cmds.slice(-3).some((c) => c.kind === 'draw') || ev.chainPassed) cov.blockedAfterDrawChain += 1;
      } else cov.outHand += 1;
      if (o.gameOver) cov.gameEnding += 1;
    }
  }
  if (!o.handOver) throw new Error(`[${spec.id}] hand did not finish within the guard`);
  return { spec, deal, cmds, oracle: o, engine, fritzDigests, events, ties, cov, handEnd, policyChecks, fritzStates };
}

// ───────────────────────────── client + server legs ─────────────────────────────

export type ClientLeg = { match: BotMatchState; transcript: DailyFritzTranscript };

/** Replays the commands through the REAL client engine, journal and transcript builder. */
export function runClientLeg(p: Played, policyVersion: FritzPolicyVersion = FRITZ_POLICY_VERSION): ClientLeg {
  const { spec, deal } = p;
  const matchStarter = spec.drawWinner === 'you' ? 'you' : 'bot';
  let match = createFixedBotHand(
    { you: spec.start.player, bot: spec.start.fritz },
    spec.handIndex + 1,
    spec.winningScore,
    spec.dealSize,
    deal,
    matchStarter,
  );
  const startedWith = p.oracle.starters[0] as Actor;
  const clientStarter: Actor = match.currentPlayer === 'you' ? 'player' : 'fritz';
  if (clientStarter !== startedWith) throw new Error(`[${spec.id}] client starter ${clientStarter} != oracle starter ${startedWith}`);
  p.cmds.forEach((cmd, index) => {
    const bot = cmd.actor === 'player' ? 'you' : 'bot';
    if (match.currentPlayer !== bot) throw new Error(`[${spec.id}] client turn ${match.currentPlayer} != command actor ${cmd.actor} at ${index}`);
    if (cmd.actor === 'fritz' && cmd.kind === 'play') {
      // The REAL in-game client policy must pick exactly this play, wherever the history follows the canonical selection
      // (a forked tie deviates by construction: the real client would not have chosen it).
      const tie = p.ties.find((t) => t.cmdIndex === index);
      if (tie && okey(tie.canonical.tile) === okey(cmd.tile!) && tie.canonical.position === cmd.position) {
        const difficulty = spec.tier === 'rookie' ? 'casual' : spec.tier === 'elite' ? 'hard' : spec.tier;
        const live = chooseOfficialFritzBotChoice(match, difficulty as never, policyVersion);
        if (!live?.move || live.move.type !== 'play' || okey(live.move.tile as Tile) !== okey(cmd.tile!) || live.move.position !== cmd.position) {
          throw new Error(`[${spec.id}] real client Fritz policy ${JSON.stringify(live?.move)} != canonical ${JSON.stringify(cmd)} at ${index}`);
        }
      }
    }
    const result = cmd.kind === 'play'
      ? applyPlayMove(match, bot, { type: 'play', tile: cmd.tile as Tile, position: cmd.position as never })
      : cmd.kind === 'draw' ? drawOne(match, bot) : passTurn(match, bot);
    if (result.error) throw new Error(`[${spec.id}] client rejected command ${index} (${cmd.actor} ${cmd.kind}): ${result.error.message}`);
    match = result.state;
  });
  const transcript = buildDailyFritzTranscript({
    challengeId: spec.challengeId,
    attemptId: spec.attemptId,
    gameNumber: spec.gameNumber,
    handIndex: spec.handIndex,
    handNumber: match.handNumber,
    moveLog: [],
    protocolVersion: 2,
    fritzPolicyVersion: policyVersion,
    clientRelease: 'verifier-integrity-suite',
    journal: match.officialJournal ?? null,
  });
  return { match, transcript };
}

export type VerifyOutcome =
  | { ok: true; result: ReturnType<typeof verifyDailyFritzHand>['result']; terminalState: GameState; transcript: DailyFritzTranscript }
  | { ok: false; code: string; message: string };

export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

export function runVerifier(
  spec: Spec,
  transcript: unknown,
  opts: { requireStateDigests?: boolean; initialState?: GameState; expected?: Partial<Pick<Spec, 'challengeId' | 'attemptId' | 'gameNumber' | 'handIndex'>> } = {},
): VerifyOutcome {
  try {
    const verified = verifyDailyFritzHand({
      transcript,
      initialState: opts.initialState ?? productionInitialState(spec),
      expectedChallengeId: opts.expected?.challengeId ?? spec.challengeId,
      expectedAttemptId: opts.expected?.attemptId ?? spec.attemptId,
      expectedGameNumber: opts.expected?.gameNumber ?? spec.gameNumber,
      expectedHandIndex: opts.expected?.handIndex ?? spec.handIndex,
      userId: 'user-suite',
      fritzTier: spec.tier,
      requireStateDigests: opts.requireStateDigests ?? true,
      now: () => FIXED_NOW,
    });
    return { ok: true, result: verified.result, terminalState: verified.terminalState, transcript: verified.transcript };
  } catch (error) {
    if (error instanceof DailyFritzVerificationError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: `CRASH`, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

// ───────────────────────────── independent judge ─────────────────────────────

export type JudgeAction = { actor: Actor; kind: 'play' | 'draw' | 'pass'; tile?: { low: number; high: number }; position?: string };
export type JudgeResult = { valid: true; oracle: OGame } | { valid: false; reason: string };

/**
 * Valid-execution test, from the rules only. `fritzMode`:
 *  - 'lenient': a recorded Fritz play may be ANY top-score legal play (what the verifier documents it accepts);
 *  - 'canonical': a recorded Fritz play must be exactly the official canonical selection.
 * Contract reconstructions mirrored here (protocol 2): omitted mandatory draws before a play/pass, and exactly one omitted
 * official Fritz turn before a player action.
 */
export function judge(spec: Spec, actions: readonly JudgeAction[], fritzMode: 'lenient' | 'canonical'): JudgeResult {
  const o = buildOracle(spec);
  const drawAll = (actor: Actor) => { while (o.canDraw(actor)) o.apply({ kind: 'draw', actor }); };
  try {
    for (const action of actions) {
      if (o.handOver || o.gameOver) return { valid: false, reason: 'post_terminal' };
      if (action.actor === 'player' && o.actor === 'fritz') {
        drawAll('fritz');
        const ch = fritzChoices(o, spec.tier);
        if (ch.kind === 'play') o.apply({ kind: 'play', actor: 'fritz', tile: ch.canonical.tile, position: ch.canonical.position });
        else if (ch.kind === 'pass') o.apply({ kind: 'pass', actor: 'fritz' });
        else return { valid: false, reason: 'omitted_fritz_turn_cannot_be_reconstructed' };
        if (o.handOver || o.gameOver) return { valid: false, reason: 'post_terminal_after_recovery' };
      }
      if (action.actor !== o.actor) return { valid: false, reason: 'wrong_actor' };
      if (action.kind !== 'draw') drawAll(action.actor);
      if (action.actor === 'fritz') {
        const ch = fritzChoices(o, spec.tier);
        if (action.kind === 'play') {
          if (ch.kind !== 'play') return { valid: false, reason: 'fritz_should_not_play' };
          const pick: PlayChoice = { tile: canon(action.tile as OTile), position: String(action.position) };
          const ok = fritzMode === 'canonical' ? sameChoice(pick, ch.canonical) : ch.topSet.some((c) => sameChoice(c, pick));
          if (!ok) return { valid: false, reason: 'fritz_action_mismatch' };
        } else if (ch.kind !== action.kind) {
          return { valid: false, reason: 'fritz_action_mismatch' };
        }
      }
      if (action.kind === 'play') o.apply({ kind: 'play', actor: action.actor, tile: canon(action.tile as OTile), position: String(action.position) });
      else o.apply({ kind: action.kind, actor: action.actor });
    }
  } catch (error) {
    return { valid: false, reason: `illegal:${error instanceof Error ? error.message : String(error)}` };
  }
  return o.handOver ? { valid: true, oracle: o } : { valid: false, reason: 'incomplete' };
}

// ───────────────────────────── expected result (independent) ─────────────────────────────

export type ExpectedHandResult = {
  playerBefore: number; fritzBefore: number; playerAfter: number; fritzAfter: number; reason: 'domino' | 'blocked';
  gameOver: boolean; handScoreDelta: { player: number; fritz: number };
};
export function expectedHandResult(spec: Spec, o: OGame): ExpectedHandResult {
  const playerAfter = o.scores.get('player')!;
  const fritzAfter = o.scores.get('fritz')!;
  const domino = o.hands.get('player')!.length === 0 || o.hands.get('fritz')!.length === 0;
  return {
    playerBefore: spec.start.player,
    fritzBefore: spec.start.fritz,
    playerAfter,
    fritzAfter,
    reason: domino ? 'domino' : 'blocked',
    gameOver: o.gameOver,
    handScoreDelta: { player: playerAfter - spec.start.player, fritz: fritzAfter - spec.start.fritz },
  };
}

export { canon, okey, opips, oIsDouble };

// ───────────────────────────── exhaustive ambiguity search ─────────────────────────────

export function cloneOGame(o: OGame): OGame {
  const c = new OGame(o.ids, o.cfg);
  for (const [id, hand] of o.hands) c.hands.set(id, hand.map((t) => ({ ...t })));
  for (const [id, score] of o.scores) c.scores.set(id, score);
  c.boneyard = o.boneyard.map((t) => ({ ...t }));
  c.board = o.board.clone();
  c.cur = o.cur;
  c.passes = o.passes;
  c.handOpen = o.handOpen;
  c.handOver = o.handOver;
  c.gameOver = o.gameOver;
  c.winner = o.winner;
  c.handNumber = o.handNumber;
  c.starters = [...o.starters];
  return c;
}

const fingerprint = (o: OGame): string => JSON.stringify([
  o.scores.get('player'), o.scores.get('fritz'), o.hands.get('player')!.map(okey), o.hands.get('fritz')!.map(okey), o.boneyard.map(okey), o.gameOver, o.winner,
]);

/**
 * Counts EVERY explicit history (any number of explicit draws before each recorded action, rules applied literally, no
 * reconstruction, no policy) that reduces to `reduced`. A reduced transcript that maps to more than one valid history, or to
 * histories with different outcomes, is an ambiguity.
 */
export function countExplicitHistories(spec: Spec, reduced: readonly JudgeAction[], cap = 5000): { histories: number; outcomes: number } {
  const outcomes = new Set<string>();
  let histories = 0;
  const walk = (o: OGame, index: number): void => {
    if (histories > cap) return;
    if (index === reduced.length) {
      if (o.handOver) { histories += 1; outcomes.add(fingerprint(o)); }
      return;
    }
    if (o.handOver) return;
    const action = reduced[index]!;
    if (action.actor !== o.actor) return;
    let current = o;
    for (;;) {
      const trial = cloneOGame(current);
      let legal = true;
      try {
        if (action.kind === 'play') trial.apply({ kind: 'play', actor: action.actor, tile: canon(action.tile as OTile), position: String(action.position) });
        else trial.apply({ kind: action.kind, actor: action.actor });
      } catch { legal = false; }
      if (legal) walk(trial, index + 1);
      if (!current.canDraw(action.actor)) break;
      current = cloneOGame(current);
      current.apply({ kind: 'draw', actor: action.actor });
    }
  };
  walk(buildOracle(spec), 0);
  return { histories, outcomes: outcomes.size };
}
