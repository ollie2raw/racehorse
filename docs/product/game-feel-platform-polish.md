# Game feel / platform polish exploration

Base: `0bb1b2203e94fbbe2feb382116898bff02c56c74`. Branch: `explore/game-feel-platform-polish`.
No backend, rules, review evaluation, ratings, persistence, auth, protocol, migration, or production changes.

## Product feel assessment (audit before implementation)

The strongest assets are the ivory tiles, restrained navy arena, legible score cards,
compact open/boneyard controls, and the Play vs Fritz setup hierarchy. These already
belong to a professional strategy platform. Preserve the race track and geometry.

The weakness is consistency of feedback, not a lack of animation. The CSS stack
contains overlapping placement animations (50/320/650ms), perpetual turn pulses,
a disabled new-draw effect, and position-dependent hand keys. A new player can see
motion without always knowing which event it acknowledges. Bot cadence includes
substantial deliberate waits; these can make the interface feel slow even when
rendering is fast. This exploration does not change those timers.

### Audit coverage and existing mechanisms

- Browser: Home, Single Player, Play vs Fritz setup and actual match, Daily Fritz
  signed-out landing/leaderboard, Social error/empty states, Stats empty state,
  Settings, profile sign-in gate. Existing deterministic fixture renders real
  multiplayer HUD, board, rack, controls. Real solo play exercises selection,
  placement, draw, scoring and handoff. Signed-in Daily Fritz/history/profile and
  real network reconnect are source-reviewed, not live-service validated.
- Match HUD: `BotMatchLiveTurnHud`, `BotMatchLiveHud`, `LiveMatchScreen`.
  Text/color and active player accents already convey ownership; several infinite
  glow animations overlap. Multiplayer has turn, score and draw live regions.
- Hand: hover lift, press compression, selected brass border, legal underline,
  disabled opacity, button semantics. Inline tile transitions compete with CSS;
  bot keys include row/index, which remounts neighbours after removal.
- Placement: Board wrapper entry and last-played drop/highlight already exist.
  All mounted tiles can animate on initial load/recovery. Rotation/camera/routing
  belong to authoritative rendering and must remain independent of feedback.
- Draw: `usePlayerDrawAnimation`, flying face-down overlays and `new-draw` class
  already exist. Theme explicitly disables the new-draw animation. Opponent rack
  uses count only; never needs hidden tile identities. Multi-draw flights already
  exist; do not introduce an additional queue or change draw cadence.
- Score: `AnimatedScore` / `useAnimatedScore`, score-hit classes, committed
  score event resolver, event-id keyed `BotMatchScoreToastOverlay` (+N), score
  sounds. Bot HUD has count-up but no consistent number acknowledgment.
  JS counting ignores the global CSS reduced-motion catch-all.
- Pass: existing status/toast and turn update. Preserve it; acknowledge with the
  same handoff vocabulary rather than an extra interrupting dialog.
- Hand end: shared `HandOverModal` explains winner, remaining pips/tiles and award;
  auto-advance progress exists. Resulting match score is less connected to that
  explanation. Entry animation exists. Do not alter lifecycle or auto-advance.
- Match completion/post-game: `GameOverModal`, standalone Fritz result, Daily
  set result, score/rating count-up, rematch/review actions already exist. Review
  is lazy-loaded. No evaluation changes are needed for a better reveal.
- Reconnect/loading: LiveMatchScreen recovery banners/retry and disconnected
  state, ScreenLoader (entrance + repeating scan), Daily Fritz phased loading,
  profile/stats skeletons. Leaderboard replaces contents with plain Loading text.
- Platform: persistent GlobalNav, button hover/press/focus, shared Modal entry,
  shared toast slide with spring-like easing, per-screen card transitions, empty
  state CTAs. Motion timing is spread across CSS; no Framer Motion dependency.
- Icons: Lucide is installed and used on hubs/social/learning; match controls also
  have small custom SVGs. Boneyard already has its own stack icon; replay uses
  text chevrons; some Social indicators use emoji. No new icon dependency needed.
- Sound: existing lazy Web Audio synthesis plus an existing imported tile sample,
  mute preference and settings toggle. Tile, draw, score, turn, blocked, hand
  win/loss, match win/loss, match-found events already exist. No haptic/vibration
  implementation found. No sound assets or extra sound engine needed.

## Top 10 opportunities

| Rank | Event → feedback → purpose | Impact | Effort | Risk |
|---|---|---|---|---|
| 1 | Ownership changes → finite pill reveal + steady side accent → obvious control handoff | High | Low | Low |
| 2 | One tile committed → short local landing only on that tile → connect action and board without replaying hydrated state | High | Medium | Low/medium |
| 3 | Score changes → brief number emphasis + existing count/chip → reward a small score without clutter | High | Low | Low |
| 4 | Tile drawn/played → preserve neighbour DOM; new tile emphasis → retain physical continuity | High | Low | Low |
| 5 | Open/boneyard count changes → brief keyed readout emphasis, immediate exact number → connect action and resource | Medium | Low | Low |
| 6 | Hand ends → award and resulting match score together → make the scoring consequence clear before next deal | High | Medium | Medium |
| 7 | Match completes → score lock-in and restrained winner reveal → satisfying win and composed loss | High | Medium | Medium |
| 8 | Leaderboard filter/fetch → retain geometry with existing skeleton vocabulary → prevent a fast fetch feeling like a reset | Medium | Medium | Low |
| 9 | History/review opens → stable board-to-review handoff and loaded-state continuity → preserve context | Medium | Medium | Medium |
| 10 | Card/nav action → consistent focus/press/settle using motion tokens → platform-wide responsiveness | Medium | Medium | Low |

## Motion language (defined before implementation)

Fast, deliberate, no bounce/overshoot. State always commits independently.
Use transform/opacity for movement. Never wait for animation completion to act.

| Role | Duration | Use |
|---|---|---|
| Micro | 120ms | hover, press, counter acknowledgment |
| State | 180ms | turn label replacement / handoff |
| Tile | 220ms | local landing, hand draw settle |
| Result | 300ms | modal/result reveal (future adoption) |
| Reward | 360ms | score count and emphasis |

Easing: settle `cubic-bezier(.2,.8,.2,1)`; press `cubic-bezier(.4,0,1,1)`.
Central CSS tokens and matching JS duration constants; existing gameplay cadence
constants remain untouched. This is an incremental adoption, not a global retime.
Reduced motion: exact final score immediately, no RAF, no positional feedback or
perpetual activity. Keep text, borders, selected state, numbers and announcements.
Hidden document: no new board motion or score interpolation. Returning to a tab,
mounting a board, recovery, scrubbing history and batch updates do not replay tiles.

## Scoped first slice

1. Shared turn label with a finite keyed reveal and a steady activity mark.
2. Board landing gated by enabled presentation, hand identity and exactly one
   added public tile; animate the tile interior, preserving wrapper/camera math.
3. Reuse AnimatedScore: faster default count, finite number emphasis, final-value
   semantics, reduced-motion and hidden-document handling, no idle frame loop.
4. Stable bot-hand tile keys; restore finite draw emphasis; focus matches hover
   without stacking transforms on guided tile wrappers.
5. Immediate exact compact resource counts with finite change feedback; no count
   interpolation for strategic numbers and no new icons beside existing ones.

## Further recommendations

Board life should come from discrete events and steady active-end/side accents,
not animated backgrounds or particles. Keep the dominoes central. A future score
flight should use the existing committed event ID and real source/target anchors,
not infer events from hydrated score totals. This slice uses the existing chip and
HUD number rather than adding a competing points overlay.

Hand-end follow-up: show the resulting score alongside the already excellent
remaining-pips explanation, keep the prior board visible under the modal, then
crossfade only the presentation layer on the next committed hand. Do not delay deal.
Game-end follow-up: emphasize the winner once, lock final score, then expose one
primary next action and a quieter review action. No confetti needed.

Platform: adopt the same durations in existing Button/Modal/toast primitives in a
separate pass; preserve content and focus through loads. Reuse profile/stats
skeletons where fetches replace large regions. Rank movement should animate only
when old/new rows belong to the same loaded list; never fabricate rank changes.

Icons: retain boneyard stack, live dot, existing settings/navigation icons. Consider
Lucide GitBranch for Open only if comprehension testing supports it; add a title
such as Open-end total rather than another unexplained symbol. Replace emoji in
Social with Lucide in a separate consistency pass. Keep replay chevrons accessible.

Sound/haptics: reuse existing muted-capable sound calls; disabled sound must leave
all events understandable. No audio changes here. Future native haptics should be a
small opt-in Capacitor adapter separate from Web Audio: light placement/draw,
restrained score, stronger hand/game win; avoid a vibration every opponent turn.
Use feature detection and user preference; never bind game progression to it.

## Implemented first slice / files changed

- `client/src/ui/motion.ts`, `motion.css`: central presentation durations/easing,
  reduced-motion and document visibility subscription. No gameplay scheduler imports.
- `components/TurnStatus.tsx`, `turnStatus.css`; bot `BotMatchLiveTurnHud.tsx` and
  `match/LiveMatchScreen.tsx`: finite label handoff and steady ownership marker.
- `components/Board.tsx`, `board/usePlacementFeedback.ts`, `placementFeedback.css`;
  bot `BotMatchBoardStage.tsx`: incremental public-tile landing, explicit history/
  recovery gating, initial/batch/new-hand suppression. Board memo includes
  presentation/hand lifecycle flags so a disabled state cannot be memo-skipped.
- `components/AnimatedScore.tsx`, `animatedScore.css`, `hooks/useAnimatedScore.ts`:
  360ms default count, finite score acknowledgment, final-value accessible name,
  no RAF under reduced motion/hidden tabs, cancellation and exact resume handling.
  The number cue yields to an existing score-card pulse, avoiding compounded scale.
- `bot/BotHandTray.tsx`: stable face-based keys within each row. A tile crossing
  between rows on a stacked-hand rebalance can still remount; no new FLIP system.
- `match/match-live-theme.css`, `styles/match-gameplay.css`: remove competing long
  board-wrapper entry and perpetual turn pulses; restore finite new-draw emphasis,
  unify hand press/settle timing, visible keyboard focus, prevent double selected
  lift, and explicitly disable new draw/card/hand-transition effects under reduction.
- `components/FeedbackNumber.tsx`, `feedbackNumber.css`, `BoardOpenEndsPill.tsx`,
  `BoneyardCountPill.tsx`: immediate exact readouts with finite change acknowledgment.
- `components/GameFeel.test.tsx`, `board/usePlacementFeedback.test.tsx`,
  `e2e/game-feel.spec.ts`, `e2e/harness/game-feel.html`, `gameFeelHarness.tsx`,
  `playwright.game-feel.config.ts`: deterministic frontend-only states/assertions.
- This report and `game-feel-evidence/`: matched screenshots and a motion recording.

## Before / after

Before: entry effects can replay whole boards, small score changes count for 600ms,
turn cards breathe continuously, draw entry is disabled, indexed bot-hand keys can
replace neighbours, and reduced motion leaves JS score frames running.

After: only a new incremental public tile settles locally (220ms); score numbers
acknowledge in 360ms, turn labels hand off in 180ms, draw entry returns, same-row
neighbours retain their DOM identity, and reduced-motion scores render exactly with
no animation frames. Resource numbers remain exact throughout. See
[matched visual proof and video](game-feel-evidence/README.md).

## Performance / accessibility

No added dependency, asset fetch, sound, timer, animation queue, or DOM measurement
in the feedback path. New effects use opacity and transform/translate/scale. Tile
rotation, camera positioning, legal hit targets and authoritative board state are
independent of the effect. Inputs are never gated on completion. No idle JS loop.
Existing placement-zone/glow effects outside the turn-card changes remain.

Reduced-motion updates and tab hiding cancel score RAFs; re-enabling does not
replay prior scores. Exact final-value accessible names accompany visual count-up.
Existing live announcements and button semantics remain. Keyboard focus is explicit.
Normal and reduced-motion browser coverage includes Chromium and WebKit phone
landscape; 844 × 390 fixture document/viewport bounds were equal (no page overflow).
A real low-end iPhone / Instruments profiling pass is still needed; 60fps and native
performance are design targets, not a measured guarantee from desktop emulation.

## Validation and limits

- Client lint: passes at the existing 50-warning budget, zero errors; the added
  feedback code contributes no new lint warning.
- Typecheck: passes.
- Architecture / responsive policy: 22/22 invariants and viewport policy pass.
- Targeted component/regression checks: 40 tests across 11 files pass (shared
  number behavior, reduced motion/visibility, hand identity, geometry, modal
  lifecycle, settings, and existing number consumers).
- Browser suite: 39 checks pass, comprising 33 existing board routing/clearance
  checks plus normal/reduced-motion feedback in desktop Chromium, phone-landscape
  Chromium and phone-landscape WebKit. Scoring/card cascade received an additional
  six-case run after the final deduplication change.
- Standard build initially stops at unresolved owner legal configuration. Full
  client build passes with the repository's existing inert CI-only legal values
  from `.github/workflows/ci.yml` (not release facts). Existing large-chunk warning
  remains. No deployment occurred.
- `PROGRESS-F.md` was absent in the canonical workspace; it could not be read.
- No live authenticated Daily Fritz, persisted history, network multiplayer/recovery,
  full game completion, or VoiceOver certification claimed. Those paths were
  source-reviewed and/or checked through shared deterministic UI, not production.
- Final real Play vs Fritz smoke reached a Fritz-won hand with score/draw/turn
  feedback and the existing automatic hand-end panel; no uncaught page errors.
- Local dependency installation was reused; no manifest/lockfile changes.

## Independent review adjustments (integration pass)

The slice was independently reviewed against the real LiveMatchScreen/Board/CSS (`e2e/game-feel-review.spec.ts`, which counts
`animationstart` events and inspects `document.getAnimations()`), on desktop and phone/Safari landscape. Changes made:

- **Turn dot removed (rejected).** The leading "steady activity mark" widened the central turn pill, which moved the neighbouring
  score card 2px at 740/667 wide and grew the label 7px at 844. It added no meaning (identical for both seats; the text and the
  your-turn/opp-turn treatment already carry ownership). The finite text reveal stays; the earlier "steady ownership marker" wording
  above describes the original proposal. Evidence screenshots in `game-feel-evidence/` predate this and still show the dot.
- **`feedbackScope` instead of `handNumber` on the multiplayer Board.** `handNumber` also drives Board's reset/camera signature,
  and multiplayer never passed it; passing it would have changed multiplayer camera behaviour as a side effect. Placement feedback
  now takes its own prop (falls back to `handNumber`, so the bot screen, which already passed it, is unchanged).
- **No new `!important`.** `placementFeedback.css` and the hand-tile transition no longer add `!important` (the repo rule); the
  existing ones that were only re-valued stay.
- Left as proposed: finite placement landing on the tile content only, score acknowledgment + exact accessible value, exact
  open/boneyard readouts, stable bot-hand keys with finite draw emphasis, central motion tokens. Known residual: the older
  `last-played-neon-glow` on the last-played tile is a pre-existing mount-time effect and was not changed here.

## Git / canonical / production

Exploration branch starts exactly at the requested candidate. No merge/integration,
push, or production deployment is part of this pass. The existing canonical
workspace and `feat/app-store-candidate` were not edited or checked out. The
candidate object `0bb1b2203e94fbbe2feb382116898bff02c56c74` remains the unchanged base.
Production: **NOT TOUCHED**.
