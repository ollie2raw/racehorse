# Single Player Hub — Pixel-Perfect Rebuild Spec

> Source of truth: `mockSINGLE.webp` (Image 2 provided)
> Full rebuild. Read every section before writing any code.
> Do NOT patch existing CSS. Delete `SinglePlayerModes.css` and rewrite from zero.

---

## Page Layout Overview

```
[ NAV — global, unchanged ]
[ BACK TO HOME button — top left ]
[ HERO — centered title + subtitle ]
[ MODE CARDS GRID — 3 columns ]
[ MORE MODES SECTION — label + 4 locked cards ]
[ FEEDBACK ROW — centered ]
```

Page background: `#080c16`
Max content width: `1300px`, centered, `padding: 0 40px 60px`

---

## Section 1: Back to Home

Sits **above** the hero, aligned left to the card grid edge.

```
display: inline-flex
align-items: center
gap: 8px
background: rgba(255,255,255,0.05)
border: 1px solid rgba(255,255,255,0.12)
border-radius: 8px
padding: 9px 16px
font-size: 12px
font-weight: 700
letter-spacing: 1px
color: rgba(255,255,255,0.65)
cursor: pointer
margin-bottom: 20px
```

Text: `← BACK TO HOME`

---

## Section 2: Hero

Centered, no card/border behind it.

```
text-align: center
margin-bottom: 36px
```

- **Title**: `Single Player`
  - font-size: `64px`
  - font-weight: `900`
  - color: `white`
  - letter-spacing: `-1.5px`
  - line-height: `1`
  - margin-bottom: `10px`

- **Subtitle**: `Sharpen your skills. Master the game at your own pace.`
  - font-size: `16px`
  - color: `rgba(255,255,255,0.45)`
  - font-weight: `400`

---

## Section 3: Mode Cards Grid

```css
display: grid;
grid-template-columns: repeat(3, 1fr);
gap: 16px;
```

Each card shares this base structure:

```
display: flex
flex-direction: row
height: 260px
border-radius: 16px
overflow: hidden
position: relative
```

---

### Card Structure (all 3 cards)

Each card is split into **two horizontal panels**:

#### Left Panel — Character Image
```
width: 42%
flex-shrink: 0
position: relative
overflow: hidden
```

- Image fills the panel: `width: 100%; height: 100%; object-fit: cover; display: block;`
- NO padding, NO border-radius, NO background box
- Image bleeds to all edges of the panel

#### Right Panel — Content
```
flex: 1
min-width: 0
display: flex
flex-direction: column
justify-content: space-between
padding: 24px 20px
```

Content order (top to bottom):
1. Text block (title + description)
2. Stats row
3. Play Now button

---

### Card 1 — Play vs Fritz

```
border: 1px solid rgba(245, 184, 0, 0.3)
background: #090d18
```

**Image panel**:
- src: `/fritz2.png`
- object-position: `center 15%`
- Background behind image: `#0c0a05`

**Title**: `Play vs Fritz`
- color: `#f5b800`
- font-size: `22px`
- font-weight: `800`

**Description**: `Challenge Fritz, a world-class AI opponent with adaptive difficulty.`
- font-size: `13px`
- color: `rgba(255,255,255,0.5)`
- line-height: `1.5`
- margin-top: `6px`

**Stats**:
| Icon | Label | Value |
|------|-------|-------|
| 👑 | TOP RATING | 1,742 |
| ⚡ | BEST STREAK | 12 |

**Button border**: `1px solid rgba(245,184,0,0.4)`

---

### Card 2 — Ghost Mode

```
border: 1px solid rgba(77, 160, 255, 0.3)
background: #080d18
```

**Image panel**:
- src: `/fritzGHOST.png`
- object-position: `center center`
- Background: `linear-gradient(160deg, #060c1a 0%, #080f22 100%)`
- Image filter: `brightness(1.5) drop-shadow(0 0 28px rgba(77,160,255,0.85))`

**Title**: `Ghost Mode`
- color: `#4da0ff`
- font-size: `22px`
- font-weight: `800`

**Description**: `Race against your past games. Can you beat your best?`
- font-size: `13px`
- color: `rgba(255,255,255,0.5)`
- line-height: `1.5`
- margin-top: `6px`

**Stats**:
| Icon | Label | Value |
|------|-------|-------|
| 👑 | BEST TIME | 02:48 |
| 📊 | GAMES PLAYED | 24 |

**Button border**: `1px solid rgba(77,160,255,0.4)`

---

### Card 3 — No Brainer Lab

```
border: 1px solid rgba(160, 100, 255, 0.3)
background: #0a0812
```

**Image panel**:
- src: `/fritzLAB.png`
- object-position: `center 10%`
- Background: `#0a0812`

**Title**: `No Brainer Lab`
- color: `#a064ff`
- font-size: `21px` ← slightly smaller to fit one line
- font-weight: `800`

**Description**: `Solve curated puzzles and expand your chess intuition.`
- font-size: `13px`
- color: `rgba(255,255,255,0.5)`
- line-height: `1.5`
- margin-top: `6px`

**Stats**:
| Icon | Label | Value |
|------|-------|-------|
| 🧩 | PUZZLES SOLVED | 156 |
| ⚡ | BEST STREAK | 18 |

**Button border**: `1px solid rgba(160,100,255,0.4)`

---

### Shared Stats CSS

```css
.sp-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.07);
  margin-bottom: 12px;
}

.sp-stat-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 4px;
}

.sp-stat-value {
  font-size: 22px;
  font-weight: 800;
  color: white;
  display: block;
  line-height: 1.1;
  margin-top: 2px;
}
```

---

### Shared Play Now Button CSS

```css
.sp-play-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  height: 48px;
  border-radius: 10px;
  background: rgba(255,255,255,0.04);
  font-size: 14px;
  font-weight: 700;
  color: white;
  cursor: pointer;
  letter-spacing: 0.2px;
  transition: background 0.2s ease;
}

.sp-play-btn:hover {
  background: rgba(255,255,255,0.08);
}

.sp-btn-arrow {
  font-size: 18px;
  opacity: 0.6;
}
```

---

## Section 4: More Modes

Appears directly below the 3 mode cards. `margin-top: 40px`

### Section Header

```
margin-bottom: 16px
```

- **Title**: `More Modes`
  - font-size: `20px`
  - font-weight: `800`
  - color: `white`
  - display: `flex; align-items: center; gap: 8px`
  - Prefix dot: `●` — 8px, color `#f5b800`

- **Subtitle**: `New challenges coming soon.`
  - font-size: `14px`
  - color: `rgba(255,255,255,0.4)`
  - margin-top: `4px`

### Locked Cards Grid

```css
display: grid;
grid-template-columns: repeat(4, 1fr);
gap: 16px;
```

Each locked card:
```
background: #0a0d18
border: 1px solid rgba(255,255,255,0.07)
border-radius: 14px
padding: 40px 20px
display: flex
flex-direction: column
align-items: center
justify-content: center
gap: 12px
min-height: 160px
```

Contents:
- Lock icon circle:
  ```
  width: 48px; height: 48px
  border-radius: 50%
  background: rgba(255,255,255,0.06)
  border: 1px solid rgba(255,255,255,0.1)
  display: flex; align-items: center; justify-content: center
  ```
  - Lock icon: `🔒` or SVG padlock, 18px, color `rgba(255,255,255,0.3)`

- Label: `Coming Soon`
  - font-size: `14px`
  - font-weight: `600`
  - color: `rgba(255,255,255,0.35)`

- Sub-label: `New mode in development`
  - font-size: `12px`
  - color: `rgba(255,255,255,0.2)`

---

## Section 5: Feedback Row

Centered, below locked cards. `margin-top: 32px`

```
display: flex
align-items: center
justify-content: center
gap: 16px
```

- **Left text**: `💡 Have an idea for a new mode? We'd love to hear it.`
  - font-size: `14px`
  - color: `rgba(255,255,255,0.45)`

- **Right button**: `Share Feedback ›`
  - background: `transparent`
  - border: `1px solid rgba(245,184,0,0.5)`
  - border-radius: `8px`
  - padding: `10px 20px`
  - font-size: `13px`
  - font-weight: `700`
  - color: `#f5b800`
  - cursor: `pointer`

---

## Complete CSS File

Delete everything in `SinglePlayerModes.css` and replace with exactly this:

```css
.sp-page {
  background: #080c16;
  min-height: 100vh;
  color: white;
  font-family: inherit;
}

.sp-container {
  max-width: 1300px;
  margin: 0 auto;
  padding: 32px 40px 60px;
}

.sp-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 9px 16px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(255,255,255,0.65);
  cursor: pointer;
  margin-bottom: 20px;
}

.sp-hero {
  text-align: center;
  margin-bottom: 36px;
}

.sp-hero h1 {
  font-size: 64px;
  font-weight: 900;
  color: white;
  letter-spacing: -1.5px;
  line-height: 1;
  margin-bottom: 10px;
}

.sp-subtitle {
  font-size: 16px;
  color: rgba(255,255,255,0.45);
  font-weight: 400;
}

.sp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.sp-card {
  display: flex;
  flex-direction: row;
  height: 260px;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
}

.sp-card-fritz { border: 1px solid rgba(245,184,0,0.3); background: #090d18; }
.sp-card-ghost  { border: 1px solid rgba(77,160,255,0.3); background: #080d18; }
.sp-card-lab    { border: 1px solid rgba(160,100,255,0.3); background: #0a0812; }

.sp-card-image {
  width: 42%;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}

.sp-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 15%;
  display: block;
}

.sp-card-fritz .sp-card-img { object-position: center 15%; }
.sp-card-ghost .sp-card-img { object-position: center center; filter: brightness(1.5) drop-shadow(0 0 28px rgba(77,160,255,0.85)); }
.sp-card-lab   .sp-card-img { object-position: center 10%; }

.sp-card-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 24px 20px;
}

.sp-card-text h2 {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.1;
  margin-bottom: 6px;
}

.sp-card-fritz .sp-card-text h2 { color: #f5b800; }
.sp-card-ghost .sp-card-text h2 { color: #4da0ff; }
.sp-card-lab   .sp-card-text h2 { color: #a064ff; font-size: 21px; }

.sp-card-text p {
  font-size: 13px;
  color: rgba(255,255,255,0.5);
  line-height: 1.5;
}

.sp-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.07);
  margin-bottom: 12px;
}

.sp-stat-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 4px;
}

.sp-stat-value {
  font-size: 22px;
  font-weight: 800;
  color: white;
  display: block;
  line-height: 1.1;
  margin-top: 2px;
}

.sp-play-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  height: 48px;
  border-radius: 10px;
  background: rgba(255,255,255,0.04);
  font-size: 14px;
  font-weight: 700;
  color: white;
  cursor: pointer;
  transition: background 0.2s ease;
}

.sp-play-btn:hover { background: rgba(255,255,255,0.08); }
.sp-card-fritz .sp-play-btn { border: 1px solid rgba(245,184,0,0.4); }
.sp-card-ghost .sp-play-btn { border: 1px solid rgba(77,160,255,0.4); }
.sp-card-lab   .sp-play-btn { border: 1px solid rgba(160,100,255,0.4); }

.sp-btn-arrow { font-size: 18px; opacity: 0.6; }

.sp-more-modes { margin-top: 40px; }

.sp-more-header { margin-bottom: 16px; }

.sp-more-title {
  font-size: 20px;
  font-weight: 800;
  color: white;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sp-more-title::before {
  content: '●';
  font-size: 8px;
  color: #f5b800;
}

.sp-more-subtitle {
  font-size: 14px;
  color: rgba(255,255,255,0.4);
  margin-top: 4px;
}

.sp-locked-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.sp-locked-card {
  background: #0a0d18;
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 14px;
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 160px;
}

.sp-lock-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: rgba(255,255,255,0.3);
}

.sp-locked-label {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255,255,255,0.35);
}

.sp-locked-sub {
  font-size: 12px;
  color: rgba(255,255,255,0.2);
  text-align: center;
}

.sp-feedback-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 32px;
}

.sp-feedback-text {
  font-size: 14px;
  color: rgba(255,255,255,0.45);
}

.sp-feedback-btn {
  background: transparent;
  border: 1px solid rgba(245,184,0,0.5);
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 700;
  color: #f5b800;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s ease;
}

.sp-feedback-btn:hover { background: rgba(245,184,0,0.08); }
```

---

## JSX Structure to Match

```jsx
<div className="sp-page">
  <div className="sp-container">

    <button className="sp-back-btn" onClick={() => onNavigate('home')}>← BACK TO HOME</button>

    <div className="sp-hero">
      <h1>Single Player</h1>
      <p className="sp-subtitle">Sharpen your skills. Master the game at your own pace.</p>
    </div>

    <div className="sp-grid">
      {/* Card — repeat for fritz/ghost/lab */}
      <div className="sp-card sp-card-fritz">
        <div className="sp-card-image">
          <img src="/fritz2.png" alt="Play vs Fritz" className="sp-card-img" />
        </div>
        <div className="sp-card-content">
          <div className="sp-card-text">
            <h2>Play vs Fritz</h2>
            <p>Challenge Fritz, a world-class AI opponent with adaptive difficulty.</p>
          </div>
          <div className="sp-stats">
            <div className="sp-stat-item">
              <span className="sp-stat-label">👑 TOP RATING</span>
              <span className="sp-stat-value">1,742</span>
            </div>
            <div className="sp-stat-item">
              <span className="sp-stat-label">⚡ BEST STREAK</span>
              <span className="sp-stat-value">12</span>
            </div>
          </div>
          <button className="sp-play-btn">Play Now <span className="sp-btn-arrow">›</span></button>
        </div>
      </div>
    </div>

    <div className="sp-more-modes">
      <div className="sp-more-header">
        <p className="sp-more-title">More Modes</p>
        <p className="sp-more-subtitle">New challenges coming soon.</p>
      </div>
      <div className="sp-locked-grid">
        {[1,2,3,4].map(i => (
          <div key={i} className="sp-locked-card">
            <div className="sp-lock-icon">🔒</div>
            <span className="sp-locked-label">Coming Soon</span>
            <span className="sp-locked-sub">New mode in development</span>
          </div>
        ))}
      </div>
    </div>

    <div className="sp-feedback-row">
      <span className="sp-feedback-text">💡 Have an idea for a new mode? We'd love to hear it.</span>
      <button className="sp-feedback-btn">Share Feedback ›</button>
    </div>

  </div>
</div>
```

---

## Checklist — Verify Before Done

- [ ] Cards are horizontal row layout (image left, content right) — NOT stacked vertically
- [ ] Card height is exactly `260px` — no taller, no shorter
- [ ] Image panel is `42%` width with zero padding — image bleeds to all edges
- [ ] Ghost image has blue glow filter applied
- [ ] "No Brainer Lab" title fits on ONE line (font-size 21px)
- [ ] Stats have `border-top` separator above them
- [ ] Play Now button has `justify-content: space-between` with arrow on right
- [ ] Each card button border matches its accent color
- [ ] More Modes section shows 4 locked cards in a 4-column grid
- [ ] Feedback row is centered with gold-bordered button
- [ ] Zero horizontal overflow — all text clips within card bounds
- [ ] `min-width: 0` is set on `.sp-card-content`
