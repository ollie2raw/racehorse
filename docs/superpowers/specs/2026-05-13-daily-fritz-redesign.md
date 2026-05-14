# Daily Fritz Landing Screen Redesign

**Date:** 2026-05-13  
**Status:** Approved for implementation

## Goal

Rebuild the Daily Fritz landing screen CSS and landing JSX to match the approved mock — a clean, spacious layout with a massive Barlow Condensed title, gold eyebrow chip, and tighter visual hierarchy. All game logic (BotMatchScreen routing, overlay states, leaderboard, API calls) is untouched.

## Scope

**Modified files only:**
- `client/src/dailyFritz/DailyFritzScreen.tsx` — landing JSX render section only (the `return (...)` block that renders the hub; the loading, leaderboard, and activeRun branches stay untouched)
- `client/src/dailyFritz/dailyFritz.css` — full replacement of landing styles

**Not touched:**
- Game logic, state machines, overlay states, API functions
- BotMatchScreen render branch
- Leaderboard render branch
- Loading screen render branch
- `client/src/dailyFritz/DailyFritzLeaderboard.tsx`
- `client/src/dailyFritz/api.ts`

## Layout

Two-column layout above a full-width stats bar, all within a max-width container.

```
┌─────────────────────────────────────────┐
│  DAILY FRITZ  (eyebrow chip)            │
│  Daily Fritz  (80px Barlow Condensed)   │
│  Best-of-3 set. Same deal for everyone. │
├───────────────────────┬─────────────────┤
│  Overview card        │  Set Games card │
│  [Fritz art] content  │  Game 1, 2, 3   │
│  2×2 meta grid        │  rows           │
│  [START SET ›]        │                 │
│  View Leaderboard →   │                 │
├───────────────────────┴─────────────────┤
│  Set Goal │ Difficulty │ Your Rank │ Streak + week strip │
├─────────────────────────────────────────┤
│  ℹ How it works: …        Reset in X:XX │
└─────────────────────────────────────────┘
```

## Title Area

- Small ghost back button `← Back to Home` above the eyebrow (same pattern as PlayVsFritz)
- Eyebrow: `● DAILY FRITZ` — gold dot (`var(--tier-elite)`) + Barlow Condensed 10px 700 letter-spacing 0.14em uppercase, gold color
- Title: `Daily Fritz` — Barlow Condensed `clamp(64px, 8dvh, 88px)` weight 900 letter-spacing -0.04em
- Subtitle: `Best-of-3 set. Same deal for everyone.` — Outfit 14px `var(--text-secondary)`
- Margin below subtitle before the two-column area: 24px

## Overview Card

Glass surface with dark amber tint:
```css
background: linear-gradient(135deg, rgba(20, 15, 2, 0.98) 0%, rgba(12, 9, 2, 0.95) 100%);
border: 1px solid color-mix(in srgb, var(--tier-elite) 32%, transparent);
```

Internal layout:
- Fritz image: 40% width of the card, `object-fit: cover`, full card height, positioned left
- Content column: flex column, padding 24px, gap between sections
- Eyebrow: `TODAY'S SET OVERVIEW` gold label
- Heading: `Ready to begin` / `In Progress` / `Set Complete` — Barlow Condensed 32px weight 800
- Description: `Play today's best-of-3 against Fritz. Win two games to take the set.`
- Meta grid: 2×2, each cell has icon + label (`DATE`, `TIER`, `FORMAT`, `STREAK`) + value
  - Tier cell icon and value use `var(--tier-elite)` gold
- START SET button: full-width, `variant="tier-elite"`, size `lg`
- View Leaderboard link: centered, gold text, no border

**Note:** Meta label for the skill column is `TIER` (not `SKILL`) in this redesign.

## Set Games Card

Glass surface (`var(--glass-bg)` + `var(--glass-blur)`):
- Header: `SET GAMES` — Barlow Condensed 10px 700 letter-spacing 0.14em uppercase `var(--text-secondary)`
- Three game rows, each: domino icon + `GAME N` label + status + format text + `›`
  - Game 1 bar: `var(--tier-elite)`
  - Game 2 bar: `var(--tier-standard)` 
  - Game 3 bar: `var(--border-light)`
  - Status colors: Ready=tier color, Won=`var(--tier-rookie)`, Lost=`var(--accent-red)`, muted=`var(--text-dim)`

## Stats Bar

Full-width glass card below the two columns. Single horizontal row:

| Section | Icon | Label | Value | Sub |
|---------|------|-------|-------|-----|
| Set Goal | target circle | SET GOAL | Win 2 / 3 | Best of three |
| Difficulty | star | DIFFICULTY | Elite | 1800 rated |
| Your Rank | people | YOUR RANK | — or #N | After completion |
| Streak | flame | STREAK | N days streak | Play Daily Fritz today… + week strip inline |

Icons have circular border with gold tint. Dividers between sections. Streak section is wider (flex 1.6 vs 1).

Week strip sits below the streak value+sub, same cell — 7 day columns (MON–SUN), each with a label and dot. Done=green checkmark circle, today=purple/gold dot, future=empty circle outline.

## Info Footer

Single row:
- Left: `ⓘ` icon + `**How it works** One attempt today. Same deal for everyone. Results post after the set is complete.`
- Right: clock icon + `Today's set resets in H:MM:SS`

## Design Tokens Used

All from `client/src/styles/tokens.css` — no hardcoded hex values except inside the gradient string for the overview card background (which pre-exists and uses the same values).

- `var(--bg-obsidian)` — page background
- `var(--tier-elite)` — gold accents, eyebrow, tier label, CTA button
- `var(--tier-standard)` — Game 2 bar, blue accents
- `var(--tier-rookie)` — win state green
- `var(--text-primary)`, `var(--text-secondary)`, `var(--text-dim)`
- `var(--glass-bg)`, `var(--glass-blur)`, `var(--border-subtle)`, `var(--border-light)`
- `var(--font-display)` (Barlow Condensed), `var(--font-body)` (Outfit)
- `var(--radius-card)`, `var(--radius-md)`

## Rules

- No `!important`
- No hardcoded hex (except the pre-existing gradient values in `.df-overview-card`)
- No new `:root {}` blocks
- `<Button>` primitive for all interactive elements
- Class names use `df-` prefix
