# Racehorse — Agent Instructions

This file is read by Claude Code at the start of every session. It defines binding rules for all UI work on this project. Follow everything here before touching any code.

---

## What This Product Is

Racehorse is a premium competitive dominoes platform. It should feel like a luxury sci-fi strategy experience — closer to chess.com or a high-end esports client than a mobile game or SaaS dashboard.

Every screen must reinforce: **the player is entering a serious competitive environment.**

Never make Racehorse feel:
- casual, playful without purpose, or arcade-like
- crypto casino or gambling aesthetic
- generic Tailwind / startup dashboard
- neon cyberpunk parody
- cartoonish or toy-like

---

## Design System — Non-Negotiable Rules

### 1. Token File Is the Only Source of Truth for Values

All color, typography, spacing, and radius values must come from:

```
client/src/styles/tokens.css
```

**Never hardcode hex values or font names in component CSS or inline styles.** Always use a token variable. If a token doesn't exist for what you need, add it to `tokens.css` first.

Current tokens:

```css
--bg-obsidian: #04070c;        /* The base background — near-black obsidian */

--tier-rookie:   #4ADE80;      /* Green  — streaks, positive progression */
--tier-standard: #3B82F6;      /* Blue   — focus, gameplay, strategy */
--tier-elite:    #E7B64A;      /* Gold   — prestige, achievement, mastery */
--tier-master:   #A855F7;      /* Purple — elite competition, premium modes */

--radius-card:   24px;         /* Standard card corner radius */
--hud-lift:      20px;         /* Standard shadow elevation for lifted panels */

--font-display: 'Barlow Condensed', sans-serif;   /* HUD labels, headers, stats */
--font-body:    'Outfit', sans-serif;              /* Body text, UI copy */
```

### 2. Two Fonts Only

- **Barlow Condensed** — display, HUD labels, stat numbers, section headers
- **Outfit** — body text, descriptions, UI copy

**Never introduce any other font.** Do not use Rajdhani, Space Grotesk, Montserrat, Inter, or Avenir Next in new code. These are legacy and being phased out.

### 3. Color System

The Racehorse color system is dark, atmospheric, and restrained:

| Role | Value |
|------|-------|
| Base background | `var(--bg-obsidian)` = `#04070c` |
| Glass surface | `rgba(10, 16, 28, 0.6)` |
| Subtle border | `rgba(255, 255, 255, 0.08)` |
| Light border | `rgba(255, 255, 255, 0.14)` |
| Primary text | `rgba(255, 255, 255, 0.95)` |
| Secondary text | `rgba(255, 255, 255, 0.6)` |
| Dim/muted text | `rgba(255, 255, 255, 0.35)` |

Accent colors come from the tier system only. Blue for gameplay/interaction, Gold for prestige/achievement, Purple for elite/premium, Green for streaks/success.

**Never use random gradients, bright saturated fills, or pure white sections.**

### 4. The Glass Surface Pattern

Every panel, card, and container in Racehorse uses glass-morphism:

```css
background: rgba(10, 16, 28, 0.6);
backdrop-filter: blur(16px);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: var(--radius-card);
```

Use the `<GlassCard>` primitive instead of writing this by hand. See Primitives section below.

### 5. Motion

All interactive elements use this transition:

```css
transition: transform 120ms cubic-bezier(0.2, 0, 0, 1),
            box-shadow 120ms cubic-bezier(0.2, 0, 0, 1);
```

Hover: `translateY(-1px)` lift.  
Active/press: `scale(0.97)`.  
**No bounce. No spring. No exaggerated motion.** Motion must feel weighted and controlled.

---

## Component Primitives — Use These First

Before writing any custom button, card, modal, or stat display, check if a primitive exists:

```
client/src/components/primitives/
  Button.tsx      — all interactive buttons
  GlassCard.tsx   — all panels and containers
  Modal.tsx       — all dialog/overlay UI
  StatValue.tsx   — all numeric stat displays
  index.ts        — barrel export
```

Import from the barrel:
```tsx
import { Button, GlassCard, Modal, StatValue } from '../components/primitives';
```

### Button

```tsx
<Button variant="primary">Play</Button>
<Button variant="tier-elite" size="lg">Enter Tournament</Button>
<Button variant="secondary" size="sm">Cancel</Button>
<Button variant="outline">View Stats</Button>
<Button variant="ghost">Dismiss</Button>
```

Variants: `primary` | `secondary` | `outline` | `ghost` | `tier-rookie` | `tier-standard` | `tier-elite` | `tier-master`  
Sizes: `sm` (34px) | `md` (44px, default) | `lg` (52px)

**Never use a raw `<button>` element for a user-facing action.** Always use `<Button>`.

### GlassCard

```tsx
<GlassCard>Standard panel</GlassCard>
<GlassCard lifted>Elevated panel with shadow</GlassCard>
<GlassCard accent="gold">Gold-bordered card</GlassCard>
<GlassCard accent="blue" lifted>Blue accent, elevated</GlassCard>
```

Accent options: `blue` | `gold` | `purple` | `green`

### Modal

```tsx
<Modal open={isOpen} onClose={() => setIsOpen(false)} title="Confirm">
  Content here
</Modal>
```

Handles: backdrop blur, Escape key, backdrop-click close, GlassCard surface, responsive width.

### StatValue

```tsx
<StatValue value={42} label="WIN STREAK" />
<StatValue value="1,204" label="ELO RATING" size="lg" accent="var(--tier-elite)" />
<StatValue value={7} label="DAILY STREAK" inline accent="var(--tier-rookie)" />
```

Uses Barlow Condensed automatically for the number. Always use this for any numeric stat display.

---

## The Two Canonical Reference Screens

When building any new screen or component, **match the visual language of these two files exactly**:

1. `client/src/screens/HomeScreen.tsx` + `client/src/experimental/RacehorseHomeArt.css`
2. `client/src/bot/PlayVsFritz.tsx` + `client/src/bot/PlayVsFritz.css`

These are production-ready, approved, and represent the current Racehorse identity. Any new screen should look like it belongs in the same family.

If something you're building doesn't match the feel of those screens, stop and simplify before shipping.

---

## File Structure Rules

New screens go in `client/src/screens/`.  
New shared components go in `client/src/components/`.  
New primitives go in `client/src/components/primitives/`.  
Feature-specific logic stays in its feature folder (`bot/`, `league/`, `stats/`, etc.).  
CSS for a screen lives next to its component file.

**Do not create new files in `experimental/` or `ui/`.** Those directories contain legacy code that is being migrated out.

---

## CSS Rules

- **Never use `!important`.** If you need to override something, fix the specificity properly.
- **Never write a new `:root {}` block.** All tokens live in `src/styles/tokens.css` only.
- **Never import CSS from a different feature module.** Each feature's CSS is scoped to that feature.
- **Never load a new Google Font.** The two permitted fonts (Barlow Condensed, Outfit) are already loaded globally.
- Class names for new components use the `rh-` prefix (`rh-scoreboard`, `rh-match-header`, etc.).

---

## Navigation / Routing

The app uses `HashRouter` from react-router-dom. Navigation is driven by `setAppMode()` in `App.tsx`, not by `<Link>` or `navigate()` in most components. Pass `setAppMode` as a prop if a screen needs to navigate.

---

## What to Never Touch Without Explicit Permission

- `client/src/styles/walnut-live.css` — contains live game tile interaction rules at the bottom; do not delete or modify
- `client/src/multiplayer/` — socket lifecycle code; do not restructure
- `client/src/App.tsx` lines 1480–1530 — multiplayer connection hooks; do not move
- `client/src/learning/` — active coaching system used by BotMatchScreen
- `client/src/learn/` — active lesson player system

---

## The Racehorse Standard

Before finalizing any UI change, ask: **"Does this feel like Racehorse?"**

The answer must be yes to all of these:
- [ ] Dark background, atmospheric lighting
- [ ] Glass surface with blur, not flat card
- [ ] Blue/gold/purple accent palette only
- [ ] Barlow Condensed for display text, Outfit for body
- [ ] Tokens used — no hardcoded hex values
- [ ] `<Button>` primitive used — no raw `<button>` elements
- [ ] Motion is restrained — 120ms, no bounce
- [ ] No `!important` added
- [ ] No new fonts introduced
- [ ] Matches the visual language of HomeScreen and PlayVsFritz
