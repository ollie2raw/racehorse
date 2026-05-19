# AGENTS

## 1. Product identity

- Racehorse Dominoes is a premium daily dominoes strategy platform.
- The homepage screenshot is the locked source of truth for the platform identity.
- The product should feel like a premium web game platform: closer to Chess.com Premium, NYT Games, Apple Arcade, or a polished daily strategy game.
- It should not feel like casino, fantasy, western, SaaS, childish mobile game, generic dashboard, or luxury tabletop mockup.

## 2. Racehorse Design Source of Truth

For all UI work, the canonical visual source of truth is the Play vs Fritz matte/neon panel system.

Before changing UI, read:

- `docs/agent-skills/racehorse-design-source-of-truth.md`
- `docs/agent-skills/ui-fidelity.md`

Deprecated:

- walnut as a visual direction
- brown casino/table styling
- old warm board theme
- generic sci-fi dashboards
- dense nested bordered cards
- tiny low-contrast text

Important:

Some legacy CSS/classes may still include “walnut” in the name. Treat those as implementation artifacts only. They are not design guidance.

## 3. Locked visual system from homepage

- Deep midnight navy / blue-black background.
- Subtle large-scale geometric linework in the background.
- Premium dark glass cards with thin blue/brass borders.
- Electric blue/cyan accents for Daily Puzzle, navigation, active states, and UI energy.
- Restrained brass/warm gold accents for Daily Fritz, Racehorse scoring/racing identity, and premium emphasis.
- Warm ivory/soft white typography.
- Large bold editorial headings, compact uppercase HUD labels, and clean modern hierarchy.
- Rounded cards with controlled glow, soft shadows, and subtle depth.
- Matte solid surfaces—not gradients. Use crisp borders, subtle shadows, and restrained accent colors. Avoid gradients across the app; they feel less premium and less aligned with the Play vs Fritz identity.
- Realistic ivory domino tiles with restrained shadows.
- Mode color identities:
  - Daily Fritz / Single Player = brass/gold
  - Daily Puzzle / Multiplayer = electric blue
  - Learn = green/cyan
  - Tournament = amber/orange
  - Leaderboard/secondary neutral = cool gray/white
- Visual density should feel premium and intentional, not sparse or generic.

## 4. Engineering rules

- Preserve gameplay logic unless explicitly told otherwise.
- Do not rewrite working game systems during visual tasks.
- Do not change scoring, draw/pass, move validation, bot logic, multiplayer logic, Supabase logic, API behavior, or data models unless the task explicitly requires it.
- Read relevant files before editing.
- Prefer the smallest responsible set of changes.
- Avoid opportunistic refactors.
- Do not layer multiple competing design systems in the same screen.
- If a redesign requires structural cleanup, explain it first and keep the scope controlled.

## 5. Standard commands

- Client build: `npm run build --prefix client`
- Server build: `npm run build --prefix server`

## 6. Viewport-locked shell (no accidental page scroll)

Primary menu and mode-hub screens must live inside the app chrome contract from `client/src/App.css` (`.app`: `height: 100dvh`, `overflow: hidden`, column flex). The screen’s **root wrapper** must participate in that flex chain so content cannot grow the document and force vertical scrolling:

- Use `flex: 1 1 0`, `min-height: 0`, `max-height: 100%`, and `overflow: hidden` on the screen root (along with `display: flex; flex-direction: column`).
- **Do not** put `min-height: 100vh` (or unconstrained tall stacks) on the screen root; it breaks the shell and can push `body` scroll past the viewport.
- Lay out below the nav with a **flex column**: fixed-height or `flex-shrink: 0` regions (hero, toolbars, card rows), `contain: paint` / `overflow: hidden` on cards so art does not bleed past `border-radius`, and **compress** secondary blocks (footers, “more” strips) until everything fits in one view.
- **References to match:** `HomeScreen.tsx` + `home-shell` / `RacehorseHomeArt.css` daily cards; `PlayVsFritz.tsx` + `PlayVsFritz.css` (`pvf-root`); Single Player hub: `SinglePlayerHubScreen.tsx` + `SinglePlayerModes.css` (`.sp-page`).
- Long-form or data-heavy surfaces (e.g. full history tables) are the exception: they should be **designed** with an internal scroll region, modal, or separate full-page pattern—not an accidentally tall default layout.

## 7. UI redesign workflow

- First inspect relevant files.
- Then identify the existing screen structure.
- Then compare current screenshot vs the locked homepage identity and/or supplied target screenshot.
- Then identify visual gaps by region.
- Then propose a scoped plan.
- For planning/review tasks, stop for approval before implementation.
- For direct implementation tasks, proceed when the user explicitly says to proceed or explicitly asks Codex to implement.
- For big redesigns, implement one pass at a time.
- After each pass, report changed files, build status, and remaining visual gaps.

## 8. Match/in-game board redesign rules

- The in-game board should inherit the homepage identity, not become a separate unrelated sci-fi skin.
- Use the homepage’s dark navy, blue glow, restrained brass, ivory tiles, premium cards, and clean hierarchy.
- The target in-game board reference can guide layout/depth, but the homepage remains the brand identity anchor.
- Preserve the score race track as a key Racehorse signature element.
- Keep the board premium, game-native, and strategic.
- Avoid brown casino-table styling, ornate racing tropes, neon overload, or generic HUD clutter.

## 9. Final response format

Every coding task should end with:

- Files changed
- What changed
- Build/test result
- Remaining risks or visual gaps
