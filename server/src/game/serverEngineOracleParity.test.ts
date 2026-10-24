/**
 * The authoritative multiplayer path (rooms.ts: startGame -> act -> nextHand, including its aggregated
 * forced-draw chains and mandatory auto-passes) driven by the SAME independent rules oracle that checks
 * packages/game-core. Seeds are reproducible strings; a failure message names the seed and step.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => undefined),
}));

import { act, createReservedRoom, getRoom, joinRoom, nextHand, resetRoomRuntimeForTests, startGame } from '../rooms';
import { resetRoomGameplayLocksForTests } from '../multiplayer/roomGameplayLock';
import { initRoomSession } from '../multiplayer/roomSession';
import { OGame, canon, okey, type OTile } from '../../../packages/game-core/src/__tests__/support/engineOracle';
import { seededDeck, toOracleConfig } from '../../../packages/game-core/src/__tests__/support/engineHarness';
import { DEFAULT_CONFIG, type Config } from './types';

const GAMES = Number(process.env.ENGINE_SERVER_PARITY_GAMES ?? 12);
const NS = process.env.ENGINE_PROPERTY_SEED ?? 'engine-invariants-v1';
const io = { sockets: { sockets: new Map(), adapter: { rooms: new Map() } }, to: vi.fn(() => ({ emit: vi.fn(), except: () => ({ emit: vi.fn() }) })) } as never;
initRoomSession(io, {
  resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
  normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
  normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped',
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  maybeFinalizeTournamentMatch: () => undefined,
  persistRoomMatchLog: async () => undefined,
  onGameOver: () => null,
  finalizeTournamentMatch: () => undefined,
} as never);

function rng(seed: string) {
  let s = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { s ^= seed.charCodeAt(i); s = Math.imul(s, 16777619); }
  s = s >>> 0 || 1;
  return (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor((s / 0x100000000) * n); };
}

const keys = (ts: readonly OTile[]) => ts.map(okey).sort();

describe('server authoritative path == independent oracle', () => {
  for (const winningScore of [25, 60]) {
    it(`${GAMES} seeded games to completion (winningScore=${winningScore})`, async () => {
      let actions = 0; let hands = 0; let completed = 0;
      for (let g = 0; g < GAMES; g += 1) {
        const seed = `${NS}:server:${winningScore}:${g}`;
        resetRoomRuntimeForTests();
        resetRoomGameplayLocksForTests();
        const code = `P${winningScore}${g}`.slice(0, 6);
        const cfg: Partial<Config> = { winningScore };
        createReservedRoom(code, cfg);
        joinRoom(code, 'seat-a');
        joinRoom(code, 'seat-b');
        const room = getRoom(code);
        room.players = ['seat-a', 'seat-b'];
        const full = { ...DEFAULT_CONFIG, ...cfg };
        const oracle = new OGame(['seat-a', 'seat-b'], toOracleConfig(full));
        const pick = rng(seed);
        let dealt = 0;
        const deal = async (first: boolean) => {
          if (first) {
            const deck = seededDeck(`${seed}:h${dealt}`, 6);
            await startGame(code, io, { customDeck: deck, startingPlayerId: 'seat-a' });
            oracle.dealHand(deck, 'seat-a');
          } else {
            await nextHand(code, io); // the server shuffles; adopt ITS deal into the oracle and verify it is a full deck
            const s = getRoom(code).state!;
            const deck = [...s.players['seat-a']!.hand, ...s.players['seat-b']!.hand, ...s.boneyard];
            expect(keys(deck), seed).toEqual(keys(seededDeck('x', 6)));
            oracle.dealHand(deck);
          }
          dealt += 1; hands += 1;
        };
        await deal(true);
        let step = 0;
        while (!oracle.gameOver && step < 3000) {
          const ctx = `[seed=${seed} step=${step}]`;
          if (oracle.handOver) {
            expect(getRoom(code).state!.handOver, ctx).toBe(true);
            await deal(false);
            continue;
          }
          const actor = oracle.actor;
          const plays = oracle.plays(actor);
          step += 1; actions += 1;
          if (plays.length > 0) {
            const p = plays[pick(plays.length)]!;
            await act(code, actor, { type: 'MOVE', move: { tile: { high: p.tile.high, low: p.tile.low }, position: p.position as never } }, io, () => undefined);
            oracle.apply({ kind: 'play', actor, tile: p.tile, position: p.position });
          } else if (oracle.canDraw(actor)) {
            await act(code, actor, { type: 'DRAW' }, io, () => undefined);
            // the server's DRAW resolves the whole forced chain: draw until a play exists or the boneyard locks
            for (;;) {
              oracle.apply({ kind: 'draw', actor });
              if (oracle.plays(actor).length > 0 || oracle.drawable() === 0) break;
            }
          } else {
            throw new Error(`${ctx} oracle expects a pass that the server never asks a client for`);
          }
          // the server resolves mandatory passes itself
          while (!oracle.handOver && !oracle.gameOver && oracle.plays(oracle.actor).length === 0 && oracle.drawable() === 0) {
            oracle.apply({ kind: 'pass', actor: oracle.actor });
          }
          const s = getRoom(code).state!;
          for (const id of ['seat-a', 'seat-b']) {
            expect(keys(s.players[id]!.hand), `${ctx} hand ${id}`).toEqual(keys(oracle.hands.get(id)!));
            expect(s.players[id]!.score, `${ctx} score ${id}`).toBe(oracle.scores.get(id));
          }
          expect(s.boneyard.map((t) => okey(canon(t))), `${ctx} boneyard`).toEqual(oracle.boneyard.map(okey));
          expect(s.playerIds[s.currentPlayerIndex], `${ctx} turn`).toBe(oracle.handOver ? s.playerIds[s.currentPlayerIndex] : oracle.actor);
          expect(s.consecutivePasses, `${ctx} passes`).toBe(oracle.passes);
          expect(s.handOver, `${ctx} handOver`).toBe(oracle.handOver);
          expect(s.gameOver, `${ctx} gameOver`).toBe(oracle.gameOver);
          expect(s.winnerId, `${ctx} winner`).toBe(oracle.winner);
          const boardTiles = s.board ? [...s.board.mainLine.map((p) => p.tile), ...s.board.hubDoubles.flatMap((h) => h.branches.flatMap((b) => (b ? b.tiles.map((p) => p.tile) : [])))] : [];
          expect(keys(boardTiles), `${ctx} board`).toEqual(keys(oracle.board.tiles()));
          expect(boardTiles.length + s.boneyard.length + s.playerIds.reduce((n, id) => n + s.players[id]!.hand.length, 0), `${ctx} conservation`).toBe(28);
        }
        if (oracle.gameOver) completed += 1;
      }
      expect(actions).toBeGreaterThan(GAMES * 20);
      expect(completed).toBeGreaterThan(GAMES / 2);
      expect(hands).toBeGreaterThan(GAMES);
    }, 600_000);
  }
});
