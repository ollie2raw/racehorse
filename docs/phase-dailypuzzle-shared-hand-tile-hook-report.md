# Phase: Daily Puzzle Cleanup Sub-phase 1 — Shared Hand-Tile Responsive Sizing Hook

## Goal

Extract the duplicated `useEffect` hand-tile sizing logic from `DailyPuzzleScreen.tsx` and `DailyPuzzleLadderScreen.tsx` into a single shared hook. Zero behavior change. Touch **only** the sizing state/effect in those two files.

## Summary

| Item | Result |
|------|--------|
| New hook | `client/src/dailyPuzzle/useResponsiveHandTileSize.ts` (48 LOC) |
| New tests | `client/src/dailyPuzzle/useResponsiveHandTileSize.test.ts` (86 LOC, 8 tests) |
| Call sites updated | `DailyPuzzleScreen.tsx`, `DailyPuzzleLadderScreen.tsx` |
| Behavior change | **None** |

---

## Grep — similar patterns elsewhere

**Command:**

```bash
rg 'handTileSize|handCompactStacked|forceTwoRows|maxTileSize = 56' client/src
```

| Location | Same formula? |
|----------|---------------|
| `dailyPuzzle/DailyPuzzleScreen.tsx` | **Extracted** (this task) |
| `dailyPuzzle/DailyPuzzleLadderScreen.tsx` | **Extracted** (this task) |
| `multiplayer/MultiplayerGameShell.tsx` | Different constants (`maxTileSize` 42/50/68, `tileCount > 9`) |
| `modules/match/hooks/useMatchPresentation.ts` | Different breakpoints and caps |
| `bot/BotMatchScreenView.tsx` | Consumes view-model props, no inline resize effect |
| `practice/NoBrainerLabScreen.tsx` | Static `handTileCount >= 15 ? 48 : 56` |

**Conclusion:** The `maxTileSize = 56`, `innerWidth <= 900`, `tileCount > 7` two-row rule is **Daily Puzzle play-screen specific**. Hook colocated under `client/src/dailyPuzzle/` — not `client/src/ui/`.

---

## Byte-for-byte diff of the two original effects

### `DailyPuzzleScreen.tsx` (before)

```typescript
  useEffect(() => {
    if (!runtimeState) return;
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, runtimeState.players.you.hand.length);
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      
      const forceTwoRows = !isLandscape && isMobileWidth && tileCount > 7;
      
      const maxTileSize = 56;
      let tileWidth = maxTileSize;
      
      const containerWidth = window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      
      tileWidth = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));

      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [runtimeState?.players.you.hand.length]);
```

### `DailyPuzzleLadderScreen.tsx` (before)

```typescript
  useEffect(() => {
    if (!runtimeState) return;
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, runtimeState.players.you.hand.length);
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      const forceTwoRows = !isLandscape && isMobileWidth && tileCount > 7;
      const maxTileSize = 56;
      const containerWidth = window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      const tileWidth = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));
      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
    };
    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [runtimeState?.players.you.hand.length]);
```

### Identical-or-different verdict

| Aspect | Status |
|--------|--------|
| Constants (`56`, `900`, `7`, `-40`, `-20`) | **Identical** |
| Formula (`tileCount`, `isLandscape`, `isMobileWidth`, `forceTwoRows`, `effectiveLen`, `Math.min`/`Math.floor`) | **Identical** |
| Dependency array | **Identical** — `[runtimeState?.players.you.hand.length]` |
| Resize listener setup/cleanup | **Identical** |
| Early guard | **Identical** — `if (!runtimeState) return` |
| Cosmetic differences only | DailyPuzzleScreen uses `let tileWidth = maxTileSize` then reassigns; LadderScreen uses `const tileWidth = Math.min(...)` directly — **functionally equivalent** (intermediate assignment is overwritten immediately) |
| Extra blank lines in DailyPuzzleScreen | Whitespace only |

**No hook parameter needed beyond hand length.** The only behavioral input is `runtimeState.players.you.hand.length`; the `if (!runtimeState) return` guard maps to `handLength === undefined` (when `runtimeState` is null, `runtimeState?.players.you.hand.length` is `undefined`).

---

## Hook signature

```typescript
export function useResponsiveHandTileSize(handLength: number | undefined): {
  handTileSize: number;
  handCompactStacked: boolean;
};
```

- **`handLength: number | undefined`** — call sites pass `runtimeState?.players.you.hand.length` (same dependency expression as before).
- **`undefined`** — skips effect body (no resize listener), state remains initial `{ handTileSize: 56, handCompactStacked: false }` — matches prior `if (!runtimeState) return`.
- Pure formula exported as `computeResponsiveHandTileSize(handLength, innerWidth, innerHeight)` for unit tests.

---

## Before/after — `DailyPuzzleScreen.tsx` (affected sections only)

### Before — state

```typescript
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
```

### After — state + hook (effect removed)

```typescript
  const [runtimeState, setRuntimeState] = useState<BotMatchState | null>(null);
  const { handTileSize, handCompactStacked } = useResponsiveHandTileSize(runtimeState?.players.you.hand.length);
```

Import added:

```typescript
import { useResponsiveHandTileSize } from './useResponsiveHandTileSize';
```

The 25-line `useEffect` block listed in the diff section above was **removed** unchanged in behavior.

---

## Before/after — `DailyPuzzleLadderScreen.tsx` (affected sections only)

### Before — state

```typescript
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
```

### After — state + hook (effect removed)

```typescript
  const [runtimeState, setRuntimeState] = useState<BotMatchState | null>(null);
  const { handTileSize, handCompactStacked } = useResponsiveHandTileSize(runtimeState?.players.you.hand.length);
```

Import added:

```typescript
import { useResponsiveHandTileSize } from './useResponsiveHandTileSize';
```

The 18-line `useEffect` block listed in the diff section above was **removed**.

---

## Full source — new hook

`client/src/dailyPuzzle/useResponsiveHandTileSize.ts`:

```typescript
import { useEffect, useState } from 'react';

export type ResponsiveHandTileSize = {
  handTileSize: number;
  handCompactStacked: boolean;
};

export function computeResponsiveHandTileSize(
  handLength: number,
  innerWidth: number,
  innerHeight: number,
): ResponsiveHandTileSize {
  const tileCount = Math.max(1, handLength);
  const isLandscape = innerWidth > innerHeight;
  const isMobileWidth = innerWidth <= 900;
  const forceTwoRows = !isLandscape && isMobileWidth && tileCount > 7;
  const maxTileSize = 56;
  const containerWidth = innerWidth - 40;
  const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
  const handTileSize = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));
  return { handTileSize, handCompactStacked: forceTwoRows };
}

/**
 * Responsive hand-dock tile sizing for Daily Puzzle play screens.
 * Pass `undefined` when runtime state is absent (matches prior `if (!runtimeState) return` guard).
 */
export function useResponsiveHandTileSize(handLength: number | undefined): ResponsiveHandTileSize {
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);

  useEffect(() => {
    if (handLength === undefined) return;
    const updateHandTileSize = () => {
      const { handTileSize: tileWidth, handCompactStacked: forceTwoRows } = computeResponsiveHandTileSize(
        handLength,
        window.innerWidth,
        window.innerHeight,
      );
      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
    };
    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [handLength]);

  return { handTileSize, handCompactStacked };
}
```

---

## Full source — new test file

See `client/src/dailyPuzzle/useResponsiveHandTileSize.test.ts` (86 LOC).

| Test | Coverage |
|------|----------|
| `landscape wide: single row, size capped at 56` | 1200×800, 5 tiles |
| `mobile narrow portrait with >7 tiles: stacked two-row layout` | 400×800, 8 tiles → `handCompactStacked: true` |
| `mobile narrow portrait with <=7 tiles: single row, computed width below cap` | 320×600, 5 tiles → `handTileSize: 52` |
| `mobile narrow with >7 tiles: halves effective length for width math` | 320×600, 10 tiles → stacked + `52` |
| `initializes from hand length on mount` | Hook state + listener registered |
| `recomputes on resize` | `dispatchEvent('resize')` updates state |
| `removes resize listener on unmount` | Same handler passed to `removeEventListener` |
| `skips listener setup when hand length is undefined` | Matches `!runtimeState` guard |

---

## Build and test results

### Baseline (before extraction)

| Metric | Value |
|--------|-------|
| Test files | **47** |
| Tests | **427** |
| Build | Pass (`npm run build --prefix client`) |

### After extraction

| Metric | Value |
|--------|-------|
| Test files | **48** (+1) |
| Tests | **435** (+8) |
| Build | **Pass** (`npm run build --prefix client`) |

**Commands run:**

```bash
npm test --prefix client
npm run build --prefix client
```

---

## Confirmation — no other logic touched

| File | Touched |
|------|---------|
| `DailyPuzzleScreen.tsx` | **Only:** import, removed `useState`×2 for hand sizing, added hook call, removed sizing `useEffect` |
| `DailyPuzzleLadderScreen.tsx` | **Only:** import, removed `useState`×2 for hand sizing, added hook call, removed sizing `useEffect` |
| `DailyPuzzleLadderLeaderboardScreen.tsx` | **Not touched** |
| All other client files | **Not touched** |

No JSX, handlers, puzzle logic, or other state in either screen was modified.