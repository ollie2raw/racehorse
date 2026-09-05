import { describe, expect, it } from 'vitest';
import { computePlayScore, simulatePlacement } from '../game/scoring';
import { DEFAULT_CONFIG } from '../game/types';
import type { BoardState } from '../game/types';
import { verifyPlayerMoveLog } from './verifier';
import type { GhostMoveLogEntry } from './service';

// Minimal serializer matching the shape parseGhostBoardState() expects
// (mirrors what the client actually posts as move_log.board_state JSON).
function serializeBoard(board: BoardState | null): string {
  if (!board) return 'board:empty';
  return JSON.stringify({
    mainLine: board.mainLine.map((placed) => ({
      tile: [placed.tile.low, placed.tile.high],
      orientation: placed.orientation,
    })),
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
    leftEndIsDouble: board.leftEndIsDouble,
    rightEndIsDouble: board.rightEndIsDouble,
    hubs: [],
  });
}

describe('verifyPlayerMoveLog', () => {
  it('accepts a legitimate two-move hand where scores match the engine exactly', () => {
    const tile1 = { low: 3, high: 3 };
    // Playing a double opens both ends at its pip value (3), so a tile
    // containing a 3 is a legal continuation at 'left'.
    const tile2 = { low: 3, high: 5 };
    const boardAfter1 = simulatePlacement(null, tile1, 'left');
    const score1 = computePlayScore(boardAfter1, DEFAULT_CONFIG);
    const boardAfter2 = simulatePlacement(boardAfter1, tile2, 'left');
    const score2 = computePlayScore(boardAfter2, DEFAULT_CONFIG);

    const moveLog: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(null),
        tile_played: '3|3',
        branch: 'left',
        hand_before: ['3|3', '3|5'],
        score_delta: score1,
      },
      {
        turn: 2,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(boardAfter1),
        tile_played: '3|5',
        branch: 'left',
        hand_before: ['3|5'],
        score_delta: score2,
      },
    ];

    expect(verifyPlayerMoveLog(moveLog)).toEqual({ ok: true });
  });

  it('rejects a move whose reported score does not match the engine-computed score', () => {
    const tile1 = { low: 3, high: 3 };
    const boardAfter1 = simulatePlacement(null, tile1, 'left');
    const score1 = computePlayScore(boardAfter1, DEFAULT_CONFIG);

    const moveLog: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(null),
        tile_played: '3|3',
        branch: 'left',
        hand_before: ['3|3', '1|2'],
        score_delta: score1 + 40, // tampered: claims 40 extra points that the engine did not award
      },
    ];

    const result = verifyPlayerMoveLog(moveLog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/does not match engine-computed score/);
      expect(result.entryIndex).toBe(0);
    }
  });

  it('rejects an impossible placement (tile does not match any open end)', () => {
    const tile1 = { low: 3, high: 3 };
    const boardAfter1 = simulatePlacement(null, tile1, 'left');

    const moveLog: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(boardAfter1), // open ends are both pip-3
        tile_played: '5|6', // does not match either open end
        branch: 'left',
        hand_before: ['5|6'],
        score_delta: 0,
      },
    ];

    const result = verifyPlayerMoveLog(moveLog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not a legal move/);
    }
  });

  it('rejects a claimed draw/pass when a legal play actually existed', () => {
    const moveLog: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: 'board:empty',
        tile_played: null,
        branch: 'pass',
        hand_before: ['3|3'], // a double is always playable on an empty board
        score_delta: 0,
      },
    ];

    const result = verifyPlayerMoveLog(moveLog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/legal play existed/);
    }
  });

  it('rejects a hand that is inconsistent with the previous move in the same hand', () => {
    const tile1 = { low: 3, high: 3 };
    const boardAfter1 = simulatePlacement(null, tile1, 'left');
    const score1 = computePlayScore(boardAfter1, DEFAULT_CONFIG);

    const moveLog: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(null),
        tile_played: '3|3',
        branch: 'left',
        hand_before: ['3|3', '3|5'],
        score_delta: score1,
      },
      {
        turn: 2,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(boardAfter1),
        tile_played: '3|5',
        branch: 'left',
        // Fabricated: should be ['3|5'] (what remained after turn 1), not a swapped hand.
        hand_before: ['4|4'],
        score_delta: 0,
      },
    ];

    const result = verifyPlayerMoveLog(moveLog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not a legal move|hand_before is not consistent/);
    }
  });

  it('allows a hand-ending move to score at or above (never below) the engine-computed base score', () => {
    const tile1 = { low: 3, high: 3 };
    const boardAfter1 = simulatePlacement(null, tile1, 'left');
    const score1 = computePlayScore(boardAfter1, DEFAULT_CONFIG);

    const belowBase: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(null),
        tile_played: '3|3',
        branch: 'left',
        hand_before: ['3|3'], // last tile in hand — going out
        score_delta: Math.max(0, score1 - 1), // impossible: below the engine base score
      },
    ];
    if (score1 > 0) {
      const result = verifyPlayerMoveLog(belowBase);
      expect(result.ok).toBe(false);
    }

    const atOrAboveBase: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(null),
        tile_played: '3|3',
        branch: 'left',
        hand_before: ['3|3'],
        score_delta: score1 + 15, // legitimate go-out bonus on top of the base score
      },
    ];
    expect(verifyPlayerMoveLog(atOrAboveBase)).toEqual({ ok: true });
  });

  // ─────────────────────────────────────────────────────────────────────
  // RT-2 (HARDENING_PLAN §9.3): a multi-draw turn collapsed into a single
  // GhostMoveLogEntry (the pre-fix client behavior — one entry standing in
  // for the whole draw sequence, using the stale pre-sequence hand_before)
  // leaves the tracked hand short by every draw beyond the first. Root
  // cause traced to playerGhostSync.ts / botGhostSync.ts's draw builders,
  // called exactly once per turn regardless of how many tiles were really
  // drawn — fixed to loop once per real draw. These two tests pin the
  // exact asymmetry that let the bug through unnoticed (lenient mode's
  // "unlogged boneyard draws" tolerance silently accepted the collapsed
  // shape) and confirm the fixed (looped) shape verifies under strict mode
  // with no tolerance needed.
  // ─────────────────────────────────────────────────────────────────────
  it('a two-draw turn collapsed into one entry (the pre-fix shape) is accepted leniently but rejected strictly', () => {
    const tile1 = { low: 3, high: 3 };
    const boardAfter1 = simulatePlacement(null, tile1, 'left');
    const score1 = computePlayScore(boardAfter1, DEFAULT_CONFIG);
    const boardAfter2 = simulatePlacement(boardAfter1, { low: 3, high: 6 }, 'left');
    const score2 = computePlayScore(boardAfter2, DEFAULT_CONFIG);

    // Real turn shape: play 3|3, then two real draws (0|4, then 3|6) before
    // a legal play appears, then play 3|6. Collapsed into ONE draw entry
    // using the hand as it stood BEFORE either draw (the bug) instead of
    // one entry per real draw.
    const collapsedLog: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(null),
        tile_played: '3|3',
        branch: 'left',
        hand_before: ['3|3', '1|2', '2|2'],
        score_delta: score1,
      },
      {
        turn: 2,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(boardAfter1),
        tile_played: null,
        branch: 'draw',
        // Bug: stands in for BOTH real draws, using the hand as it stood
        // before either one — never updated per step.
        hand_before: ['1|2', '2|2'],
        score_delta: 0,
      },
      {
        turn: 3,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(boardAfter1),
        tile_played: '3|6',
        branch: 'left',
        // The REAL hand after both draws.
        hand_before: ['1|2', '2|2', '0|4', '3|6'],
        score_delta: score2,
      },
    ];

    // Guardrail #4 (INV-18): strict is the default now, so a test that means
    // to exercise the legacy lenient path must opt out visibly.
    const lenient = verifyPlayerMoveLog(collapsedLog, { strictHandContinuity: false });
    expect(lenient).toEqual({ ok: true });

    const strict = verifyPlayerMoveLog(collapsedLog, { strictHandContinuity: true });
    expect(strict.ok).toBe(false);
    if (!strict.ok) {
      expect(strict.reason).toMatch(/hand_before is not consistent/);
    }
  });

  it('the same turn logged one entry per real draw (the fixed shape) verifies cleanly under strict mode', () => {
    const tile1 = { low: 3, high: 3 };
    const boardAfter1 = simulatePlacement(null, tile1, 'left');
    const score1 = computePlayScore(boardAfter1, DEFAULT_CONFIG);
    const boardAfter2 = simulatePlacement(boardAfter1, { low: 3, high: 6 }, 'left');
    const score2 = computePlayScore(boardAfter2, DEFAULT_CONFIG);

    const fixedLog: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(null),
        tile_played: '3|3',
        branch: 'left',
        hand_before: ['3|3', '1|2', '2|2'],
        score_delta: score1,
      },
      {
        turn: 2,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(boardAfter1),
        tile_played: null,
        branch: 'draw',
        hand_before: ['1|2', '2|2'],
        drawn_tile: '0|4',
        score_delta: 0,
      },
      {
        turn: 3,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(boardAfter1),
        tile_played: null,
        branch: 'draw',
        hand_before: ['1|2', '2|2', '0|4'],
        drawn_tile: '3|6',
        score_delta: 0,
      },
      {
        turn: 4,
        hand_number: 1,
        actor: 'you',
        board_state: serializeBoard(boardAfter1),
        tile_played: '3|6',
        branch: 'left',
        hand_before: ['1|2', '2|2', '0|4', '3|6'],
        score_delta: score2,
      },
    ];

    expect(verifyPlayerMoveLog(fixedLog, { strictHandContinuity: true })).toEqual({ ok: true });
  });

  it('ignores ghost-actor entries entirely', () => {
    const moveLog: GhostMoveLogEntry[] = [
      {
        turn: 1,
        hand_number: 1,
        actor: 'ghost',
        board_state: 'board:empty',
        tile_played: '6|6',
        branch: 'left',
        hand_before: ['6|6'],
        score_delta: 9999, // would be nonsense if checked, but ghost moves are not verified here
      },
    ];

    expect(verifyPlayerMoveLog(moveLog)).toEqual({ ok: true });
  });
});
