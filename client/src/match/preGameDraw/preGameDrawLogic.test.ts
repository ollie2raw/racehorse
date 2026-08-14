// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  normalizePreGameDrawTile,
  toPreGameDrawTileId,
  tilePipSum,
  initPreGameDraw,
  isTieHoldState,
  commitTieRedraw,
  applyPlayerPick,
  applyScriptedPlayerPick,
  applyOpponentPick,
  simulateDrawRound,
  comparePreGameDrawTiles,
} from './preGameDrawLogic';
import type { Tile } from '../../types';

describe('preGameDrawLogic', () => {
  const dummyTile = (low: number, high: number): Tile => ({ low, high });
  const exactTieState = () => {
    const state = initPreGameDraw();
    state.tiles[0] = { ...state.tiles[0], id: 'tie-a', tile: dummyTile(3, 3) };
    state.tiles[1] = { ...state.tiles[1], id: 'tie-b', tile: dummyTile(3, 3) };
    return state;
  };

  describe('normalizePreGameDrawTile', () => {
    it('1. normalizes array input and ensures low <= high', () => {
      expect(normalizePreGameDrawTile([5, 2])).toEqual({ low: 2, high: 5 });
    });

    it('2. normalizes object input and ensures low <= high', () => {
      expect(normalizePreGameDrawTile({ low: 6, high: 4 })).toEqual({ low: 4, high: 6 });
    });

    it('3. returns null for non-finite values in arrays', () => {
      expect(normalizePreGameDrawTile([NaN, 2])).toBeNull();
      expect(normalizePreGameDrawTile([Infinity, 2])).toBeNull();
    });

    it('4. returns null for non-finite values in objects', () => {
      expect(normalizePreGameDrawTile({ low: NaN, high: 2 })).toBeNull();
    });

    it('5. returns null for out of bounds pips (<0 or >6)', () => {
      expect(normalizePreGameDrawTile([-1, 3])).toBeNull();
      expect(normalizePreGameDrawTile([7, 3])).toBeNull();
    });

    it('6. returns null for non-integer pips', () => {
      expect(normalizePreGameDrawTile([1.5, 3])).toBeNull();
    });

    it('7. returns null for null/undefined/non-object inputs', () => {
      expect(normalizePreGameDrawTile(null)).toBeNull();
      expect(normalizePreGameDrawTile('not-a-tile')).toBeNull();
    });
  });

  describe('toPreGameDrawTileId', () => {
    it('8. returns low-high string for valid tile', () => {
      expect(toPreGameDrawTileId(dummyTile(5, 2))).toBe('2-5');
    });

    it('9. returns null for invalid tile input', () => {
      expect(toPreGameDrawTileId(null)).toBeNull();
    });
  });

  describe('tilePipSum', () => {
    it('10. sums pips correctly', () => {
      expect(tilePipSum(dummyTile(3, 4))).toBe(7);
      expect(tilePipSum(dummyTile(0, 0))).toBe(0);
    });
  });

  describe('comparePreGameDrawTiles', () => {
    it('uses the higher single pip to break equal totals', () => {
      expect(comparePreGameDrawTiles(dummyTile(2, 6), dummyTile(3, 5))).toBeGreaterThan(0);
      expect(comparePreGameDrawTiles(dummyTile(3, 5), dummyTile(2, 6))).toBeLessThan(0);
    });

    it('returns zero only when both draw values are identical', () => {
      expect(comparePreGameDrawTiles(dummyTile(2, 6), dummyTile(6, 2))).toBe(0);
    });
  });

  describe('initPreGameDraw', () => {
    it('11. sets up initial draw state with 28 tiles', () => {
      const state = initPreGameDraw();
      expect(state.phase).toBe('pick-player');
      expect(state.tiles.length).toBe(28);
      expect(state.tiles.every((slot) => !slot.revealed && !slot.outOfPlay)).toBe(true);
      expect(state.currentRound.you).toBeNull();
      expect(state.currentRound.bot).toBeNull();
    });

    it('12. throws if deck length is not 28', () => {
      expect(() => initPreGameDraw([dummyTile(1, 1)])).toThrow('requires 28 tiles');
    });
  });

  describe('applyPlayerPick', () => {
    it('13. transitions phase and reveals slot', () => {
      const state = initPreGameDraw();
      const firstId = state.tiles[0].id;
      const next = applyPlayerPick(state, firstId);
      expect(next.phase).toBe('pick-opponent');
      expect(next.tiles.find((s) => s.id === firstId)!.revealed).toBe(true);
      expect(next.currentRound.you).not.toBeNull();
      expect(next.currentRound.you!.tileId).toBe(firstId);
    });

    it('14. throws if picking in wrong phase', () => {
      const state = initPreGameDraw();
      const next = applyPlayerPick(state, state.tiles[0].id);
      expect(() => applyPlayerPick(next, state.tiles[1].id)).toThrow('Cannot pick player tile while phase is');
    });
  });

  describe('applyScriptedPlayerPick', () => {
    it('15. maps tapped tile to scripted tile correctly', () => {
      const state = initPreGameDraw();
      const tappedId = state.tiles[0].id;
      const scriptedId = state.tiles[1].id;
      const next = applyScriptedPlayerPick(state, tappedId, scriptedId);
      expect(next.phase).toBe('pick-opponent');
      // The tapped tile is revealed with the scripted tile content
      const tappedSlot = next.tiles.find((s) => s.id === tappedId)!;
      const scriptedSlot = state.tiles.find((s) => s.id === scriptedId)!;
      expect(tappedSlot.revealed).toBe(true);
      expect(tappedSlot.tile).toEqual(scriptedSlot.tile);
      // The original scripted position stays occupied by the tapped tile.
      const swappedScriptedSlot = next.tiles.find((s) => s.id === scriptedId)!;
      expect(swappedScriptedSlot.outOfPlay).toBe(false);
      expect(swappedScriptedSlot.revealed).toBe(false);
      expect(swappedScriptedSlot.tile).toEqual(state.tiles.find((s) => s.id === tappedId)!.tile);
      expect(next.tiles.filter((slot) => !slot.outOfPlay)).toHaveLength(28);
    });
  });

  describe('applyOpponentPick', () => {
    it('16. resolves player winner if player draws higher tile', () => {
      const state = initPreGameDraw();
      // find a high tile and a low tile in state
      const highSlot = state.tiles.find((s) => tilePipSum(s.tile) === 12)!; // 6-6
      const lowSlot = state.tiles.find((s) => tilePipSum(s.tile) === 1)!; // 0-1
      const afterPlayer = applyPlayerPick(state, highSlot.id);
      const afterOpponent = applyOpponentPick(afterPlayer, lowSlot.id);

      expect(afterOpponent.phase).toBe('resolved');
      expect(afterOpponent.winner).toBe('you');
      expect(afterOpponent.remainingDeck!.length).toBe(26);
    });

    it('17. resolves bot winner if opponent draws higher tile', () => {
      const state = initPreGameDraw();
      const highSlot = state.tiles.find((s) => tilePipSum(s.tile) === 12)!; // 6-6
      const lowSlot = state.tiles.find((s) => tilePipSum(s.tile) === 1)!; // 0-1
      const afterPlayer = applyPlayerPick(state, lowSlot.id);
      const afterOpponent = applyOpponentPick(afterPlayer, highSlot.id);

      expect(afterOpponent.phase).toBe('resolved');
      expect(afterOpponent.winner).toBe('bot');
    });

    it('18. triggers tie hold state if pip sums are equal', () => {
      const state = exactTieState();
      const tile1 = state.tiles.find((s) => s.id === 'tie-a')!;
      const tile2 = state.tiles.find((s) => s.id === 'tie-b')!;

      const afterPlayer = applyPlayerPick(state, tile1.id);
      const afterOpponent = applyOpponentPick(afterPlayer, tile2.id);

      expect(afterOpponent.phase).toBe('pick-opponent'); // remains in pick-opponent until redraw
      expect(isTieHoldState(afterOpponent)).toBe(true);
      expect(afterOpponent.winner).toBeNull();
    });

    it('resolves equal totals by the higher individual pip', () => {
      const state = initPreGameDraw();
      const player = state.tiles.find((s) => s.id === '2-6')!;
      const opponent = state.tiles.find((s) => s.id === '3-5')!;
      const afterPlayer = applyPlayerPick(state, player.id);
      const afterOpponent = applyOpponentPick(afterPlayer, opponent.id);

      expect(afterOpponent.phase).toBe('resolved');
      expect(afterOpponent.winner).toBe('you');
    });
  });

  describe('commitTieRedraw', () => {
    it('19. resets state to pick-player and marks tie tiles outOfPlay', () => {
      const state = exactTieState();
      const tile1 = state.tiles.find((s) => s.id === 'tie-a')!;
      const tile2 = state.tiles.find((s) => s.id === 'tie-b')!;

      const afterPlayer = applyPlayerPick(state, tile1.id);
      const afterOpponent = applyOpponentPick(afterPlayer, tile2.id);
      const redrawn = commitTieRedraw(afterOpponent);

      expect(redrawn.phase).toBe('pick-player');
      expect(redrawn.tiles.find((s) => s.id === tile1.id)!.outOfPlay).toBe(true);
      expect(redrawn.tiles.find((s) => s.id === tile2.id)!.outOfPlay).toBe(true);
      expect(redrawn.currentRound.you).toBeNull();
      expect(redrawn.currentRound.bot).toBeNull();
    });
  });

  describe('simulateDrawRound', () => {
    it('20. simulates round and resolves winner', () => {
      const state = initPreGameDraw();
      const highSlot = state.tiles.find((s) => tilePipSum(s.tile) === 12)!;
      const lowSlot = state.tiles.find((s) => tilePipSum(s.tile) === 1)!;
      const final = simulateDrawRound(state, highSlot.id, lowSlot.id);
      expect(final.phase).toBe('resolved');
      expect(final.winner).toBe('you');
    });

    it('21. simulates round with tie and automatically redraws', () => {
      const state = exactTieState();
      const tile1 = state.tiles.find((s) => s.id === 'tie-a')!;
      const tile2 = state.tiles.find((s) => s.id === 'tie-b')!;
      const final = simulateDrawRound(state, tile1.id, tile2.id);
      // should auto-commit tie redraw
      expect(final.phase).toBe('pick-player');
      expect(final.tiles.find((s) => s.id === tile1.id)!.outOfPlay).toBe(true);
      expect(final.tiles.find((s) => s.id === tile2.id)!.outOfPlay).toBe(true);
    });
  });
});
