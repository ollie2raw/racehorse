# Daily Fritz Screen — Pixel-Perfect Rebuild Spec

> Source of truth: `dailyfritzMOCK.png`
> This is a full rebuild. Do not patch existing code. Read this entire file before writing a single line.

---

## Layout Overview

The screen has 3 vertical sections:

```
[ HERO HEADER — full width ]
[ MAIN GRID — left 55% | right 45% ]
[ BOTTOM BAR — full width ]
[ INFO ROW — full width ]
[ COUNTDOWN — full width, centered ]
```

Page background: `#080c16`
Max content width: `1300px`, centered, padding: `0 48px`

---

## Section 1: Hero Header

Full-width header area. No card/border. Overlapping domino image on the right.

### Left content (positioned left, ~50% width):
- **Kicker row**: gold dot `●` (8px, `#f5b800`) + text `DAILY FRITZ` (11px, font-weight 700, letter-spacing 2px, color `#f5b800`)
- **Title**: `Daily Fritz` — font-size `64px`, font-weight `900`, color `white`, letter-spacing `-1px`, line-height `1`
- **Subtitle**: `Best-of-3 set. Same deal for everyone.` — font-size `16px`, color `rgba(255,255,255,0.55)`, margin-top `8px`
- **Status pill**: rounded pill button, border `1px solid rgba(255,255,255,0.2)`, background `transparent`, padding `8px 16px`, font-size `13px`, color `rgba(255,255,255,0.7)`, contains `✓ Today's set ready`

### Right content (absolute, top-right of hero):
- Domino tile image (`/dominoes.png` or equivalent) — large, roughly `340px wide`, positioned top-right, slightly overlapping, no border, natural drop
- Back to Home button: top-right corner, `← Back to Home`, background `rgba(255,255,255,0.06)`, border `1px solid rgba(255,255,255,0.12)`, border-radius `8px`, padding `8px 16px`, font-size `13px`, font-weight `600`

### Hero spacing:
- Padding top: `32px`
- Padding bottom: `32px`
- Margin bottom before main grid: `24px`

---

## Section 2: Main Grid

`display: grid; grid-template-columns: 1fr 0.75fr; gap: 16px; align-items: start;`

---

### LEFT COLUMN

#### Card A — Set Overview Card

Full gold-accented card. This is the hero card of the screen.

```
background: linear-gradient(135deg, #110e00, #1a1400)
border: 1px solid rgba(245, 184, 0, 0.3)
border-radius: 16px
padding: 28px
```

**Top row** — `display: flex; align-items: flex-start; gap: 24px;`

- **Left**: Gold glowing icon circle
  - Outer ring: `width: 80px; height: 80px; border-radius: 50%; border: 2px solid #f5b800; box-shadow: 0 0 24px rgba(245,184,0,0.4); display: flex; align-items: center; justify-content: center;`
  - Inner: play/domino icon in gold, ~32px

- **Right**: Text block
  - Label: `SET OVERVIEW` — 10px, font-weight 700, letter-spacing 2px, color `#f5b800`, margin-bottom `8px`
  - Title: `Ready to begin` — font-size `32px`, font-weight `800`, color `white`, line-height `1.1`
  - Description: `Play today's best-of-3 against Fritz. Win two games to take the set.` — font-size `14px`, color `rgba(255,255,255,0.55)`, margin-top `8px`, line-height `1.6`

**Divider**: `border-top: 1px solid rgba(255,255,255,0.07); margin: 20px 0;`

**Bottom stats row** — `display: flex; gap: 0; align-items: center;`

4 stat columns separated by `1px solid rgba(255,255,255,0.1)` vertical dividers, each with `padding: 0 24px` (first has `padding-left: 0`):

| # | Icon | Label | Value |
|---|------|-------|-------|
| 1 | 📅 calendar icon | `DATE` | `May 10, 2026` |
| 2 | 📊 bar chart icon | `TIER` | `Elite (1800)` in `#f5b800` |
| 3 | 🎯 grid/format icon | `FORMAT` | `Best-of-3 · 7-tile` |
| 4 | 🔥 flame icon | `STREAK` | `0 days` |

Each stat:
```
display: flex; align-items: center; gap: 10px;
icon: 20px, color rgba(255,255,255,0.4)  [TIER icon: #f5b800]
label: 10px, font-weight 700, letter-spacing 1px, color rgba(255,255,255,0.35), display block
value: 15px, font-weight 700, color white  [TIER value: #f5b800]
```

---

#### Card B — Set Goal / Difficulty / Leaderboard + CTA

`display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;`

**Left card** (spans left half) — 3 stat columns side by side:
```
background: #0d1120
border: 1px solid rgba(255,255,255,0.08)
border-radius: 16px
padding: 24px
display: flex; gap: 32px; align-items: flex-start;
```

3 items, each:
- Gold circle icon (40px, border `1px solid rgba(245,184,0,0.4)`, bg `rgba(245,184,0,0.08)`)
- Label: 10px, caps, letter-spacing 1.5px, color `rgba(255,255,255,0.35)`
- Value: 20px, font-weight 800, color white
- Sub-description: 12px, color `rgba(255,255,255,0.4)`, margin-top 4px

| Label | Value | Sub |
|-------|-------|-----|
| SET GOAL | Win 2 / 3 | Take two games to win today's set |
| TODAY'S DIFFICULTY | Elite | 1800 rated challenge |
| LEADERBOARD | `— — —` | See where you rank after completion |

**Right card** — CTA panel:
```
background: #0d1120
border: 1px solid rgba(245,184,0,0.25)
border-radius: 16px
padding: 24px
display: flex; align-items: center; gap: 20px;
```

- Gold play button circle (48px, bg `#f5b800`, icon white `▶`)
- Text block:
  - `Start today's set` — 18px, font-weight 800, color white
  - `Your result will post after the set ends.` — 13px, color `rgba(255,255,255,0.5)`
- Right side (margin-left auto):
  - `Start Set` button: bg `#f5b800`, color `#000`, font-weight 800, font-size 16px, padding `14px 28px`, border-radius `10px`, border none
  - Below button: `View Leaderboard →` — 13px, color `#f5b800`, font-weight 600, text-align center, margin-top 8px, cursor pointer

---

### RIGHT COLUMN

#### Card C — Set Games Panel

```
background: #0d1120
border: 1px solid rgba(255,255,255,0.08)
border-radius: 16px
overflow: hidden
```

**Header**: `padding: 20px 24px 16px;`
- Label: `SET GAMES` — 11px, font-weight 700, letter-spacing 2px, color `rgba(255,255,255,0.4)`

**3 game rows**, each separated by `border-top: 1px solid rgba(255,255,255,0.06)`:

```
padding: 18px 24px
display: flex; align-items: center; gap: 16px;
```

Row structure:
1. **Left accent bar**: `width: 3px; height: 36px; border-radius: 2px; flex-shrink: 0`
   - Game 1: `#f5b800` (gold)
   - Game 2: `#22c55e` (green)
   - Game 3: `rgba(255,255,255,0.15)` (muted)

2. **Game label block**:
   - Title: `GAME 1` / `GAME 2` / `GAME 3` — 11px, font-weight 700, letter-spacing 1px, color `rgba(255,255,255,0.4)`
   - Status: `Ready` (gold `#f5b800` for 1&2) / `If needed` (muted `rgba(255,255,255,0.3)`) — 15px, font-weight 700

3. **Domino tile image**: `margin-left: auto; width: 48px; height: 36px; object-fit: contain; opacity: 0.8`

4. **Format text**: `First to 7` / `Starts on set launch` — 13px, color `rgba(255,255,255,0.45)`, text-align right, min-width `80px`

5. **Chevron**: `›` — 18px, color `rgba(255,255,255,0.3)`, margin-left `8px`

---

## Section 3: Info Row

Full width, below main grid. `margin-top: 16px`

```
background: #0d1120
border: 1px solid rgba(255,255,255,0.08)
border-radius: 16px
padding: 20px 28px
display: flex; align-items: center; gap: 20px;
```

- **Left icon**: blue square icon (40px, bg `rgba(77,160,255,0.1)`, border `1px solid rgba(77,160,255,0.2)`, border-radius `10px`, icon color `#4da0ff`)
- **Text block**:
  - Title: `How Daily Fritz works` — 16px, font-weight 700, color white
  - Subtitle: `One attempt today. Same deal for everyone. Results post after the set is complete.` — 13px, color `rgba(255,255,255,0.45)`
- **Right side** (margin-left auto):
  - `View rules ›` button: background `transparent`, border `1px solid rgba(255,255,255,0.15)`, border-radius `8px`, padding `10px 20px`, font-size `13px`, font-weight `600`, color `white`

---

## Section 4: Countdown

Centered, `margin-top: 24px; margin-bottom: 32px;`

```
display: flex; align-items: center; justify-content: center; gap: 8px;
font-size: 14px; color: rgba(255,255,255,0.35);
```

- Clock icon (14px, same muted color)
- Text: `Today's set resets in 23:52:17`
- Timer value should use a monospace font or `font-variant-numeric: tabular-nums`

---

## CSS Rules — Do Not Deviate

```css
.df-page {
  background: #080c16;
  min-height: 100vh;
  color: white;
  font-family: inherit;
}

.df-container {
  max-width: 1300px;
  margin: 0 auto;
  padding: 0 48px 48px;
}

.df-hero {
  position: relative;
  padding: 32px 0;
  margin-bottom: 24px;
  overflow: hidden;
}

.df-hero-image {
  position: absolute;
  right: -20px;
  top: -10px;
  width: 340px;
  opacity: 0.9;
  pointer-events: none;
}

.df-main-grid {
  display: grid;
  grid-template-columns: 1fr 0.75fr;
  gap: 16px;
  align-items: start;
}

.df-overview-card {
  background: linear-gradient(135deg, #110e00, #1a1400);
  border: 1px solid rgba(245, 184, 0, 0.3);
  border-radius: 16px;
  padding: 28px;
}

.df-games-card {
  background: #0d1120;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  overflow: hidden;
}

.df-bottom-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}

.df-stats-card {
  background: #0d1120;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  gap: 32px;
  align-items: flex-start;
}

.df-cta-card {
  background: #0d1120;
  border: 1px solid rgba(245, 184, 0, 0.25);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 20px;
}

.df-start-btn {
  background: #f5b800;
  color: #000;
  font-weight: 800;
  font-size: 16px;
  padding: 14px 28px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  white-space: nowrap;
}

.df-info-row {
  background: #0d1120;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 20px 28px;
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 16px;
}

.df-game-row {
  padding: 18px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.df-game-row:first-of-type {
  border-top: none;
}

.df-accent-bar {
  width: 3px;
  height: 36px;
  border-radius: 2px;
  flex-shrink: 0;
}

.df-countdown {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 24px;
  margin-bottom: 32px;
  font-variant-numeric: tabular-nums;
}
```

---

## Checklist — Verify Before Submitting

- [ ] Domino image bleeds from top-right of hero area
- [ ] "Back to Home" button is top-right corner of screen
- [ ] Set Overview card has gold gradient background (not solid dark)
- [ ] Glowing gold icon circle renders with `box-shadow`
- [ ] Stats row in overview card has vertical dividers between items
- [ ] Game rows have correct colored accent bars (gold / green / muted)
- [ ] CTA card has solid gold `Start Set` button (not outline)
- [ ] `View Leaderboard →` link appears below the Start Set button in gold
- [ ] Info row icon is blue-tinted
- [ ] Countdown is centered at bottom with clock icon
- [ ] No horizontal overflow anywhere
- [ ] All text fits within cards — no clipping
