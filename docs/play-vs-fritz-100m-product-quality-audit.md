# Play vs Fritz $100M Product Quality Audit

## Executive Verdict

Play vs Fritz is already the strongest identity anchor in the product. The setup screen, live board palette, ivory tiles, matte dark surfaces, and premium brass/blue accent language are materially closer to a polished competitive web game than to a prototype.

It is not yet fully at the "this mode sells the whole product in 30 seconds" bar. The biggest remaining gaps are product clarity and flagship polish, not rules logic:

- no visible `View tier details` affordance despite prior product intent
- some copy overclaims behavior, especially around "practice rating"
- older-player readability is still too small in several key places
- the live match feedback system is functionally rich, but some cues are still too subtle or too transient to feel authoritative in-browser
- reload/abandon behavior is still pragmatic rather than premium

Net: no static-audit `P0` was confirmed in Play vs Fritz, but there are several real `P1` items before this should be treated as the canonical premium mode for public beta.

---

## 1. First Impression / Flagship Quality

### What works

- The setup shell in [client/src/bot/PlayVsFritz.tsx](/Users/olivermorid/racehorse-dominoes/client/src/bot/PlayVsFritz.tsx) and [client/src/styles/_pvf-layout.css](/Users/olivermorid/racehorse-dominoes/client/src/styles/_pvf-layout.css) is the right core identity:
  - dark matte navy background
  - restrained neon/blue geometry in the backdrop
  - premium dark glass panels
  - strong Fritz hero card
  - clear gold/blue tier accents
- The live match surface in [client/src/match/match-live-theme.css](/Users/olivermorid/racehorse-dominoes/client/src/match/match-live-theme.css) and [client/src/match/match-live-surface.css](/Users/olivermorid/racehorse-dominoes/client/src/match/match-live-surface.css) is appropriately premium:
  - board feels like a game arena, not a SaaS card
  - ivory tiles are strong and recognizable
  - score pills and hand dock feel intentional
- Hand-end and game-end surfaces inherit the same visual grammar instead of changing into a random modal system:
  - [client/src/components/handOver/HandOverModal.tsx](/Users/olivermorid/racehorse-dominoes/client/src/components/handOver/HandOverModal.tsx)
  - [client/src/components/GameOverModal.tsx](/Users/olivermorid/racehorse-dominoes/client/src/components/GameOverModal.tsx)

### What feels off

- The setup screen is premium, but not fully "flagship decisive." It lacks one layer of product confidence:
  - no tier-details affordance
  - no sharper explanation of who each tier is for
  - no stronger confidence-building guidance for first-time users
- A few elements still lean slightly "designed component" instead of "high-end game surface":
  - gradients remain on the primary CTA and result buttons, which is slightly off the matte-source-of-truth direction
  - some copy blocks are informative but generic rather than sharply game-native

### Severity

- `P1`: missing tier-details guidance
- `P2`: residual gradient/button polish mismatch

---

## 2. Difficulty Tier Clarity and Default Tier Behavior

### What works

- Default tier behavior is correct.
  - [client/src/bot/pvfTierPreference.ts](/Users/olivermorid/racehorse-dominoes/client/src/bot/pvfTierPreference.ts) resolves to `standard` when no stored preference exists.
  - [client/src/bot/PlayVsFritz.tsx](/Users/olivermorid/racehorse-dominoes/client/src/bot/PlayVsFritz.tsx) initializes from that preference and persists changes.
- The tier ladder is materially better than raw Elo-only presentation:
  - `Rookie / Standard / Elite / Master`
  - role labels: `Beginner / Balanced / Competitive / Expert`
  - approximate strength copy instead of precise rating claims
- Standard is clearly intended for most players in the data:
  - `Best for most players — a fair, steady challenge.`

### Risks

- There is currently no visible `View tier details` control in the actual screen, even though the prior product pass called for it.
  - There is even a dormant `.pvf-view-tiers` style in [client/src/styles/_pvf-layout.css](/Users/olivermorid/racehorse-dominoes/client/src/styles/_pvf-layout.css), which strongly suggests the affordance was planned but not wired.
- The current ladder still requires the player to infer too much:
  - when to pick Rookie vs Standard
  - whether Elite is "the real game"
  - whether Master is aspirational or expected
- `Approx. strength ~600/~1000/~1800/~2400` is acceptable, but still needs a more explicit honesty frame somewhere. Right now it is better than before, but still not fully self-explanatory.
- The opponent badge copy is slightly misleading:
  - `Matches affect practice rating.`
  - In runtime, standalone Fritz rating sync only applies when the user is actually signed in and in the verified standalone Fritz path inside [client/src/bot/BotMatchScreen.tsx](/Users/olivermorid/racehorse-dominoes/client/src/bot/BotMatchScreen.tsx).
  - For anonymous users, that copy overclaims.

### Severity

- `P1`: missing tier-details affordance and explicit ladder guidance
- `P1`: "practice rating" copy overclaim for signed-out users

---

## 3. Game Start Flow

### What works

- The setup interaction is immediate and local.
- Start CTA is clear and prominent.
- Standard as default plus 7-tile default gives the right first session path.
- The setup panel summary is useful and concise.

### Risks

- The start flow lacks one reassuring bridge between setup and first move:
  - no short "race to X" framing on setup
  - no "you start" / "Fritz starts" pre-hand cue before the board resolves
- The summary says `Practice Match` and `Rated`, but the distinction between local practice and account-backed verified practice is not made visible.
- Because the mode is local-first, reload mid-game is likely to reset the run rather than restore it. That is acceptable for now, but it is not explained anywhere.

### Severity

- `P1`: mode start lacks explicit expectation-setting
- `P1`: reload/reset posture is not clearly communicated

---

## 4. In-Game Board / Rack / Readability / Feedback

### What works

- The live board is materially strong:
  - premium dark arena
  - clear meta pills for boneyard/open ends
  - ivory tiles with depth and readable pip contrast
- Hand interaction cues are thoughtfully implemented:
  - playable tiles get a restrained brass underline and border
  - selected tiles lock to the same lifted state
  - unplayable tiles are dimmed but not hidden
  - hover lift is limited to playable tiles
- Score pills and turn label look deliberate rather than generic.

### Risks

- Older-player readability is still marginal in several places:
  - setup labels at `9px` to `12px`
  - slider labels at `9px`
  - badge descriptions around `10.5px`
  - approx-strength line at `10px`
  - some HUD labels remain very condensed and small
- The setup screen intentionally dims non-selected difficulty cards to `opacity: 0.45`. That makes the chosen tier pop, but it also weakens scanability for first-time users comparing all options.
- The opponent mini rack is compact enough to look tidy, but it trends a bit small for older-player glanceability.
- The board and rack are premium, but the game still leans on subtle cues. In-browser, some users may miss:
  - what specifically is playable
  - whether they are forced to draw
  - why turn control stayed with the same player after scoring/doubles

### Severity

- `P1`: small text and comparison readability on setup
- `P1`: game-state cues may be too subtle for less experienced or older players
- `P2`: opponent rack compactness

---

## 5. Draw / Turn / Scoring / Doubles Feedback

### What works

- The implementation clearly tries to give the player multiple layers of feedback:
  - score toast
  - sound cues
  - draw pulse state
  - flying tile support
  - hand-over modal
  - turn label changes
- The code structure in [client/src/bot/BotMatchScreen.tsx](/Users/olivermorid/racehorse-dominoes/client/src/bot/BotMatchScreen.tsx) suggests the rules-feedback intent is solid:
  - draw sounds
  - score sounds
  - hand win/loss sounds
  - turn sounds
  - draw sequence state and pulse index

### Risks

- The score toast is rendered inline with heavy ad hoc style and likely fades quickly. That can be enough functionally, but not always enough emotionally.
- Forced draw and locked boneyard pass outcomes appear to be correct in engine flow, but player-facing explanation still depends on toasts and transient cues rather than an explicit premium UI language.
- Doubles/scoring keep-turn feedback likely exists behaviorally, but the user may still experience it as "why is Fritz still going?" or "why do I still have the turn?" unless the turn-state language is extremely clear in-browser.
- The draw animation path appears implemented, but this is still a browser-QA item rather than a static-code pass item. It should be treated as a targeted verification scenario, not assumed done.

### Severity

- `P1`: user-facing explanation for draw/pass/keep-turn outcomes may still feel too subtle
- `P2`: score toast presentation feels more functional than premium

---

## 6. Hand-End and Game-End Modal Pacing

### What works

- The hand-end modal is one of the strongest pieces in the mode:
  - premium visual continuity
  - readable reward framing
  - tile reveals are treated seriously
  - same visual language as setup/live match
- The game-over modal is strong enough for beta:
  - clear victory/defeat hierarchy
  - good final score structure
  - clean primary/secondary actions

### Risks

- Both the hand-end CTA and game-over primary actions still use gold/blue gradients. That is not a blocker, but it is slightly off the matte-surface brand guidance.
- The loss flow is serviceable, but not yet especially sharp as a training product:
  - no stronger "what to do next" ladder from defeat
  - no targeted practice nudge in standard Play vs Fritz loss state
- Exit/abandon behavior is practical rather than polished:
  - [client/src/components/LeaveGameModal.tsx](/Users/olivermorid/racehorse-dominoes/client/src/components/LeaveGameModal.tsx) is clear, but the copy is generic and more system-like than flagship-game-like.

### Severity

- `P1`: post-loss guidance is too thin for a flagship training mode
- `P2`: result surfaces still carry some non-canonical gradient styling

---

## 7. Win / Loss / Result / Replay Flow

### What works

- The result state is directionally correct:
  - Victory / Defeat is clean and readable
  - Rematch and Change Setup are the right default actions
  - Home as tertiary path is sensible
- Rematch is local and immediate, which suits the training-arena positioning.

### Risks

- The result surface does not yet fully cash in on the emotional moment:
  - win state has clarity, but not enough weight
  - loss state has clarity, but not enough coaching value
- There is no explicit share concept for Play vs Fritz yet. That is not urgent, but it does limit the "premium training arena" habit loop.
- Reload mid-match is likely a hard local reset. That is tolerable now, but needs either:
  - explicit non-persistent positioning, or
  - later local resume

### Severity

- `P1`: win/loss follow-through could do more to reinforce habit and training identity
- `P2`: no clear share/post-result brag surface yet

---

## 8. Older-Player Readability at 125% Zoom

### Strongest risks

- Small uppercase labels in setup are the biggest issue.
- Tier comparison copy gets fragile when zoomed:
  - role label
  - approx line
  - desc line
  - slider labels
- Compact badge text in the Fritz hero card will likely feel too fine.
- Opponent rack and some top-rail labels are likely readable on desktop, but no longer comfortably glanceable at older-player distance.

### Severity

- `P1`: setup readability at 125% zoom
- `P1`: small HUD/supporting labels

---

## 9. Mobile / Tablet Smoke Risks

### Likely good

- The screen architecture is clearly built as a viewport-locked app shell, not a random document stack.
- The live board and hand dock styling system is mature enough to survive adaptation.

### Likely risks

- Four difficulty cards plus slider plus deal-size cards is a dense setup surface on smaller widths.
- The selected/non-selected contrast pattern may become too dim on mobile.
- The hero-card text plus badges may become cramped before it becomes elegant.
- The live HUD has many compact pills and controls in the top rail; this likely needs targeted smoke passes rather than assumption.

### Severity

- `P1`: setup density on smaller tablets and narrower laptops
- `P2`: mobile compression of hero/badges

---

## 10. Manual Browser QA Checklist

- New user with cleared local storage opens Play vs Fritz and sees `Standard` selected by default.
- Returning user who last chose `Elite` reopens Play vs Fritz and keeps `Elite`.
- Confirm whether a tier-details affordance exists. Current code audit suggests it does not.
- Full normal game from setup to result.
- Scoring move clearly communicates points gained.
- Double clearly communicates kept turn.
- Forced draw clearly communicates that draw is mandatory.
- Boneyard locked pass clearly communicates pass reason.
- Hand-end modal appears reliably and holds long enough to read.
- Game-end modal appears reliably with no surprise jump.
- Rematch restarts cleanly.
- `Change Setup` returns cleanly to the setup surface.
- Leave/abandon modal copy is understandable and non-confusing.
- Reload mid-game behavior is verified and documented as reset or resume.
- 125% browser zoom readability check on:
  - tier cards
  - slider labels
  - hero-card badges
  - top HUD labels
  - open ends / boneyard pills
- Mobile/tablet smoke on setup and one live match.

---

## Findings by Priority

### P0

- No confirmed `P0` from this code/product pass.

### P1

- Missing `View tier details` affordance and tier guidance on the actual Play vs Fritz screen.
- `Matches affect practice rating` overclaims for anonymous users and should be made conditional or softened.
- Setup readability is still too small in several important labels for an older-player audience.
- Draw / pass / keep-turn feedback likely needs clearer user-facing explanation in browser, even if rules logic is correct.
- Post-loss result flow needs a better training nudge so the mode feels like a practice arena, not just a binary win/loss screen.
- Reload/reset behavior is not clearly framed for a local-first mode.

### P2

- Primary CTAs and result buttons still rely on gradients more than the matte-source-of-truth wants.
- Opponent mini rack is slightly too compact.
- Non-selected tier dimming is stylish but somewhat over-aggressive for comparison reading.
- Win state could carry more emotional weight.

### P3

- Share/brag path for Play vs Fritz results.
- Local resume strategy if the product later wants stronger session continuity.

---

## Small Patch Recommendations

### 1. Fix tier details / default-tier clarity first

Scope:

- Add a real `View tier details` affordance to Play vs Fritz setup.
- Explain who each tier is for in plain language.
- Keep Standard visibly recommended.
- Soften or conditionalize `Matches affect practice rating.`

Severity:

- `P1`

### 2. Fix modal/result guidance next

Scope:

- Add a better post-loss practice nudge for Play vs Fritz itself.
- Make replay / change-setup / home choices feel more intentional.
- Keep hand-end and game-end pacing untouched unless a real timing issue is confirmed.

Severity:

- `P1`

### 3. Improve rack/selection/readability if needed

Scope:

- Raise tiny support text sizes in setup.
- Loosen over-dimming of non-selected tiers.
- Slightly improve top-rail/support text legibility for 125% zoom.

Severity:

- `P1`

### 4. Improve copy/result/practice nudge

Scope:

- Sharpen first-session setup copy.
- Make loss recovery feel like training guidance, not generic menu navigation.

Severity:

- `P1`

### 5. Only then do visual polish cleanup

Scope:

- Remove residual gradient-heavy CTA styling where it fights the matte visual system.
- Tune result surfaces for stronger flagship weight.

Severity:

- `P2`

---

## Recommended Next Patch

The best next patch is:

1. wire a real `View tier details` affordance in `PlayVsFritz.tsx`
2. keep `Standard` explicitly marked as recommended
3. soften `Matches affect practice rating` to account-backed language
4. slightly increase the smallest setup text sizes for older-player readability

That is the smallest patch that most directly improves flagship clarity without redesigning the mode.
