# Play vs Fritz UI Standard

## Purpose

The Play vs Fritz screen is the current premium game-mode UI standard for Racehorse.

When working on any major Racehorse screen, especially hero modes, agents must use Play vs Fritz as the benchmark for:

- visual quality
- brand identity
- layout discipline
- component polish
- immersive game feel
- readability
- matte premium styling
- restrained accent usage
- production-readiness

A screen is not finished just because it builds. It is finished only if it feels like it belongs beside Play vs Fritz.

---

## Current Production References

The two strongest visual references in Racehorse are:

1. **Home page**
   - macro product identity
   - broad Racehorse navigation / platform feel

2. **Play vs Fritz page**
   - premium game-mode identity
   - matte command-panel language
   - Fritz character presentation
   - gold selected-state system
   - best current example of complete UI quality

For game-mode pages, **Play vs Fritz is the primary reference**.

---

## What Play vs Fritz Gets Right

Agents must study and preserve the following qualities:

### 1. Matte Premium Surfaces

Play vs Fritz feels premium because surfaces are:

- dark
- matte
- restrained
- dimensional without being flashy
- built with borders, shadows, opacity, and spacing

It does not feel like a generic SaaS dashboard or fantasy-game mockup.

### 2. Clear Game-Mode Composition

The screen has strong visual hierarchy:

- left side establishes identity/emotion
- right side controls the user action
- sections are ordered clearly
- CTA is obvious
- card groups feel intentional

The layout feels engineered and product-ready.

### 3. Strong Selected State

The selected Elite card works because it uses:

- restrained gold border
- subtle glow
- confident scale
- clear hierarchy
- readable typography
- check/active affordance

Selected states across the app should feel this deliberate.

### 4. Premium Fritz Identity

Fritz is not just decoration. Fritz is the emotional anchor.

Screens involving Fritz should preserve:

- bot personality
- premium robot artwork
- clear opponent framing
- playful but polished tone
- competitive practice energy

### 5. Older-Audience Readability

Play vs Fritz is readable because:

- important text is large enough
- CTAs are obvious
- hierarchy is clear
- labels are not overly tiny
- contrast is controlled

Do not make screens feel cryptic, faint, or overly minimal.

---

## Hard Visual Rules

### No Gradients Unless Explicitly Approved

Racehorse UI should avoid gradients by default.

Do not use:

- `linear-gradient`
- `radial-gradient`
- gradient buttons
- gradient overlays
- gradient scrims
- gradient card backgrounds
- fake glowing color washes

Use instead:

- solid matte dark surfaces
- rgba overlays
- crisp borders
- inset borders
- subtle shadows
- restrained gold accents
- clean spacing

Gradients make the product feel less premium and less aligned with the Play vs Fritz identity.

### No Fantasy/Event-Dashboard Overdesign

Avoid:

- theatrical arena UI
- RPG/mobile-game event styling
- huge glowing symbols
- fake ceremonial UI
- overdecorated panels
- visual noise
- concept-art interfaces

Racehorse should feel like a premium strategy-game product, not a fantasy dashboard.

### No Generic SaaS/Admin Dashboard UI

Avoid:

- flat status widgets
- bland stat cards
- table-like module stacks
- dashboard rows with no emotional weight
- generic product templates

Game modes should feel like playable experiences, not admin pages.

---

## Typography Rule

Agents must not create a new typography feel for major Racehorse screens.

For game-mode screens, inspect Play vs Fritz typography before editing:

- page title
- hero title
- eyebrow labels
- section labels
- card values
- CTA text

New screens should mirror those font-family, font-weight, line-height, and letter-spacing choices unless the user explicitly asks for a new typographic direction.

---

## Required UI Qualities

Every major Racehorse screen should feel:

- premium
- matte
- restrained
- confident
- readable
- intentional
- immersive
- productized
- game-native
- emotionally connected to the mode

It should not feel:

- flat
- cramped
- arbitrary
- noisy
- generic
- experimental
- like a mockup
- like concept art
- like a dashboard
- worse than Play vs Fritz

---

## Daily Fritz Specific Standard

Daily Fritz is the flagship daily hero mode.

It should feel at least as complete and immersive as Play vs Fritz.

Daily Fritz should communicate immediately:

- today's set is live
- Fritz is waiting
- everyone gets the same hand
- no resets
- best of 3
- Game 1 is active
- leaderboard/streak matter
- the CTA is the next action

Daily Fritz should not feel like:

- a settings panel
- a copied Play vs Fritz layout
- a dashboard
- an over-glowy event mockup
- a collection of boxes

Daily Fritz should use Play vs Fritz as the **quality standard**, not necessarily the exact layout.

---

## Before Editing Any UI

Before modifying a Racehorse hero/game-mode screen, the agent must answer:

1. What does Play vs Fritz do well that applies here?
2. What existing screen/page is the closest standard?
3. What exact visual qualities must be preserved?
4. What current elements feel lower-quality than Play vs Fritz?
5. What logic must be preserved?
6. What presentation code can be replaced?

If the agent cannot answer these, it should not start coding.

---

## Implementation Rules

Agents must:

- preserve working logic and handlers
- separate presentation from gameplay/data logic
- use simple grid/flex layouts
- avoid absolute positioning for main content
- avoid negative-margin layout hacks
- avoid overflow-hidden masking to hide broken layouts
- avoid sticky/floating CTA overlays unless explicitly required
- avoid fake stats
- avoid fake player counts
- keep text readable
- keep CTAs obvious
- test at realistic desktop sizes

Agents must not claim success only because the build passes.

Visual fidelity is part of the task.

---

## Required Verification

Before reporting completion, agents must compare the updated screen against Play vs Fritz.

They must answer:

1. Does this screen feel as production-ready as Play vs Fritz?
2. Does it preserve Racehorse matte premium identity?
3. Is there any gradient usage left?
4. Does any component feel like generic SaaS/dashboard UI?
5. Is the CTA obvious within two seconds?
6. Is all important text readable?
7. Is any content clipped or overlapping?
8. Are all displayed numbers real?
9. Would this page look embarrassing beside Play vs Fritz?

If the answer to #9 is yes, the task is not complete.

---

## Required Final Report

For UI work, final reports must include:

1. Files changed
2. Logic preserved
3. Presentation code replaced or removed
4. How the screen now aligns to Play vs Fritz
5. Confirmation that gradients were avoided or removed
6. Build result
7. Manual visual check notes
8. Remaining visual risks
9. Safe commit commands with explicit file paths only

---

## Non-Negotiable Standard

If the proposed solution would look worse than the current Play vs Fritz page, do not implement it.

Play vs Fritz is the standard.
