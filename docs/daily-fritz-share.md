# Daily Fritz Share Card Implementation

Read AGENTS.md first. Do not touch engine, scoring, bot logic, or game rules.

## Step 1 — Extend the view model

In client/src/dailyFritz/setOverlayViewModel.ts add to DailyFritzSetOverlayViewModel:

shareDate?: string;
shareTier?: string;
shareRating?: number;
shareStreak?: number;

## Step 2 — Populate in DailyFritzScreen

In client/src/dailyFritz/DailyFritzScreen.tsx, when building kind: 'final' overlay:
- shareDate: format run_date as "May 23, 2026"
- shareTier: from fritz_tier, capitalize first letter
- shareRating: from profile?.glicko_rating, round to integer
- shareStreak: from today?.streak ?? 0

## Step 3 — Create shareCard.ts

Create client/src/dailyFritz/shareCard.ts:

First inspect how vm.games items are shaped in DailyFritzScreen.tsx and use real field names.

Export function buildShareText(vm: DailyFritzSetOverlayViewModel): string
Build lines:
- "🏇 Daily Fritz · {shareDate}"
- "{resultValue} vs {shareTier} Fritz"
- One line per game: "G1 ✓ 60-38" or "G2 🦨 SKUNK 63-11" if skunk
- "{marginValue} margin · {shareRating} rating"
- "🔥 {shareStreak} day streak" (omit if streak is 0)
- "racehorsedoms.vercel.app"

## Step 4 — Add UI to result overlay

In BotMatchScreen.tsx find the kind === 'final' daily fritz result JSX.
Above the button row insert:

- A div.df-share-card containing:
  - div.df-share-preview with a <pre class="df-share-text"> showing buildShareText(dailyFritzSetOverlay)
  - div.df-share-actions with two buttons side by side:
    - button.df-share-copy: gold background #f0c040, text color #0d1421, says "Copy result", on click writes share text to clipboard and shows "✓ Copied!" for 2500ms
    - a.df-share-x: links to https://x.com/intent/tweet?text={encoded share text}, target _blank, says "Post to X"

Add useState(false) for shareCopied. Add useCallback for handleCopyShare.

## Step 5 — CSS

Add to client/src/styles/match-hud-polish.css:

.df-share-card { margin: 16px 0; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); }
.df-share-preview { background: rgba(0,0,0,0.35); padding: 14px 16px; }
.df-share-text { font-family: monospace; font-size: 13px; line-height: 1.7; color: rgba(255,255,255,0.8); margin: 0; white-space: pre; user-select: all; }
.df-share-actions { display: flex; border-top: 1px solid rgba(255,255,255,0.08); }
.df-share-btn { flex: 1; padding: 11px 0; text-align: center; font-size: 13px; font-weight: 600; cursor: pointer; border: none; text-decoration: none; transition: opacity 120ms ease; display: flex; align-items: center; justify-content: center; }
.df-share-btn:hover { opacity: 0.85; }
.df-share-copy { background: #f0c040; color: #0d1421; }
.df-share-x { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.85); border-left: 1px solid rgba(255,255,255,0.08); }

## Step 6 — Build

Run npm run build --prefix client. Fix any TypeScript errors.
Report: actual field names found in vm.games items, any missing fields, confirmation share text renders for normal and skunk finish.
