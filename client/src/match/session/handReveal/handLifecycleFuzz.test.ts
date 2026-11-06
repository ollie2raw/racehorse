/**
 * A fuzzer for the multiplayer hand lifecycle.
 *
 * The decisions under test are the real ones (handLifecycleMachine through handLifecycleDriver, and tournamentViewDesyncMachine); everything
 * around them is a model: a tournament room (human against Fritz) with the server's ready gate, a transport with latency, duplicates,
 * disconnects and resyncs, and a client that applies state the way the real one does (the sequence-watermark guards are the real functions).
 * A virtual clock drives all of it, so a run is a pure function of its seed and a failure is reproducible from the seed alone.
 *
 * What the server does that matters (server/src/multiplayer/roomSession.ts, server/src/rooms.ts):
 *  - a hand end is state:update (handOver) and then hand:ended, in that order;
 *  - the next hand is dealt once every seat is ready AND at least 2.5 s after the hand ended;
 *  - Fritz readies 0.8 s after the hand ends and, when it starts the hand, opens about a second after the deal;
 *  - the human is auto-readied by the 45 s next-hand clock.
 * What the client does that matters (read, not edited: client/src/multiplayer/connectionGameplaySocketHandlers.ts):
 *  - the hand:ended handler marks the hand shown and arms ITS OWN 1.4 s reveal timer in the shared ref, without clearing the one the hook
 *    armed from the state update, so two timers race to open the reveal.
 *
 * Properties checked after every event:
 *  P1  ready is never sent for a hand whose reveal the player never saw, unless it is a re-send after a reveal that was shown and cleared;
 *  P2  the next hand is never dealt while the previous hand's reveal is still open (the 2026-11-06 tournament bug);
 *  P3  a reveal never stays open on top of a later hand that is in play;
 *  P4  the clock naming the player and the match view saying otherwise never lasts longer than the recovery bound (the dimmed-tiles bug);
 *  P5  the player is ready for every hand within a bounded time (the 45 s clock must never be what moves a match on).
 */
import { describe, expect, it } from 'vitest';
import { evaluateSequenceWatermark } from '../../../multiplayer/socketGuards';
import { shouldDropPreProjectionStateReplay } from '../../../multiplayer/projection/projectionGates';
import {
  HAND_REVEAL_OPEN_DELAY_MS,
  stepsForViewChange,
  type HandLifecycleEffect,
  type HandView,
} from './handLifecycleMachine';
import { createHandLifecycleDriver } from './handLifecycleDriver';
import {
  INITIAL_DESYNC_STATE,
  reduceViewDesync,
  TOURNAMENT_VIEW_DESYNC_GRACE_MS,
  type DesyncEffect,
  type DesyncState,
} from '../../../tournament/tournamentViewDesyncMachine';

// ── the virtual clock ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Scheduled = { at: number; order: number; id: number; tag: string; run: () => void };

class Clock {
  now = 0;
  private queue: Scheduled[] = [];
  private cancelled = new Set<number>();
  private nextId = 1;
  private order = 0;

  after(delayMs: number, tag: string, run: () => void): number {
    const id = this.nextId++;
    this.queue.push({ at: this.now + Math.max(0, delayMs), order: this.order++, id, tag, run });
    return id;
  }

  cancel(id: number | null): void {
    if (id !== null) this.cancelled.add(id);
  }

  /** Runs the next event; false when nothing is left. */
  step(): boolean {
    for (;;) {
      if (this.queue.length === 0) return false;
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i];
        const b = this.queue[best];
        if (a.at < b.at || (a.at === b.at && a.order < b.order)) best = i;
      }
      const next = this.queue.splice(best, 1)[0];
      if (this.cancelled.delete(next.id)) continue;
      this.now = next.at;
      next.run();
      return true;
    }
  }
}

// ── the model ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Seat = 'you' | 'fritz';
type StateMsg = { seq: number; handNumber: number; handOver: boolean; gameOver: boolean; turn: Seat };
type ClockMsg = { kind: 'turn'; deadline: number } | { kind: 'next_hand'; deadline: number } | null;
type ServerMsg =
  | { type: 'state'; state: StateMsg }
  | { type: 'handEnded'; handNumber: number }
  | { type: 'clock'; clock: ClockMsg }
  | { type: 'joinAck'; state: StateMsg; clock: ClockMsg; clearsReveal: boolean }
  | { type: 'ack'; id: number };
type ClientMsg = { type: 'ready'; handNumber: number | undefined; ackId: number } | { type: 'move'; seq: number } | { type: 'resync'; clearsReveal: boolean };

export type Violation = { property: string; at: number; detail: string };

export type FuzzOptions = {
  /** Probability that a state broadcast is delivered twice (the optimistic-apply echo). */
  echoRate: number;
  /** Mean milliseconds between disconnects (0: none). */
  disconnectEveryMs: number;
  /** Whether a reconnect clears the reveal on screen (the real reconnect path resets the shell UI; not confirmed for every path). */
  reconnectClearsReveal: number;
  /** Probability that the client silently drops a state update with no follow-up fetch (a projection gate with no fetch reason). */
  silentDropRate: number;
  /** Probability that the player taps Continue rather than waiting for the countdown. */
  tapRate: number;
};

export const DEFAULT_OPTIONS: FuzzOptions = {
  echoRate: 0.2,
  disconnectEveryMs: 25_000,
  reconnectClearsReveal: 0.7,
  silentDropRate: 0,
  tapRate: 0.6,
};

const NEXT_HAND_CLOCK_MS = 45_000;
const READY_GATE_MS = 2_500;
const FRITZ_READY_MS = 800;
const TURN_CLOCK_MS = 45_000;
/** How long the clock may name the player while the view does not: the grace, a round trip for the resync, and slack. */
const DESYNC_BOUND_MS = TOURNAMENT_VIEW_DESYNC_GRACE_MS + 1_500;
/** The normal path is the reveal opening and its countdown (about 5.5 s); a person taking longer than this is not a bug but the machine never sending is. */
const READY_BOUND_MS = 12_000;
/** emitWithAck rejects after this long with no ack (roomTransport.ts SOCKET_ACK_TIMEOUT_MS). */
const ACK_TIMEOUT_MS = 8_000;

export function runWorld(seed: number, options: FuzzOptions = DEFAULT_OPTIONS): { violations: Violation[]; trace: string[]; hands: number; events: number } {
  const rng = mulberry32(seed);
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const clock = new Clock();
  const violations: Violation[] = [];
  const trace: string[] = [];
  const log = (line: string) => {
    trace.push(`${Math.round(clock.now)}ms ${line}`);
    if (trace.length > 80) trace.shift();
  };
  const violate = (property: string, detail: string) => {
    if (violations.some((v) => v.property === property)) return;
    violations.push({ property, at: clock.now, detail });
    log(`VIOLATION ${property}: ${detail}`);
  };

  // ── transport ──
  let epoch = 0;
  let connected = true;
  let lastReconnectAt = 0;
  let toClientTail = 0;
  let toServerTail = 0;
  const toClient = (msg: ServerMsg) => {
    const myEpoch = epoch;
    toClientTail = Math.max(toClientTail, clock.now + between(5, 250));
    clock.after(toClientTail - clock.now, `net->client ${msg.type}`, () => {
      if (myEpoch !== epoch) return;
      onClientMessage(msg);
    });
  };
  const toServer = (msg: ClientMsg) => {
    const myEpoch = epoch;
    toServerTail = Math.max(toServerTail, clock.now + between(5, 250));
    clock.after(toServerTail - clock.now, `net->server ${msg.type}`, () => {
      if (myEpoch !== epoch) return;
      onServerMessage(msg);
    });
  };

  // ── the server ──
  const server = {
    seq: 0,
    handNumber: 0,
    turn: 'you' as Seat,
    moves: 0,
    movesTarget: 0,
    handOver: false,
    gameOver: false,
    endedAt: 0,
    readyYou: false,
    readyFritz: false,
    handsLeft: 2 + Math.floor(rng() * 5),
    gateCheck: null as number | null,
  };
  const serverState = (): StateMsg => ({ seq: server.seq, handNumber: server.handNumber, handOver: server.handOver, gameOver: server.gameOver, turn: server.turn });
  const serverClock = (): ClockMsg => {
    if (server.gameOver) return null;
    if (server.handOver) return { kind: 'next_hand', deadline: server.endedAt + NEXT_HAND_CLOCK_MS };
    if (server.turn === 'you') return { kind: 'turn', deadline: clock.now + TURN_CLOCK_MS };
    return null;
  };
  const broadcastState = () => {
    const state = serverState();
    toClient({ type: 'state', state });
    if (rng() < options.echoRate) toClient({ type: 'state', state });
    toClient({ type: 'clock', clock: serverClock() });
  };

  const fritzMove = () => {
    if (server.handOver || server.gameOver || server.turn !== 'fritz') return;
    server.moves += 1;
    server.seq += 1;
    server.turn = rng() < 0.15 ? 'fritz' : 'you'; // a scoring play keeps the turn
    if (server.moves >= server.movesTarget) return endHand();
    broadcastState();
    if (server.turn === 'fritz') clock.after(between(600, 1400), 'fritz moves', fritzMove);
  };

  const humanMove = (msg: { seq: number }) => {
    if (server.handOver || server.gameOver || server.turn !== 'you') return;
    void msg;
    server.moves += 1;
    server.seq += 1;
    server.turn = rng() < 0.15 ? 'you' : 'fritz';
    if (server.moves >= server.movesTarget) return endHand();
    broadcastState();
    if (server.turn === 'fritz') clock.after(between(600, 1400), 'fritz moves', fritzMove);
  };

  const startHand = () => {
    // P2: the deal must not land under the previous hand's reveal.
    if (client.reveal && client.reveal.handNumber === server.handNumber) {
      violate('P2', `hand ${server.handNumber + 1} dealt while the reveal for hand ${server.handNumber} was still open`);
    }
    server.handNumber += 1;
    server.moves = 0;
    server.movesTarget = 3 + Math.floor(rng() * 6);
    server.handOver = false;
    server.readyYou = false;
    server.readyFritz = false;
    server.turn = server.handNumber % 2 === 1 ? 'fritz' : 'you';
    server.seq += 1;
    log(`server deals hand ${server.handNumber}, ${server.turn} starts`);
    broadcastState();
    if (server.turn === 'fritz') clock.after(between(700, 1300), 'fritz opens', fritzMove);
  };

  const checkGate = () => {
    if (!server.handOver || server.gameOver || !server.readyYou || !server.readyFritz) return;
    const earliest = server.endedAt + READY_GATE_MS;
    if (clock.now >= earliest) return startHand();
    clock.cancel(server.gateCheck);
    server.gateCheck = clock.after(earliest - clock.now, 'server ready gate', checkGate);
  };

  function endHand() {
    server.handOver = true;
    server.endedAt = clock.now;
    server.handsLeft -= 1;
    if (server.handsLeft <= 0) server.gameOver = true;
    server.seq += 1;
    log(`server ends hand ${server.handNumber}${server.gameOver ? ' (game over)' : ''}`);
    // state:update first, hand:ended after it.
    toClient({ type: 'state', state: serverState() });
    toClient({ type: 'handEnded', handNumber: server.handNumber });
    toClient({ type: 'clock', clock: serverClock() });
    if (server.gameOver) return;
    const handAtEnd = server.handNumber;
    clock.after(FRITZ_READY_MS, 'fritz ready', () => {
      if (server.handNumber === handAtEnd && server.handOver) {
        server.readyFritz = true;
        checkGate();
      }
    });
    clock.after(NEXT_HAND_CLOCK_MS, 'next-hand clock readies the human', () => {
      if (server.handNumber === handAtEnd && server.handOver && !server.readyYou) {
        log('server: the 45 s next-hand clock readied the human');
        server.readyYou = true;
        checkGate();
      }
    });
  }

  function onServerMessage(msg: ClientMsg) {
    if (msg.type === 'ready') {
      toClient({ type: 'ack', id: msg.ackId });
      if (server.handOver && !server.gameOver && (msg.handNumber === undefined || msg.handNumber === server.handNumber)) {
        server.readyYou = true;
        log(`server: human ready for hand ${server.handNumber}`);
        checkGate();
      }
    } else if (msg.type === 'move') {
      humanMove(msg);
    } else {
      toClient({ type: 'joinAck', state: serverState(), clock: serverClock(), clearsReveal: msg.clearsReveal });
    }
  }

  // ── the client ──
  type RevealView = { handNumber: number; version: number };
  const client = {
    socketId: 1,
    state: null as StateMsg | null,
    stateVersion: 0,
    reveal: null as RevealView | null,
    revealVersion: 0,
    clockMsg: null as ClockMsg,
    watermark: -1,
    /** hands whose reveal has been on screen */
    seen: new Set<number>(),
    /** hands for which hand:ready was sent from a continue */
    sentFrom: new Map<number, string>(),
  };

  // the refs the machine shares with the hand:ended handler
  const refs = {
    shown: { current: null as number | null },
    timer: { current: null as number | null },
    recoveryLatched: { current: false },
  };
  let autoTimer: number | null = null;
  let ownRevealTimer: number | null = null; // the hook's own reveal timer, tracked apart from the shared ref the hand:ended handler overwrites
  let ackCounter = 0;
  const ackWaiting = new Map<number, { timer: number; handNumber: number | null; source: 'continue' | 'recovery' }>();
  const bufferedEmits: ClientMsg[] = [];

  const setReveal = (next: RevealView | null | ((prev: RevealView | null) => RevealView | null)) => {
    const value = typeof next === 'function' ? next(client.reveal) : next;
    if (value === client.reveal) return;
    log(value ? `reveal for hand ${value.handNumber} opens` : 'reveal closes');
    if (value) {
      client.reveal = { handNumber: value.handNumber, version: ++client.revealVersion };
      client.seen.add(value.handNumber);
    } else {
      client.reveal = null;
    }
  };

  const runEffect = (effect: HandLifecycleEffect, context: { handNumber: number } | undefined) => {
    switch (effect.type) {
      case 'armRevealTimer': {
        clock.cancel(refs.timer.current);
        clock.cancel(ownRevealTimer);
        const armedFor = effect.handNumber;
        const timer = clock.after(effect.delayMs, 'hook reveal timer', () => {
          if (ownRevealTimer === timer) ownRevealTimer = null;
          driver.dispatch({ type: 'revealTimerFired', handNumber: armedFor }, { handNumber: armedFor });
          render();
        });
        ownRevealTimer = timer;
        refs.timer.current = timer;
        return;
      }
      case 'cancelRevealTimer':
        clock.cancel(refs.timer.current);
        clock.cancel(ownRevealTimer);
        refs.timer.current = null;
        ownRevealTimer = null;
        return;
      case 'openReveal': {
        const n = context?.handNumber ?? effect.handNumber;
        setReveal((prev) => (prev && prev.handNumber === n ? prev : { handNumber: n, version: 0 }));
        return;
      }
      case 'closeReveal':
        setReveal(null);
        return;
      case 'cancelAutoContinue':
        clock.cancel(autoTimer);
        autoTimer = null;
        return;
      case 'armAutoContinue':
        autoTimer = clock.after(effect.durationMs, 'auto-continue', () => {
          driver.dispatch({ type: 'autoContinueFired' });
          render();
        });
        return;
      case 'sendReady': {
        const n = effect.handNumber;
        // P1: nothing is sent for a hand the player never saw, other than a re-send after the reveal was shown and cleared.
        if (n !== undefined && !client.seen.has(n)) {
          violate('P1', `hand:ready (${effect.source}) for hand ${n} before its reveal was ever shown`);
        }
        log(`client sends hand:ready(${n}) from ${effect.source}`);
        // emitWithAck: the ack resolves it, 8 s without one rejects it; an emit made while disconnected is buffered and sent on reconnect, one in
        // flight when the connection drops is lost.
        const ackId = ++ackCounter;
        const source = effect.source;
        ackWaiting.set(ackId, {
          handNumber: n ?? null,
          source,
          timer: clock.after(ACK_TIMEOUT_MS, 'ready ack timeout', () => {
            ackWaiting.delete(ackId);
            log(`hand:ready(${n}) was never acknowledged`);
            driver.dispatch({ type: 'readySettled', handNumber: n ?? null, source, ok: false });
            render();
          }),
        });
        const message: ClientMsg = { type: 'ready', handNumber: n, ackId };
        if (connected) toServer(message);
        else bufferedEmits.push(message);
        return;
      }
      case 'warnReadyFailed':
        return;
    }
  };

  const driver = createHandLifecycleDriver<number, { handNumber: number }>(refs, runEffect);

  let lastView: HandView | null = null;
  const buildView = (): HandView => ({
    inGame: connected && client.state !== null,
    hand: client.state
      ? { handNumber: client.state.handNumber, handOver: client.state.handOver, gameOver: client.state.gameOver, version: client.stateVersion }
      : null,
    preGameDraw: false,
    reveal: client.reveal,
    roomJoined: true,
    socketId: client.socketId,
    socketConnected: connected,
  });

  const viewIsMyTurn = () => Boolean(client.state && client.state.turn === 'you' && !client.state.handOver && !client.state.gameOver);

  // desync recovery (the tournament HUD hook)
  let desync: DesyncState = INITIAL_DESYNC_STATE;
  let desyncTimer: number | null = null;
  const runDesyncEffect = (effect: DesyncEffect) => {
    if (effect.type === 'cancelTimer') {
      clock.cancel(desyncTimer);
      desyncTimer = null;
    } else if (effect.type === 'armTimer') {
      desyncTimer = clock.after(effect.delayMs, 'desync grace', () => {
        desyncTimer = null;
        const step = reduceViewDesync(desync, { type: 'timerFired', deadline: effect.deadline });
        desync = step.state;
        step.effects.forEach(runDesyncEffect);
      });
    } else {
      log('client: clock/view desync, asking for the room state');
      if (connected) toServer({ type: 'resync', clearsReveal: false });
    }
  };
  let lastDesyncInput = '';
  const renderDesync = () => {
    // As TournamentMatchHud passes it: not gated on the hand being in play (a view stuck on the previous hand's end is the case to recover).
    const active = connected && client.state !== null && !client.state.gameOver;
    const deadlineMs = client.clockMsg?.kind === 'turn' ? client.clockMsg.deadline : null;
    const input = { active, clockNamesMeDeadline: deadlineMs === null ? null : String(deadlineMs), viewIsMyTurn: viewIsMyTurn() };
    const key = JSON.stringify(input);
    if (key === lastDesyncInput) return;
    lastDesyncInput = key;
    const step = reduceViewDesync(desync, { type: 'input', input });
    desync = step.state;
    step.effects.forEach(runDesyncEffect);
  };

  // the human: plays when it is their turn, taps Continue on a reveal sometimes
  let thinkingFor: string | null = null;
  const maybeAct = () => {
    if (connected && viewIsMyTurn() && client.state) {
      const key = `${client.state.handNumber}:${client.state.seq}`;
      if (thinkingFor !== key) {
        thinkingFor = key;
        clock.after(between(300, 1800), 'human moves', () => {
          if (connected && viewIsMyTurn() && client.state && `${client.state.handNumber}:${client.state.seq}` === key) {
            toServer({ type: 'move', seq: client.state.seq });
          } else {
            thinkingFor = null;
          }
        });
      }
    }
  };
  let tappedFor: number | null = null;
  const maybeTap = () => {
    if (!client.reveal || tappedFor === client.reveal.handNumber) return;
    tappedFor = client.reveal.handNumber;
    if (rng() >= options.tapRate) return;
    const n = client.reveal.handNumber;
    clock.after(between(400, 3500), 'player taps Continue', () => {
      if (client.reveal && client.reveal.handNumber === n) {
        driver.setView(buildView());
        driver.dispatch({ type: 'continue' });
        render();
      }
    });
  };

  const checkInvariants = () => {
    // P3: a reveal must not stay on top of a later hand that is in play.
    const s = client.state;
    if (client.reveal && s && !s.handOver && !s.gameOver && s.handNumber > client.reveal.handNumber) {
      violate('P3', `the reveal for hand ${client.reveal.handNumber} is open over hand ${s.handNumber} in play`);
    }
  };

  function render() {
    const view = buildView();
    const steps = stepsForViewChange(lastView, view);
    lastView = view;
    if (steps.length > 0 || lastView === null) driver.dispatch({ type: 'view', view, steps });
    renderDesync();
    maybeAct();
    maybeTap();
    checkInvariants();
  }

  function onClientMessage(msg: ServerMsg) {
    switch (msg.type) {
      case 'state': {
        if (!connected) return;
        const s = msg.state;
        if (shouldDropPreProjectionStateReplay(client.watermark, s.seq)) return;
        const decision = evaluateSequenceWatermark(client.watermark, s.seq);
        if (decision.action !== 'accept') {
          log(`client drops state seq ${s.seq} (${decision.action}), fetching`);
          toServer({ type: 'resync', clearsReveal: false });
          return;
        }
        if (rng() < options.silentDropRate) {
          log(`client silently drops state seq ${s.seq}`);
          return;
        }
        client.watermark = decision.sequence;
        client.state = s;
        client.stateVersion += 1;
        log(`client applies state seq ${s.seq} hand ${s.handNumber} turn ${s.turn}${s.handOver ? ' handOver' : ''}`);
        render();
        return;
      }
      case 'handEnded': {
        // The hand:ended handler (protected code, modelled): marks the hand shown and arms its own timer without clearing the existing one.
        refs.shown.current = msg.handNumber;
        const n = msg.handNumber;
        refs.timer.current = clock.after(HAND_REVEAL_OPEN_DELAY_MS, 'hand:ended reveal timer', () => {
          refs.timer.current = null;
          setReveal({ handNumber: n, version: 0 });
          render();
        });
        return;
      }
      case 'ack': {
        const waiting = ackWaiting.get(msg.id);
        if (waiting !== undefined) {
          clock.cancel(waiting.timer);
          ackWaiting.delete(msg.id);
          driver.dispatch({ type: 'readySettled', handNumber: waiting.handNumber, source: waiting.source, ok: true });
          render();
        }
        return;
      }
      case 'clock':
        client.clockMsg = msg.clock;
        render();
        return;
      case 'joinAck': {
        client.watermark = msg.state.seq;
        client.state = msg.state;
        client.stateVersion += 1;
        client.clockMsg = msg.clock;
        if (msg.clearsReveal) setReveal(null);
        log(`client applies join ack seq ${msg.state.seq} hand ${msg.state.handNumber} turn ${msg.state.turn}`);
        render();
      }
    }
  }

  // ── chaos ──
  const scheduleDisconnect = () => {
    if (options.disconnectEveryMs <= 0) return;
    clock.after(-Math.log(1 - rng()) * options.disconnectEveryMs, 'disconnect', () => {
      if (server.gameOver && !client.reveal) return;
      connected = false;
      epoch += 1;
      log('connection lost');
      render();
      clock.after(between(100, 2500), 'reconnect', () => {
        connected = true;
        lastReconnectAt = clock.now;
        epoch += 1;
        client.socketId += 1;
        log('reconnected, asking for the room state');
        for (const buffered of bufferedEmits.splice(0)) toServer(buffered);
        toServer({ type: 'resync', clearsReveal: rng() < options.reconnectClearsReveal });
        render();
        scheduleDisconnect();
      });
    });
  };

  // ── run ──
  startHand();
  scheduleDisconnect();
  const handEndedAt = new Map<number, number>();
  let events = 0;
  let clientMismatchSince: number | null = null;
  let readyDeadlineChecked = new Set<number>();
  while (events < 20_000 && clock.now < 20 * 60_000 && violations.length === 0) {
    if (!clock.step()) break;
    events += 1;
    if (server.handOver && !handEndedAt.has(server.handNumber)) handEndedAt.set(server.handNumber, server.endedAt);

    // P4: the clock names the player, the view says otherwise, and the connection is up.
    const clockNamesMe = client.clockMsg?.kind === 'turn';
    const serverSaysMine = server.turn === 'you' && !server.handOver && !server.gameOver;
    if (connected && clockNamesMe && serverSaysMine && !viewIsMyTurn()) {
      clientMismatchSince ??= clock.now;
      if (clock.now - clientMismatchSince > DESYNC_BOUND_MS) {
        violate('P4', `the clock named the player for ${Math.round(clock.now - clientMismatchSince)} ms while the view said it was not their turn (hand ${client.state?.handNumber}, view seq ${client.state?.seq}, server seq ${server.seq})`);
      }
    } else {
      clientMismatchSince = null;
    }

    // P5: the player is ready for the hand that ended, soon.
    // The bound runs while connected: from the hand ending, or from the last reconnect if that is later (nothing can be sent while offline).
    const readyClockStart = Math.max(server.endedAt, lastReconnectAt);
    if (connected && server.handOver && !server.gameOver && !server.readyYou && !readyDeadlineChecked.has(server.handNumber) && clock.now - readyClockStart > READY_BOUND_MS) {
      readyDeadlineChecked.add(server.handNumber);
      violate('P5', `hand ${server.handNumber} ended ${Math.round(clock.now - server.endedAt)} ms ago (${Math.round(clock.now - readyClockStart)} ms connected) and the player has still not signalled ready (reveal ${client.reveal ? 'open' : 'closed'}, armed for ${refs.shown.current}, timer ${refs.timer.current === null ? 'none' : 'pending'}, connected ${connected})`);
    }
  }
  return { violations, trace, hands: server.handNumber, events };
}

// ── the tests ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const envSeeds = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.HAND_LIFECYCLE_FUZZ_SEEDS;
/** HAND_LIFECYCLE_FUZZ_SEEDS=5000 for a long run; the default is quick enough for CI. */
const SEEDS = Number(envSeeds ?? 150);

function report(seed: number, result: ReturnType<typeof runWorld>): string {
  return [`seed ${seed}`, ...result.violations.map((v) => `${v.property} @${Math.round(v.at)}ms: ${v.detail}`), '--- trace tail ---', ...result.trace.slice(-40)].join('\n');
}

/** The scenarios the properties are held under. Each is run over SEEDS seeds. */
const SCENARIOS: Record<string, Partial<FuzzOptions>> = {
  'echoes, disconnects, resyncs and taps (the default)': {},
  'a flaky connection (a disconnect every 6 s)': { disconnectEveryMs: 6_000 },
  'a reconnect that always clears the reveal': { reconnectClearsReveal: 1 },
  'a reconnect that never clears the reveal': { reconnectClearsReveal: 0 },
  'a player who never taps Continue (the countdown does it)': { tapRate: 0 },
  'a player who always taps Continue, on a flaky connection': { tapRate: 1, disconnectEveryMs: 10_000 },
  'state updates silently dropped by the client (the dimmed-tiles scenario)': { silentDropRate: 0.05 },
  'state updates silently dropped on a flaky connection': { silentDropRate: 0.2, disconnectEveryMs: 8_000 },
};

describe('the hand lifecycle fuzzer', () => {
  it('is deterministic: a seed gives the same run', () => {
    const a = runWorld(7);
    const b = runWorld(7);
    expect(b.events).toBe(a.events);
    expect(b.trace).toEqual(a.trace);
  });

  it('plays whole matches', () => {
    const result = runWorld(11, { ...DEFAULT_OPTIONS, disconnectEveryMs: 0 });
    expect(result.hands).toBeGreaterThanOrEqual(2);
  });

  for (const [name, overrides] of Object.entries(SCENARIOS)) {
    it(`holds P1-P5 with ${name}`, { timeout: 120_000 }, () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const result = runWorld(seed, { ...DEFAULT_OPTIONS, ...overrides });
        if (result.violations.length > 0) failures.push(report(seed, result));
      }
      expect(failures.slice(0, 2).join('\n\n')).toBe('');
    });
  }
});
