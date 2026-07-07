# Phase: Daily Puzzle Cleanup — Sub-phase 8b, Target 1: Shared Solo Hand Dock

## Prerequisite confirmation

**Does `docs/phase-dailypuzzle-render-tree-sizing-report.md` exist at that exact path?** **YES**

---

## Summary

| Item | Result |
|------|--------|
| New component | `client/src/dailyPuzzle/DailyPuzzleSoloHandDock.tsx` (67 LOC) |
| `DailyPuzzleScreen.tsx` LOC | 1178 → **1147** (−31) |
| `DailyPuzzleLadderScreen.tsx` LOC | 1093 → **1070** (−23) |
| Vitest files | 56 → **57** (+1) |
| Vitest tests | 492 → **496** (+4) |
| Build | **Pass** (`✓ built in 5.50s`) |
| Behavior / DOM | Preserved — differences parameterized via props |

---

## Investigation

### 1. Full current hand-dock JSX (pre-extraction, from source at task start)

#### `DailyPuzzleScreen.tsx` (was lines 1051–1095)

```tsx
        handDock={
          <div className="tray-rail">
            <div className="tray-center">
              <div className={`hand-container ${handCompactStacked ? 'is-stacked has-single-row' : 'has-single-row'}`}>
                {(handCompactStacked
                  ? [
                      runtimeState.players.you.hand.slice(
                        0,
                        Math.ceil(runtimeState.players.you.hand.length / 2),
                      ),
                      runtimeState.players.you.hand.slice(
                        Math.ceil(runtimeState.players.you.hand.length / 2),
                      ),
                    ]
                  : [runtimeState.players.you.hand]
                ).map((row, rowIdx) => (
                  <div key={`daily-hand-row-${rowIdx}`} className="hand-row">
                    {row.map((tile, idx) => {
                      const playable = playableTileKeys.has(tileKey(tile));
                      const inProgress = status === 'IN_PROGRESS';
                      const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;

                      return (
                        <DominoTile
                          key={`daily-curated-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                          tile={tile}
                          size={handTileSize}
                          rotation={0}
                          selected={isSelected}
                          highlight={inProgress && playable}
                          unplayable={inProgress && !playable}
                          disabled={!inProgress}
                          onClick={() => {
                            if (!inProgress || !playable) return;
                            setSelectedTile(tile);
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        }
```

#### `DailyPuzzleLadderScreen.tsx` (was lines 1050–1088)

```tsx
          handDock={
            <div className="tray-rail">
              <div className="tray-center">
                <div className={`hand-container ${handCompactStacked ? 'is-stacked has-single-row' : 'has-single-row'}`}>
                  {(handCompactStacked
                    ? [
                        playingState.players.you.hand.slice(0, Math.ceil(playingState.players.you.hand.length / 2)),
                        playingState.players.you.hand.slice(Math.ceil(playingState.players.you.hand.length / 2)),
                      ]
                    : [playingState.players.you.hand]
                  ).map((row, rowIdx) => (
                    <div key={`ladder-hand-row-${rowIdx}`} className="hand-row">
                      {row.map((tile, idx) => {
                        const playable = legalMoves.some((candidate) => candidate.tile && tileEquals(candidate.tile, tile));
                        const inProgress = status === 'IN_PROGRESS';
                        const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;
                        return (
                          <DominoTile
                            key={`ladder-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                            tile={tile}
                            size={handTileSize}
                            rotation={0}
                            selected={isSelected}
                            highlight={inProgress && playable}
                            unplayable={inProgress && !playable}
                            disabled={!inProgress}
                            onClick={() => {
                              if (!inProgress || !playable) return;
                              setSelectedTile(tile);
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          }
```

---

### 2. Line-by-line diff classification

| Region | Classification | Notes |
|--------|----------------|-------|
| `tray-rail` / `tray-center` wrappers | **(a) byte-identical** | Same class names and nesting |
| `hand-container` class expression | **(a) byte-identical** | `` `hand-container ${handCompactStacked ? 'is-stacked has-single-row' : 'has-single-row'}` `` |
| Row split when `handCompactStacked` | **(b) functionally identical** | Same slice math; legacy formats slices across more lines |
| Hand array source | **(b) functionally identical** | `runtimeState.players.you.hand` vs `playingState.players.you.hand` (`playingState = runtimeState!`) |
| Row `key` prefix | **(c) genuinely different** | `daily-hand-row` vs `ladder-hand-row` |
| Tile `key` prefix | **(c) genuinely different** | `daily-curated` vs `ladder` |
| Playable detection | **(c) genuinely different** | `playableTileKeys.has(tileKey(tile))` vs `legalMoves.some(...)` |
| Blank line before `return (` in tile map | **(b) cosmetic** | Legacy only; no runtime effect |
| `DominoTile` props (`size`, `rotation`, highlight/unplayable/disabled logic) | **(a) byte-identical** | |
| `onClick` guard + `setSelectedTile(tile)` | **(a) byte-identical** | |
| `inProgress` derivation | **(a) byte-identical** | `status === 'IN_PROGRESS'` |

**No feature exists on one screen only** (no extra empty-state, no different disabled rules, no different handler arity). All case **(c)** differences are parameterized without changing behavior.

---

### 3. Shared component prop interface (case c preservation)

| Prop | `DailyPuzzleScreen` passes | `DailyPuzzleLadderScreen` passes |
|------|------------------------------|----------------------------------|
| `hand` | `runtimeState.players.you.hand` | `playingState.players.you.hand` |
| `handTileSize` | from `useResponsiveHandTileSize` | same |
| `handCompactStacked` | from `useResponsiveHandTileSize` | same |
| `selectedTile` | `selectedTile` | `selectedTile` |
| `inProgress` | `status === 'IN_PROGRESS'` | `status === 'IN_PROGRESS'` |
| `isTilePlayable` | `(tile) => playableTileKeys.has(tileKey(tile))` | `(tile) => legalMoves.some((candidate) => candidate.tile && tileEquals(candidate.tile, tile))` |
| `onSelectTile` | `setSelectedTile` | `setSelectedTile` |
| `handRowKeyPrefix` | `"daily-hand-row"` | `"ladder-hand-row"` |
| `tileKeyPrefix` | `"daily-curated"` | `"ladder"` |

**Hook placement:** Both screens call `useResponsiveHandTileSize(runtimeState?.players.you.hand.length)` with the **same argument expression**. The hook call **stays in each screen** (presentational component receives outputs as props only).

---

### 4. Grep — other consumers of this JSX shape

Searched `client/src` for `tray-rail`, `hand-container`, `handCompactStacked`, `handTileSize`.

| Location | Similar? | Correctly excluded? |
|----------|----------|---------------------|
| `DailyPuzzleScreen.tsx` | **Target consumer** | N/A |
| `DailyPuzzleLadderScreen.tsx` | **Target consumer** | N/A |
| `practice/NoBrainerLabScreen.tsx` | Partial | **Yes** — extra `nbl-tray` / `wl-hand-area` wrappers; always `has-single-row` (no stacked split); fixed `handTileSize = count >= 15 ? 48 : 56` (not `useResponsiveHandTileSize`); `practiceState.remainingHand` / `practiceState.status === 'playing'` |
| `multiplayer/MultiplayerGameShell.tsx` | No inline dock | **Yes** — owns sizing state (`useState(44)`, `handCompactStacked = myHand.length > 8`); renders via `LiveMatchScreen` → `HandView` |
| `match/LiveMatchScreen.tsx` | Different component | **Yes** — uses `HandView`, pre-game draw empty dock, `handAreaRef` / `trayCenterRef`, draw pulse |
| `bot/BotHandTray.tsx` | Related but frozen | **Yes** — `is-stacked` without `has-single-row`; guided-tile wraps; bot-only props |
| `bot/BotMatchScreenView.tsx` | Delegates to BotHandTray | **Yes** — frozen `bot/**` |
| CSS / route wiring files | Styles only | N/A |

**Conclusion:** Only the two Daily Puzzle in-play screens had the shared solo dock shape targeted by sub-phase 8b. No additional consumers require inclusion.

---

### 5. Call-site prop inventory (real variable names)

#### `DailyPuzzleScreen.tsx`

| Concept | Current variable / expression |
|---------|-------------------------------|
| Hand tiles | `runtimeState.players.you.hand` |
| Tile size | `handTileSize` (`useResponsiveHandTileSize`) |
| Stacked layout | `handCompactStacked` (`useResponsiveHandTileSize`) |
| Selection | `selectedTile`, `setSelectedTile` |
| Play in progress | `status === 'IN_PROGRESS'` |
| Playable set | `playableTileKeys` (memo from `legalMoves` + `tileKey`) |
| Legal moves source | `legalMoves` (memo) — used only via `playableTileKeys` at dock |
| Tile equality helper | `tileEquals`, `tileKey` — used in `playableTileKeys` memo and inside dock via `isTilePlayable` |

#### `DailyPuzzleLadderScreen.tsx`

| Concept | Current variable / expression |
|---------|-------------------------------|
| Hand tiles | `playingState.players.you.hand` (`playingState = runtimeState!`) |
| Tile size | `handTileSize` (`useResponsiveHandTileSize`) |
| Stacked layout | `handCompactStacked` (`useResponsiveHandTileSize`) |
| Selection | `selectedTile`, `setSelectedTile` |
| Play in progress | `status === 'IN_PROGRESS'` |
| Playable check | `legalMoves` (memo) + `tileEquals` inline in `isTilePlayable` |

---

## Full source — new shared component

`client/src/dailyPuzzle/DailyPuzzleSoloHandDock.tsx`:

```tsx
import { DominoTile } from '../components';
import { tileEquals } from '../game/tileUtils';
import type { Tile } from '../types';

export type DailyPuzzleSoloHandDockProps = {
  hand: Tile[];
  handTileSize: number;
  handCompactStacked: boolean;
  selectedTile: Tile | null;
  inProgress: boolean;
  isTilePlayable: (tile: Tile) => boolean;
  onSelectTile: (tile: Tile) => void;
  handRowKeyPrefix: string;
  tileKeyPrefix: string;
};

export function DailyPuzzleSoloHandDock({
  hand,
  handTileSize,
  handCompactStacked,
  selectedTile,
  inProgress,
  isTilePlayable,
  onSelectTile,
  handRowKeyPrefix,
  tileKeyPrefix,
}: DailyPuzzleSoloHandDockProps) {
  const handRows = handCompactStacked
    ? [
        hand.slice(0, Math.ceil(hand.length / 2)),
        hand.slice(Math.ceil(hand.length / 2)),
      ]
    : [hand];

  return (
    <div className="tray-rail">
      <div className="tray-center">
        <div className={`hand-container ${handCompactStacked ? 'is-stacked has-single-row' : 'has-single-row'}`}>
          {handRows.map((row, rowIdx) => (
            <div key={`${handRowKeyPrefix}-${rowIdx}`} className="hand-row">
              {row.map((tile, idx) => {
                const playable = isTilePlayable(tile);
                const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;

                return (
                  <DominoTile
                    key={`${tileKeyPrefix}-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                    tile={tile}
                    size={handTileSize}
                    rotation={0}
                    selected={isSelected}
                    highlight={inProgress && playable}
                    unplayable={inProgress && !playable}
                    disabled={!inProgress}
                    onClick={() => {
                      if (!inProgress || !playable) return;
                      onSelectTile(tile);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## Before / after — screen hand-dock sections

### `DailyPuzzleScreen.tsx`

**Before:** See investigation section 1 (inline `tray-rail` block).

**After (current):**

```tsx
        handDock={
          <DailyPuzzleSoloHandDock
            hand={runtimeState.players.you.hand}
            handTileSize={handTileSize}
            handCompactStacked={handCompactStacked}
            selectedTile={selectedTile}
            inProgress={status === 'IN_PROGRESS'}
            isTilePlayable={(tile) => playableTileKeys.has(tileKey(tile))}
            onSelectTile={setSelectedTile}
            handRowKeyPrefix="daily-hand-row"
            tileKeyPrefix="daily-curated"
          />
        }
```

Import added: `import { DailyPuzzleSoloHandDock } from './DailyPuzzleSoloHandDock';`  
`DominoTile` removed from screen import (only used in hand dock).

---

### `DailyPuzzleLadderScreen.tsx`

**Before:** See investigation section 1 (inline `tray-rail` block).

**After (current):**

```tsx
          handDock={
            <DailyPuzzleSoloHandDock
              hand={playingState.players.you.hand}
              handTileSize={handTileSize}
              handCompactStacked={handCompactStacked}
              selectedTile={selectedTile}
              inProgress={status === 'IN_PROGRESS'}
              isTilePlayable={(tile) =>
                legalMoves.some((candidate) => candidate.tile && tileEquals(candidate.tile, tile))
              }
              onSelectTile={setSelectedTile}
              handRowKeyPrefix="ladder-hand-row"
              tileKeyPrefix="ladder"
            />
          }
```

Import added: `import { DailyPuzzleSoloHandDock } from './DailyPuzzleSoloHandDock';`  
`DominoTile` removed from screen import.

---

## Full source — new test file

`client/src/dailyPuzzle/DailyPuzzleSoloHandDock.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DailyPuzzleSoloHandDock } from './DailyPuzzleSoloHandDock';
import type { Tile } from '../types';

const hand: Tile[] = [
  { low: 1, high: 2 },
  { low: 3, high: 4 },
];

function renderDock(overrides: Partial<Parameters<typeof DailyPuzzleSoloHandDock>[0]> = {}) {
  const onSelectTile = vi.fn();
  const props = {
    hand,
    handTileSize: 52,
    handCompactStacked: false,
    selectedTile: null,
    inProgress: true,
    isTilePlayable: () => true,
    onSelectTile,
    handRowKeyPrefix: 'daily-hand-row',
    tileKeyPrefix: 'daily-curated',
    ...overrides,
  };
  const view = render(<DailyPuzzleSoloHandDock {...props} />);
  return { onSelectTile, ...view };
}

describe('DailyPuzzleSoloHandDock', () => {
  it('renders tray structure and one hand row by default', () => {
    const { container } = renderDock();
    expect(container.querySelector('.tray-rail')).toBeTruthy();
    expect(container.querySelector('.tray-center')).toBeTruthy();
    expect(container.querySelector('.hand-container.has-single-row')).toBeTruthy();
    expect(container.querySelectorAll('.hand-row')).toHaveLength(1);
  });

  it('splits into two rows when compact stacked', () => {
    const longHand = Array.from({ length: 8 }, (_, idx) => ({ low: idx, high: idx }));
    const { container } = renderDock({ hand: longHand, handCompactStacked: true });
    expect(container.querySelector('.hand-container.is-stacked.has-single-row')).toBeTruthy();
    expect(container.querySelectorAll('.hand-row')).toHaveLength(2);
  });

  it('selects playable tiles only while in progress', () => {
    const onSelectTile = vi.fn();
    render(
      <DailyPuzzleSoloHandDock
        hand={hand}
        handTileSize={52}
        handCompactStacked={false}
        selectedTile={null}
        inProgress={true}
        isTilePlayable={(tile) => tile.low === 1}
        onSelectTile={onSelectTile}
        handRowKeyPrefix="ladder-hand-row"
        tileKeyPrefix="ladder"
      />,
    );

    const tiles = screen.getAllByRole('button');
    fireEvent.click(tiles[0]);
    fireEvent.click(tiles[1]);
    expect(onSelectTile).toHaveBeenCalledTimes(1);
    expect(onSelectTile).toHaveBeenCalledWith(hand[0]);
  });

  it('does not select tiles when not in progress', () => {
    const { onSelectTile } = renderDock({ inProgress: false, isTilePlayable: () => true });
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onSelectTile).not.toHaveBeenCalled();
  });
});
```

**Test precedent:** Repo already uses `@testing-library/react` for component tests (`ErrorBoundary.test.tsx`, `useTileSelection.test.tsx`). This extraction follows that pattern with prop-driven structure and click-behavior assertions.

---

## Build and test results

| Metric | Before | After |
|--------|--------|-------|
| Vitest test files | 56 | **57** |
| Vitest tests | 492 | **496** |
| Build | Pass | **Pass** |

Command: `npm test -- --run` → `Test Files 57 passed (57)`, `Tests 496 passed (496)`  
Command: `npm run build` → `✓ built in 5.50s`

---

## Files touched

| File | Change |
|------|--------|
| `client/src/dailyPuzzle/DailyPuzzleSoloHandDock.tsx` | **Created** — shared presentational hand dock |
| `client/src/dailyPuzzle/DailyPuzzleSoloHandDock.test.tsx` | **Created** — 4 component tests |
| `client/src/dailyPuzzle/DailyPuzzleScreen.tsx` | Replaced inline hand dock; import wiring |
| `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx` | Replaced inline hand dock; import wiring |
| `docs/phase-dailypuzzle-shared-hand-dock-component-report.md` | **Created** — this report |

**Frozen / out-of-scope files:** Not modified.

---

## Report path confirmation

**This file exists at:** `docs/phase-dailypuzzle-shared-hand-dock-component-report.md`