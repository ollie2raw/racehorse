# Handoff: Racehorse Dominoes — Visual Redesign Pass

## Overview

This bundle redesigns four screens of the existing Racehorse Dominoes web app to match the **already-redesigned** dark, cinematic visual system used by the home/mode-carousel and the Play vs Fritz setup screens. It is a **visual / layout / CSS pass only** — no game logic, bot logic, scoring, guided-lesson logic, daily-puzzle logic, leaderboard logic, routing, storage, Supabase, or state-machine code should change.

Screens redesigned:

1. **Learn mode landing screen**
2. **Guided learn match screen**
3. **Leave-game confirmation modal**
4. **Daily-puzzle completion / leaderboard modal**

## About the Design Files

The files in this bundle are **design references created in HTML/React** — prototypes showing the intended look and behavior. They are **not production code to copy directly** into the Racehorse codebase.

Your task is to **recreate these designs inside the existing Racehorse Vite + React + TypeScript codebase**, reusing its established redesign primitives and CSS tokens. The redesign system is already in the codebase under `client/src/ui/claudeMode.{tsx,css}` and `client/src/bot/botSetup.css`. Reuse those classes/components verbatim where possible — do **not** introduce a parallel design system, new dependencies, or new global styles. Translate the prototype's classes (`rh-*`) into the codebase's existing classes (`claude-mode-*`, etc.) wherever a one-to-one match exists.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, layout, hover/active states, and transitions are decided. Recreate pixel-perfectly.

## Source-of-Truth Files in the Codebase

These already exist and define the visual vocabulary. Read them first before editing anything:

| File | Role |
|---|---|
| `client/src/ui/claudeMode.tsx` | Exports `ClaudeModeScreen`, `ClaudePrimaryAction`, `ClaudeSecondaryAction`, `ClaudeSectionLabel`, `ClaudeStatLine`, `claudeRgb()` |
| `client/src/ui/claudeMode.css` | Tokens, hero/panel layout, button system, choice rows, stat lines |
| `client/src/bot/BotSetupScreen.tsx` | Reference for how to compose `ClaudeModeScreen` |
| `client/src/bot/botSetup.css` | Reference for accent-driven panels |
| `client/src/App.tsx` (mode-home rendering) | Reference for topbar / shell wrapping |

## Files to Edit (codebase paths)

| Screen | Files to edit |
|---|---|
| Learn landing | `client/src/learn/LearnHome.tsx`, `client/src/learn/learn.css` |
| Guided learn match | `client/src/learn/LearnPlayer.tsx`, `client/src/learn/learnPlayer.css` |
| Leave-game modal | inline JSX inside `client/src/bot/BotMatchScreen.tsx` (~line 6571) **and** `client/src/App.tsx` (~line 4424). Extract the markup into one new shared component (e.g. `client/src/components/LeaveGameModal.tsx`) used by both — but keep both call sites' existing handlers untouched |
| Daily-puzzle complete modal | `client/src/dailyPuzzle/DailyPuzzleScreen.tsx`, `client/src/dailyPuzzle/dailyPuzzle.css` |

## Absolute Constraints (do not violate)

- Do **not** redesign the rest of the app.
- Do **not** touch game logic, bot logic, scoring, guided-lesson logic, daily-puzzle logic, leaderboard logic, routing, storage/localStorage keys, Supabase logic, or state machines.
- Do **not** introduce new dependencies.
- Do **not** replace the board implementation; do **not** break tile click/selection/placement; do **not** change move validation; do **not** alter guided snapshot/playback logic; do **not** alter Fritz reply timing.
- Keep all existing props, handlers, and data flows intact. Every button that currently works must still call the same handler.

---

## Design Tokens (reuse from `claudeMode.css`)

### Surfaces
- Page background: `radial-gradient(circle at top left, rgba(61,142,255,0.12), transparent 28%), radial-gradient(circle at bottom right, rgba(0,240,200,0.07), transparent 30%), linear-gradient(180deg, #01010a 0%, #04050d 35%, #080912 100%)`
- Panel: `linear-gradient(180deg, rgba(8,9,18,0.98), rgba(13,15,28,0.98))`
- Shell border: `1px solid rgba(255,255,255,0.06)`
- Shell shadow: `0 24px 60px rgba(0,0,0,0.38)`
- Hero accent wash: `radial-gradient(ellipse 75% 62% at 0% 100%, rgba(var(--claude-accent-rgb), 0.22), transparent 72%), radial-gradient(ellipse 56% 36% at 100% 0%, rgba(var(--claude-accent-rgb), 0.08), transparent 75%), linear-gradient(180deg, #04050d 0%, #01010a 100%)`

### Accents
| Token | Hex | Used by |
|---|---|---|
| Cyan (Learn) | `#22d3ee` | Learn landing, guided match |
| Amber (Daily) | `#f0c040` | Daily-puzzle complete modal |
| Coral (Danger) | `#ff6f5e` | Leave-game modal |
| Green (Safe) | `#2dd4a8` | Cancel button |
| Blue | `#3d8eff` | Multiplayer (existing) |

Use `claudeRgb('#22d3ee')` to derive the `--claude-accent-rgb` value.

### Type
| Family | Use |
|---|---|
| `Outfit` (700/800/900) | Hero titles, oversized faded decor letters/numerals, score numerals |
| `Barlow Condensed` (700/800) | Headings, button titles, brand wordmark, stat values |
| `Rajdhani` (600/700) | Uppercase micro-labels, eyebrows, table headers |
| `Space Grotesk` (400/500/700) | Body copy |

Pulled from the existing Google Fonts import in `claudeMode.css` — do not add another import.

### Sizes
- Hero title: `clamp(46px, 5.7vw, 84px)`, weight 900, `letter-spacing: -0.04em`, `line-height: 0.9`, `white-space: pre-line`
- Decor letter: `clamp(180px, 18vw, 270px)`, weight 900, color `rgba(var(--claude-accent-rgb), 0.05)`, positioned `top: -28px; right: -8px`
- Eyebrow: 11px, weight 700, `letter-spacing: 0.22em`, uppercase, color `var(--claude-accent)`
- Section label: 11px, weight 700, `letter-spacing: 0.22em`, uppercase, color `rgba(255,255,255,0.38)`
- Stat label: 11px, weight 700, `letter-spacing: 0.18em`, uppercase, color `rgba(255,255,255,0.32)`
- Stat value: 16px, Barlow Condensed, weight 700, `letter-spacing: 0.04em`
- Body description: 14px, line-height 1.55, color `rgba(255,255,255,0.6)`

### Spacing
- Page padding: `clamp(8px, 1.6vh, 14px) clamp(12px, 1.7vw, 18px) clamp(12px, 1.9vh, 18px)`
- Hero padding: `clamp(22px, 3.1vw, 46px)`
- Panel padding: `clamp(20px, 2.6vw, 40px)`
- Modal padding: `clamp(28px, 5vw, 40px) clamp(24px, 5vw, 36px)`
- Stat-line vertical padding: 11px, with `border-bottom: 1px solid rgba(255,255,255,0.06)`

### Borders / corners
- All redesigned surfaces use **square corners** (no border-radius) to match the existing redesign — do not add `border-radius` to panels, hero, shells, or modals.
- Buttons inside `claude-mode-primary` are **square** in the existing system; preserve that.

---

## Screen 1 — Learn Mode Landing

**Replace** the guest path in `LearnHome.tsx` (the `if (!isAdmin || !showAdminView)` branch — currently rendering `LayoutScreen` with `learn-guest-*` classes) with a `ClaudeModeScreen` composition exactly mirroring `BotSetupScreen.tsx`.

### Layout
- Use `<ClaudeModeScreen>` from `client/src/ui/claudeMode`.
- Wrap in `<div className="screen learn-home-screen mode-subpage-screen mode-accent-learn claude-mode-screen-shell">` (preserve existing routing/layout class hooks).

### Props for `ClaudeModeScreen`
- `accent="#22d3ee"`
- `eyebrow="Learn"`
- `title={'GUIDED\nMATCH'}` (the `\n` produces the line break — `claude-mode-hero__title` already has `white-space: pre-line`)
- `description="One coached match that teaches strong play one move at a time. Coach Oliver narrates every turn — from opening tempo to closing the board."`
- `decor="L"`
- `backLabel="Back to Home"`
- `onBack={onBack}` (existing handler)
- `heroFooter`: `<div className="claude-mode-chip-row"><span className="claude-mode-chip">60 Turns</span><span className="claude-mode-chip">Coaching Every Move</span><span className="claude-mode-chip">Fixed Lesson</span></div>`
- `panel`: see below

### Right panel composition

Stack inside `claude-mode-panel-stack`:

1. `<ClaudeSectionLabel>Lesson Brief</ClaudeSectionLabel>`
2. Four `ClaudeStatLine` rows:
   - `Format` → `Single Guided Game`
   - `Coach` → `Oliver · Master` (accent `#22d3ee`)
   - `Length` → `~22 minutes`
   - `Last Played` → derived from existing progress data (e.g. `Turn ${turnNumber} / ${totalTurns}` — already computed in `pickPreviewMoment`). Hide the row if no progress.
3. **Preview card** (new — class `learn-landing-preview`):
   - Header: section label `Preview` on the left, `Turn X / 60` on the right (cyan)
   - Thin progress rail (3px, `rgba(255,255,255,0.06)` track, accent fill with glow `0 0 12px rgba(34,211,238,0.5)`)
   - Mini board chain — render the existing `Board` component you already use in the guest preview, but inside a panel with `background: radial-gradient(ellipse at center, rgba(34,211,238,0.04), transparent 70%), linear-gradient(180deg, #050b1a 0%, #020610 100%); border: 1px solid rgba(255,255,255,0.06)`
   - Coach-note quote block: `border-left: 2px solid #22d3ee; background: rgba(34,211,238,0.04); padding: 12px;` with eyebrow `Coach Note · Turn X` then the existing `coachingText` from `pickPreviewMoment` (truncated by the existing `shortenCoachingPreview`)
4. `<ClaudePrimaryAction accent="#22d3ee" title="Start Guided Game" meta={…} onClick={onStartGuidedV2Game} disabled={!onStartGuidedV2Game} />`
5. `<ClaudeSecondaryAction title="Back" meta="Return to game mode menu" onClick={onBack} />`

Keep all existing handlers and conditional-rendering logic (`onStartGuidedV2Game`, `isAdmin`, `showAdminView`, `v2FrozenLesson`, etc.). Do not change `LearnHomeProps`.

---

## Screen 2 — Guided Learn Match

**File:** `client/src/learn/LearnPlayer.tsx` + `learnPlayer.css`. This is a 1071-line file — do not refactor logic. Only change the JSX wrapper and CSS for the playable state (the lesson-running render path); intro card and completion screens can adopt the same shell but their inner content stays.

### Outer shell
Replace the existing `LayoutScreen` wrapper for the match path with:

```tsx
<div className="screen learn-match-screen mode-subpage-screen mode-accent-learn claude-mode-screen-shell">
  <header className="claude-mode-topbar learn-match-topbar">
    <div className="claude-mode-topbar__brand">RACEHORSE · GUIDED MATCH</div>
    <div className="learn-match-topbar__center">
      <span>Turn <strong>{stepIndex + 1} / {totalSteps}</strong></span>
      {/* score / open-ends only if existing data already supports them */}
    </div>
    <button type="button" className="claude-mode-topbar__back" onClick={onLeave}>
      <span aria-hidden="true">⏻</span><span>Leave</span>
    </button>
  </header>

  <section className="learn-match-grid">
    <aside className="learn-match-coach"> … </aside>
    <div className="learn-match-board"> … </div>
  </section>
</div>
```

### Grid (desktop)
```css
.learn-match-grid {
  display: grid;
  grid-template-columns: minmax(320px, 32%) 1fr;
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(3,5,14,0.84);
  box-shadow: 0 24px 60px rgba(0,0,0,0.38);
  overflow: hidden;
}
.learn-match-coach {
  background: linear-gradient(180deg, rgba(8,9,18,0.98), rgba(13,15,28,0.98));
  border-right: 1px solid rgba(255,255,255,0.06);
  padding: clamp(24px, 2.4vw, 32px);
  overflow-y: auto;
}
.learn-match-board {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: clamp(24px, 2.4vw, 32px);
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(34,211,238,0.05), transparent 70%),
    linear-gradient(180deg, #04050d 0%, #01010a 100%);
}
```

### Left coach panel content (only render data that already exists)
- Avatar block: 44×44 square with `O` glyph, accent border + tint; stacked label `COACH` / `OLIVER · MASTER`
- Lesson progress block:
  - Heading row (`Rajdhani` 11px label + `Barlow Condensed` 16px `X / 60` value in accent)
  - 3px rail (same as landing preview)
  - 60-tick rail: `display: grid; grid-template-columns: repeat(60, 1fr); gap: 2px;`. Each tick 6px tall, played → `rgba(34,211,238,0.85)`, current → `#22d3ee` with 8px glow, future → `rgba(255,255,255,0.05)`. Ticks correspond 1:1 to existing `stepIndex`/`totalSteps` if and only if the lesson already has 60 steps; otherwise scale proportionally — or hide if no progress data exists.
- Eyebrow `YOUR MOVE` (or current lesson step heading if available, e.g. `LESSON_HOOKS[lesson.id]`)
- Heading: existing `lesson.steps[stepIndex].coaching` headline if available, otherwise `YOUR MOVE` (Outfit 900, `clamp(28px, 3.4vw, 40px)`, `letter-spacing: -0.03em`, `line-height: 1`)
- Body: existing coaching text (Space Grotesk 14px, `line-height: 1.65`, color `rgba(255,255,255,0.66)`)
- **Recommended-move card** — only render if existing data already supplies a recommended tile and it currently has a "Show Best Move" or equivalent flow. Use the recommended tile component from `components/DominoTile`. Layout: cyan-tinted card with section label `RECOMMENDED`, embedded mini tile, and a small primary button reusing the existing best-move handler.

### Right board pane
- Board head: section label `BOARD · TURN N` on the left, chip row `LEFT END: x` + `RIGHT END: y` on the right (only if `getMatchableOpenEnds` already provides these).
- Wrap the existing `LearnBoard` component in `.learn-match-board-frame`:
  ```css
  .learn-match-board-frame {
    position: relative;
    flex: 1;
    border: 1px solid rgba(255,255,255,0.06);
    background:
      radial-gradient(ellipse at center, rgba(34,211,238,0.04), transparent 70%),
      linear-gradient(180deg, #050b1a 0%, #020610 100%);
    overflow: hidden;
  }
  ```
  Decorative corner ticks (4 absolutely-positioned 24×24 boxes with two-side borders, `rgba(255,255,255,0.18)`) at each corner.
- A faded `L` decor (Outfit 280px, color `rgba(34,211,238,0.04)`) bottom-right of the frame, `pointer-events: none`.
- **Do not replace `LearnBoard`** — keep it mounted with the same props.
- Hand head: section label `YOUR HAND` + chip row showing existing tile count / playable count if such data is already computed.
- Wrap the existing `TileRack`/rack DOM in `.learn-match-rack`:
  ```css
  .learn-match-rack {
    display: flex; gap: 8px; padding: 14px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
  }
  ```
  Selection / recommended-move highlight: keep using the existing selection state. Add a CSS-only `.is-recommended::before` dashed cyan ring with the existing pulse animation if a recommended tile exists.

### Responsive
- Below `~960px`: `grid-template-columns: 1fr`. Coach panel becomes a top region with `max-height: 38vh; overflow-y: auto;`. Board panel below. Topbar `learn-match-topbar__center` collapses to just `Turn X / Y`.
- Below `~640px`: hide brand wordmark in topbar; keep dot + sub label.
- Hand rack must remain horizontally scrollable on overflow (`overflow-x: auto`); preserve any existing mobile fixes.
- No horizontal page overflow.

---

## Screen 3 — Leave-Game Modal

Currently inline in two places (`BotMatchScreen.tsx` ~line 6571 and `App.tsx` ~line 4424) using inline styles. **Extract** to one shared component:

**New file:** `client/src/components/LeaveGameModal.tsx`

```tsx
import './leaveGameModal.css';

interface Props {
  onCancel: () => void;
  onLeave: () => void;
}

export default function LeaveGameModal({ onCancel, onLeave }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Leave game confirmation"
      className="rh-modal-overlay rh-modal-overlay--danger"
      onClick={onCancel}
    >
      <div className="rh-modal rh-modal--danger" onClick={(e) => e.stopPropagation()}>
        <div className="rh-modal__decor" aria-hidden="true">!</div>
        <div className="rh-modal__warn-icon" aria-hidden="true">!</div>
        <p className="rh-modal__eyebrow">Confirm</p>
        <h2 className="rh-modal__title">{'LEAVE\nGAME?'}</h2>
        <p className="rh-modal__copy">
          Your progress in this hand will be lost. The match will be marked as
          abandoned and won't count toward your streak.
        </p>
        <div className="rh-modal__buttons">
          <button type="button" className="rh-btn-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="rh-btn-leave" onClick={onLeave}>Leave Game</button>
        </div>
      </div>
    </div>
  );
}
```

Replace both inline modal blocks with `<LeaveGameModal onCancel={…} onLeave={…} />`. Keep the **exact** existing `onClick` handler bodies intact (the cancel sets `setShowLeaveConfirm(false)`; the leave runs the existing `clearPersistedLeagueMatch` / `abandonStandaloneFritzMatch` / `exitMatch` chain in `BotMatchScreen.tsx`, and the equivalent disconnect chain in `App.tsx`). Do **not** change those bodies — only relocate the JSX shell.

### CSS — see `styles/racehorse-screens.css` lines for `.rh-modal-overlay`, `.rh-modal`, `.rh-modal__title` (with `white-space: pre-line`), `.rh-modal__decor`, `.rh-modal__warn-icon`, `.rh-btn-cancel`, `.rh-btn-leave` — copy verbatim into `leaveGameModal.css`. Accent is coral (`#ff6f5e`).

---

## Screen 4 — Daily-Puzzle Completion / Leaderboard Modal

**File:** `client/src/dailyPuzzle/DailyPuzzleScreen.tsx`. The modal currently uses `daily-puzzle-overlay` + `daily-puzzle-modal` classes around `renderLeaderboardRows`. Replace the modal markup (not the data plumbing — `leaderboard`, `currentLeaderboardRow`, `finalScore`, `bestPossibleScore`, `streakDays`, `completionMessage`, `modalLeaderboard`) with the structure shown in `scripts/Screens.jsx → DailyResultModal`.

### Outer shell
- Reuse `.rh-modal-overlay` for backdrop. Apply accent: `style={{ ['--rh-accent']: '#f0c040', ['--rh-accent-rgb']: '240, 192, 64' }}`.
- Modal width: `min(720px, calc(100vw - 32px))`; padding 0 (sections have their own padding).

### Header section (`.rh-result__head`)
- Background: `radial-gradient(ellipse 80% 70% at 0% 100%, rgba(240,192,64,0.18), transparent 70%), radial-gradient(ellipse 50% 50% at 100% 0%, rgba(240,192,64,0.06), transparent 70%)`
- Eyebrow `DAILY PUZZLE COMPLETE` (uppercase, 11px, `letter-spacing: 0.22em`, color amber)
- Score: bind to existing `completedScore`. Outfit 900, `clamp(72px, 9vw, 110px)`, `letter-spacing: -0.05em`, color amber, `text-shadow: 0 0 60px rgba(240,192,64,0.28)`
- Score suffix: `Final Score` (Rajdhani 12px uppercase, `letter-spacing: 0.22em`)
- Feedback line: bind to existing `completionMessage.text` (e.g. `🏆 Perfect!`, `⭐ Great solve!`, `Keep practicing!`). Color from `completionMessage.color`. Style: Barlow Condensed 18px, `letter-spacing: 0.08em`, uppercase. **Keep existing emoji** since the existing logic already supplies them; do not invent new ones.

### Summary section (`.rh-result__summary`)
3-column grid divided by `1px solid rgba(255,255,255,0.06)` between columns:
| Label | Value |
|---|---|
| `Your Score` | `completedScore` |
| `Best Possible` | `bestPossibleScore` |
| `Streak` | `streakDays day(s)` (existing logic — pluralize) |

Padding `18px 22px`. Label `Rajdhani` 10px `letter-spacing: 0.22em` uppercase. Value `Barlow Condensed` 26px weight 800.

### Leaderboard section (`.rh-result__board`)
- Header row: section label `Global Leaderboard` left, dim text `${formattedDate} · Top N of total` right (use existing date/total).
- Table grid: `grid-template-columns: 28px 1fr 64px 64px 64px;` (rank / player / score / moves / time)
- Header row uppercase (Rajdhani 10px, `letter-spacing: 0.22em`, color `rgba(255,255,255,0.36)`), `border-bottom: 1px solid rgba(255,255,255,0.06)`.
- Body rows: padding `14px 8px`, `border-bottom: 1px solid rgba(255,255,255,0.04)`.
- Each row: rank (Barlow Condensed 16px), name with 22×22 avatar square (initials from existing `getDisplayName(row.username)`), then numeric score / moves / time (right-aligned, tabular-nums).
- **Top 3** rank cells use Outfit 900 14px in amber (no emoji medals — replaces the current `🥇🥈🥉`).
- **Current user row** (`row.userId === currentUserId`): add `is-you` modifier with `background: linear-gradient(90deg, rgba(240,192,64,0.10), rgba(240,192,64,0.02) 70%); border-bottom-color: rgba(240,192,64,0.3);`. Replace the inline `← You` with a small `YOU` pill: `font-size: 9px; letter-spacing: 0.18em; padding: 2px 6px; border: 1px solid rgba(240,192,64,0.6); color: #f0c040;`.
- Bind rows to existing `modalLeaderboard` (`leaderboard.slice(0, 20)`); use existing `formatPuzzleElapsed` for time.

### Actions section (`.rh-result__actions`)
- 2-column grid, gap 10px, padding `18px 22px 22px`.
- **Play Again** = primary amber button — calls existing Play Again handler.
- **Back to Home** = secondary outlined button — calls existing Back to Home handler.

Backdrop should show the blurred board behind the modal — already free since the page underneath isn't unmounted. Just keep `backdrop-filter: blur(14px)` on the overlay.

---

## Interactions & Behavior

- **All existing handlers preserved.** Specifically:
  - Learn landing: `onStartGuidedV2Game`, `onStartAuthoringV2`, `onBack`
  - Guided match: `onExit`, all step navigation, `LearnBoard` props, rack click handlers, drill timers, prediction reveal, etc. — untouched
  - Leave modal: `setShowLeaveConfirm(false)` on cancel; the full leave chain (`clearPersistedLeagueMatch`, `abandonStandaloneFritzMatch`, `exitMatch`, or in `App.tsx` the `disconnect('user leave game')` flow) on leave — both verbatim
  - Daily-puzzle modal: existing Play Again / Back to Home handlers; `currentUserId` highlight; `modalLeaderboard` data
- **Transitions:**
  - Modal overlay fade-in: 180ms ease (`@keyframes rh-fade`)
  - Modal pop: 220ms `cubic-bezier(.2,.9,.3,1.1)` (`@keyframes rh-pop`)
  - Recommended-tile pulse: 1.6s ease-in-out infinite (`@keyframes rh-pulse`)
  - Button hover: `filter: brightness(1.06); transform: translateY(-1px); transition: 160ms ease`
  - Progress fill: `transition: width 320ms ease`
- **Hover states** documented in the prototype CSS — replicate exactly.
- **Focus-visible:** keep the existing `claudeMode.css` focus styles (cyan/blue ring) — don't override.

## State Management

No new state. The redesign reuses every existing state variable. The `LeaveGameModal` extraction takes `onCancel` / `onLeave` as props; the parent components keep their `showLeaveConfirm` state.

## Assets

No new assets. Decor letters (`L`, `!`) are CSS-rendered text. Icons (`⏻`, `←`, `!`) are unicode characters used by the existing redesign. If your team already has icon components for these, swap them in.

## Files in This Bundle

| Path | Purpose |
|---|---|
| `Racehorse Redesign.html` | Open in a browser to see the full prototype with all four screens on one canvas |
| `styles/racehorse-tokens.css` | Reference tokens: page shell, topbar, hero, panel, chips, stat lines, primary/secondary buttons. Maps 1:1 to `claudeMode.css` |
| `styles/racehorse-screens.css` | Tile, board, rack, progress, coach panel, modal, daily-result table |
| `scripts/Tile.jsx` | Throwaway domino primitive used only for the prototype — your codebase already has `client/src/components/DominoTile.tsx`; use that instead |
| `scripts/Screens.jsx` | The four screens in JSX. Translate class names (`rh-*` → `claude-mode-*` where applicable) when porting |

## Class-Name Translation Cheat Sheet

When porting prototype CSS to the codebase, prefer existing classes from `claudeMode.css`:

| Prototype (`rh-*`) | Codebase equivalent |
|---|---|
| `rh-page` | (use existing `claude-mode-page` via `<ClaudeModeScreen>`) |
| `rh-topbar` | `claude-mode-topbar` |
| `rh-brand` / `rh-back` | `claude-mode-topbar__brand` / `claude-mode-topbar__back` |
| `rh-shell` | `claude-mode-screen` (rendered by `<ClaudeModeScreen>`) |
| `rh-hero` / `rh-hero__decor` / `rh-hero__title` etc. | `claude-mode-hero*` (rendered by `<ClaudeModeScreen>`) |
| `rh-panel` | `claude-mode-panel` |
| `rh-section-label` | `claude-mode-section-label` (or use `<ClaudeSectionLabel>`) |
| `rh-stat` | `claude-mode-stat-line` (or use `<ClaudeStatLine>`) |
| `rh-chip-row` / `rh-chip` | `claude-mode-chip-row` / `claude-mode-chip` |
| `rh-btn-primary` | `claude-mode-primary` (or use `<ClaudePrimaryAction>`) |
| `rh-btn-secondary` | `claude-mode-secondary` (or use `<ClaudeSecondaryAction>`) |
| `rh-modal-overlay`, `rh-modal`, `rh-modal__*`, `rh-result__*`, `rh-tickrail`, `rh-board`, `rh-rack`, `rh-coach__*` | **New** — these don't exist in the codebase. Add them in the screen-specific CSS files (`learn.css`, `learnPlayer.css`, `dailyPuzzle.css`, new `leaveGameModal.css`). Keep the `rh-` or pick a screen-scoped prefix consistent with the file. |

## Build / Verify

After porting:
1. `npm run build` (or the project's existing equivalent) — fix only errors caused by the changes
2. `npx tsc --noEmit` if a separate typecheck step exists
3. Manually verify:
   - Learn landing → Start Guided Game still launches the same lesson
   - Guided match → tile selection, placement, coach progression all work
   - Leave modal → both call sites cancel and leave correctly
   - Daily puzzle → Play Again resets, Back to Home navigates, leaderboard rows match server data, current-user highlight on the right row

## Output to Report Back

When done:
1. Files changed
2. What changed per screen
3. Any responsive behavior added
4. Confirmation that game logic was untouched
5. Build/typecheck result
