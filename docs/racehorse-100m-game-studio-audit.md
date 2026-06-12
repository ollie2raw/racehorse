# Racehorse $100M Game Studio Audit

Audit date: 2026-06-03  
Scope: read-only product, gameplay, trust, performance, architecture, and browser-QA audit across Racehorse Dominoes modes. No app code was changed in this pass.

## Executive Verdict

Racehorse Dominoes is not ready for broad public launch. The core rules engine is substantially stronger than a prototype, and the visual source of truth is clear, but public-launch readiness is blocked by tournament browser sign-off, in-memory live-room durability, ranked/result idempotency gaps, and missing end-to-end browser coverage across the modes that drive public trust.

Racehorse can be ready for a controlled beta if tournament P0 browser scenarios pass in real browsers, deployment/restart loss is accepted as a known beta risk, and competitive leaderboards are framed as beta until Daily Fritz, ranked, and Ghost result proof is hardened.

Top 5 risks:

1. Tournament still needs full browser proof for registration, lobby, match attach, draw visibility, game-over overlay, staged bracket reveal, reload, socket loss, and human win/loss paths.
2. Private multiplayer, quick match, matchmaking queue, socket rate limits, and tournament room state are process-local; deploy/restart can lose live games or queues.
3. Daily Fritz and Ghost results are authenticated and bounded but still rely on client-submitted outcomes rather than full server replay for public competition trust.
4. Ranked result idempotency is not DB-enforced yet; duplicate `ranked_games` rows remain a public-rating risk until source columns and uniqueness are migrated safely.
5. The app has no comprehensive browser E2E suite for final-move, modal, reload, reconnect, and multi-user flows; most safety is from unit/code-path tests and manual checklists.

## Mode-by-Mode Scorecard

| Mode | Gameplay Correctness | UX Flow | Visual Polish | Trust/Security | Production Risk | Overall Readiness |
|---|---|---|---|---|---|---|
| Play vs Fritz | Beta-ready | Needs P1 polish | Beta-ready | Beta-ready | Needs P1 polish | Needs P1 polish |
| Daily Fritz | Beta-ready | Needs P1 polish | Beta-ready | Needs P1 polish | Needs P1 polish | Needs P1 polish |
| Daily Puzzle Ladder | Beta-ready | Beta-ready | Beta-ready | Beta-ready | Needs P1 polish | Beta-ready |
| Learn | Beta-ready | Needs P1 polish | Needs P1 polish | Launch-ready | Needs P1 polish | Needs P1 polish |
| Ghost | Beta-ready | Needs P1 polish | Needs P1 polish | Needs P1 polish | Needs P1 polish | Needs P1 polish |
| Private Multiplayer | Beta-ready | Needs P1 polish | Beta-ready | Beta-ready | P0 risk | Controlled beta only |
| Quick Match / Matchmaking | Beta-ready | Needs P1 polish | Beta-ready | Beta-ready | P0 risk | Controlled beta only |
| Tournaments | P0 risk | P0 risk | Needs P1 polish | Beta-ready | P0 risk | P0 risk |
| Friends / Social / Activity | Launch-ready | Needs P1 polish | Needs P1 polish | Needs P1 polish | Needs P1 polish | Needs P1 polish |
| Leaderboards / Stats / Profile | Needs P1 polish | Needs P1 polish | Needs P1 polish | P0 risk | Needs P1 polish | Needs P1 polish |
| Share / Results | Beta-ready | Needs P1 polish | Needs P1 polish | Needs P1 polish | Needs P1 polish | Needs P1 polish |

## Top P0 Launch Blockers

1. Tournament browser sign-off is still pending for the exact known failure classes: skipped game-over modal, future bot results revealed too early, bot-heavy bracket auto-simulation, draw animation visibility, reload during match/postgame, and human win/loss bracket return. Automated code-path tests exist, but public launch needs real-browser proof.
2. Live rooms are not durable. `server/src/multiplayer/roomSession.ts`, `server/src/rooms.ts`, and quick-match/tournament room dispatch all use process memory for active game state. `/api/mp-stats` explicitly labels these stats process-local. Deploy/restart can lose live games.
3. `ranked_games` idempotency is not DB-enforced. Existing docs confirm no source id columns are exposed in production yet; payload prep is flag-gated in `server/src/ranking/rankedGamePayload.ts`, but the migration and unique index are not live.
4. Daily Fritz public leaderboard trust is not fully server-authoritative. `/api/daily-fritz/record-game` and `/complete` validate ownership, ordering, hashes, skunk/set math, and bounds, but they do not replay the full game from a server move transcript.
5. Multi-instance tournament progression is not safe yet. Scheduled tournament ready-match reconciliation is explicitly single-instance first-release logic, and match completion/advancement still needs a conditional DB update or lease before horizontal deployment.

## Top P1 Public Beta Quality Fixes

1. Run and record a browser QA pass for tournament mostly-bot flow, reload cases, match overlay persistence, and staged bracket reveal. Do this before any tournament UI polish.
2. Add a small browser E2E smoke suite for final-move and modal lifecycle across Play vs Fritz, Daily Fritz, Daily Puzzle, Private Multiplayer, Quick Match, and Tournament.
3. Align Quick Match UI copy with server pairing windows. `client/src/matchmaking/MatchmakingScreen.tsx` says windows expand differently from `server/src/matchmaking/pairing.ts`.
4. Remove or hide UI-only/private-lobby controls that are not fully wired, such as private lobby timed/rated/spectator previews, unless they are clearly labeled as coming soon.
5. Remove public-facing Ghost diagnostics from the setup surface or move them behind a dev/admin path. The current Ghost setup reads partly like a diagnostics tool.
6. Improve tournament waiting room and bracket atmosphere so it feels like a live event, not an admin status board.
7. Harden duplicate submit/replay UX for Daily Puzzle slot submits and finalize failures so DB-guarded conflicts return friendly recovery instead of feeling broken.
8. Improve result/share consistency. Daily Fritz and Daily Puzzle share text exists; Ghost has an image card but visual style drifts; Tournament has result display but no growth-grade share flow.
9. Clean up legacy tournament imports and code paths. `client/src/screens/TournamentScreen.tsx` is still imported and kept alive by `void TournamentScreen` in `App.tsx`, but scheduled tournaments use the newer Hub/Bracket/Result flow.
10. Add older-player readability QA for all overlays, rack spacing, score track, social tabs, stats cards, and mobile/tablet breakpoints.

## Top P2 Polish Opportunities

1. Reduce duplicated PNG/WebP art and unused legacy assets. Asset folders are large: Daily Puzzle 23 MB, Daily Fritz 12 MB, Single Player Hub 13 MB, Home 11 MB, Ghost 7.4 MB.
2. Lazy-load scheduled tournament screens and any unused legacy tournament code instead of importing them into the initial App graph.
3. Normalize share cards to the matte navy/brass/blue identity. Ghost share currently uses generic gradients and Arial-style SVG text.
4. Make social empty states more retention-oriented: suggested rivals, recent activity examples, and clear challenge affordances.
5. Add clear "why nothing happened" feedback for disabled challenge/invite, offline opponents, socket disconnects, and clipboard failures.
6. Improve Learn locked states so Level 2/3/4 feel like a deliberate academy roadmap rather than unfinished placeholders.
7. Standardize public profile/stats hierarchy around serious competitive identity: rating, streaks, tournament placement, puzzle perfects, and recent meaningful games.
8. Replace raw emojis in share text or provide platform-specific variants if the product wants a more premium external voice.

## Cross-Mode Systemic Risks

- Skipped-modal pattern: game-over, hand-over, set-over, and tournament-final overlays are spread across several client effects. `client/src/bot/BotMatchScreen.tsx` is especially large and carries Play vs Fritz, Daily Fritz, Ghost, Learn/guided, and analyzer concerns.
- Client/server drift: server multiplayer uses `server/src/game/engine.ts`; local/bot modes use `client/src/bot/botEngine.ts` plus UI effects. The concepts match, but forced-draw chains and end-of-hand timing are more UI-dependent in local modes.
- In-memory room durability: live multiplayer, matchmaking queue, tournament room attach, disconnect grace, and rate-limit buckets are process-local.
- Missing browser E2E: tournament has strong unit/behavior tests, but the core public failure modes are browser timing and socket lifecycle issues.
- Visual inconsistency: Play vs Fritz is canonical; Ghost diagnostics, social/stats tables, share cards, and some legacy surfaces drift toward admin/SaaS/prototype.
- Older-player readability: several dense stats/social/leaderboard rows and small HUD labels need browser inspection on tablet/mobile and zoomed desktop.
- Result persistence/idempotency: public `matches` are app-deduped but not DB-unique by room match id; `ranked_games` source uniqueness is deferred; activity feed lacks idempotency keys.
- Broad App coupling: `client/src/App.tsx` still orchestrates many modes, socket paths, tournament routing, and recovery. This is manageable for beta but high-risk for frequent public patches.

## Mode Deep Dives

### A. Play vs Fritz

What works:

- Uses the canonical Play vs Fritz matte/neon panel system and is the clearest visual identity reference.
- Tier structure is explicit: Rookie, Standard, Elite, Master. Standard copy is positioned as the default "best for most players"; Elite is not visibly forced by the tier list itself.
- Shared bot match flow supports draw/move animations, scoring, hand lifecycle, and result overlay infrastructure.
- Local rules mostly mirror the server rules: legal moves, boneyard lock, scoring turn retention, and doubles turn retention.

What feels risky:

- Default tier depends on `resolveDefaultPvfFritzTier()` and stored preference; QA should verify Standard for new users with empty storage.
- Local gameplay correctness depends on UI/effect orchestration around `BotMatchScreen`, not the server engine.
- Game-over, practice nudge, and reset/abandon flows are likely correct but need browser proof because the component is large and mode-shared.
- Mobile and older-player readability should be checked on rack spacing, score track labels, legal move highlights, and modal buttons.

Specific files/components/routes to inspect:

- `client/src/bot/PlayVsFritz.tsx`
- `client/src/bot/PlayVsFritz.css`
- `client/src/bot/BotMatchScreen.tsx`
- `client/src/bot/botEngine.ts`
- `client/src/bot/pvfTierPreference.ts`
- `client/src/components/handOver/HandOverModal.tsx`

Manual QA scenarios:

- Fresh browser storage, open Play vs Fritz, confirm Standard is the default recommendation and Elite is not auto-selected.
- Open tier details and confirm tier copy, behavior, and close behavior.
- Play a full game with scoring moves, doubles, forced draws, boneyard lock, hand end, and game end.
- Reload mid-hand and confirm expected local recovery or clear restart messaging.
- Trigger abandon/reset/back navigation and confirm no stale overlay or accidental score persistence.
- Test on mobile/tablet and at 125 percent browser zoom.

Recommended patch sequence:

1. Browser QA only: default tier, tier details, full game, reload, abandon/reset.
2. If failures appear, patch only the failing PVF flow, not shared bot AI or scoring.
3. Add a browser smoke for "new user -> Standard -> full game -> result overlay".
4. Do an older-player readability pass on rack, score track, and modal buttons.

### B. Daily Fritz

What works:

- Daily set flow is structured around Game 1/2/3 progression and server attempt state.
- Skunk source-of-truth is implemented server-side: Game 1/2 skunk can count as two wins and end the set; Game 3 skunk is metadata only.
- Attempt ownership and auth are enforced.
- Daily Fritz hand-end reveal has a minimum visible guard.
- Share text and final result overlay exist.
- Completion hash/idempotent replay provides a first layer of trust and duplicate handling.

What feels risky:

- Public result trust is not server-authoritative enough for broad competitive launch. The server validates attempt ownership, order, score bounds, skunk math, and completion hash, but does not replay every move from canonical rules.
- Client-side final overlay and hand reveal timing still need browser proof for no skipped reveal, no premature game/set advancement, and retry/finalize errors.
- Practice hint after loss/skunk is useful only if it appears at the right time and does not feel punitive.
- Daily attempt uniqueness is DB-backed, but rare concurrent start/submit conflicts should return graceful replay responses.

Specific files/components/routes to inspect:

- `client/src/dailyFritz/DailyFritzScreen.tsx`
- `client/src/dailyFritz/DailyFritzFinalResultOverlay.tsx`
- `client/src/dailyFritz/shareCard.ts`
- `server/src/index.ts` Daily Fritz routes
- `server/src/dailyFritzSkunk.ts`
- `supabase/daily_fritz.sql`

Manual QA scenarios:

- Start today's set and play normal Game 1/2/3 progression.
- Win a non-skunk set and verify result, leaderboard save, share copy, and return-to-hub.
- Win Game 1 by skunk before Fritz reaches 30 and verify set ends 2-0.
- Lose by skunk and verify loss/practice nudge copy.
- Play Game 3 skunk and verify skunk metadata without changing already-decided set semantics.
- Reload during hand, between games, during finalizing, and on final overlay.
- Simulate submit/finalize failure and verify retry UX is clear.

Recommended patch sequence:

1. Browser QA set progression and skunk matrix.
2. Patch only skipped reveal/finalize/retry issues.
3. Add server replay or proof transcript planning for public leaderboard trust.
4. Polish share/result copy after trust and flow are stable.

### C. Daily Puzzle Ladder

What works:

- Server-side validation/replay exists in `server/src/dailyPuzzleSubmissionValidation.ts` and uses the canonical server engine.
- Slot 1 -> 2 -> 3 progression, setVersion binding, duplicate slot submit replay, and finalization readiness are explicitly handled.
- Solved/perfect/score derivation is server-side for new submissions.
- Attempt uniqueness and slot-result uniqueness are backed by DB constraints.
- Final overlay and share text exist.

What feels risky:

- Timer trust is still client-reported and clamped, not server-timed enough for serious public rankings.
- Concurrent duplicate slot submit is DB-protected but can still feel like an error instead of a friendly idempotent replay.
- Historical puzzle rows may have been client-trusted before the server validation pass.
- Finalize failure recovery should be browser-tested, especially Slot 3 completion and reload/resume.

Specific files/components/routes to inspect:

- `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx`
- `client/src/dailyPuzzle/ladderShareCard.ts`
- `client/src/dailyPuzzle/validator.ts`
- `server/src/dailyPuzzleSubmissionValidation.ts`
- `server/src/index.ts` Daily Puzzle routes
- `supabase/daily_puzzle_ladder_v1.sql`

Manual QA scenarios:

- Load today's puzzle signed out and signed in.
- Start attempt, complete Slot 1, confirm Slot 2 unlocks.
- Complete Slot 2, confirm Slot 3 unlocks.
- Complete Slot 3, confirm finalize and result overlay.
- Reload after Slot 1, after Slot 2, during Slot 3, and after finalize-ready before completion.
- Submit duplicate Slot 1/2/3 and verify server returns existing result without double scoring.
- Force submit/finalize API failure and verify recovery path.

Recommended patch sequence:

1. Browser QA full Slot 1/2/3 with reload and duplicate submit.
2. Improve friendly replay responses for DB unique conflicts.
3. Move timer trust toward server session timing for public ranking.
4. Polish empty/loading/error states after the above.

### D. Learn

What works:

- Level 1 content teaches core Racehorse rules accurately: no voluntary pass, boneyard lock, scoring turn retention, doubles turn retention, and open-count scoring.
- Learn Home uses a polished card structure and generally stays near Racehorse identity.
- Guided lesson infrastructure supports overlays, highlights, lesson progress, and authored lesson data.
- Locked Level 2/3/4 states clearly prevent users from entering unfinished modules.

What feels risky:

- Learn imports authoring/admin/guided tooling through shared Learn exports, which can add weight and expose development-feeling surfaces if not gated carefully.
- Level 2/3/4 locked states may feel unfinished rather than intentional unless copy and visuals frame them as an academy roadmap.
- Highlight timing and overlay readability need browser proof for older players.
- Learn should more explicitly bridge into Daily Fritz and competitive modes after completion.

Specific files/components/routes to inspect:

- `client/src/learn/LearnHome.tsx`
- `client/src/learn/LearnPlayer.tsx`
- `client/src/learn/data/modules.ts`
- `client/src/learn/data/lessons/level1.ts`
- `client/src/learn/rulesAdapter.ts`
- `client/src/learn/learn.css`

Manual QA scenarios:

- Complete "How to Play" from entry to exit.
- Complete the guided match/lesson and verify next-step copy.
- Confirm open-count examples match board state.
- Verify locked Level 2/3/4 cards are legible and feel deliberate.
- Test overlays at mobile/tablet and 125 percent zoom.

Recommended patch sequence:

1. Browser QA highlight/overlay timing and lesson completion.
2. Hide or code-split authoring/admin-only tooling from regular Learn entry.
3. Rewrite locked-state copy to feel intentional.
4. Add Learn-to-Daily-Fritz transition nudges.

### E. Ghost

What works:

- Ghost start/complete routes require auth and verified match ownership.
- Completion checks local match id, opponent/mode, bounded scores, completion hash, and move-log sanity.
- `ghost_games.match_id` uniqueness exists in SQL when the migration is applied.
- Ghost has a differentiated product concept and share-card generation.

What feels risky:

- Ghost completion is sanity-checked, not fully server-replayed.
- `completeGhostGame` has a plain-insert fallback if `ghost_games.match_id` is missing in production; that fallback is risky after migration rollout should be verified.
- Ghost setup includes diagnostics/training-health details that read like an internal tool.
- Visual language drifts from Play vs Fritz with gradients, generic share-card styling, and experiment-like copy.
- Reload/resume/abandon behavior needs browser proof.

Specific files/components/routes to inspect:

- `client/src/ghost/GhostSetupScreen.tsx`
- `client/src/ghost/api.ts`
- `client/src/ghost/share.ts`
- `server/src/index.ts` Ghost routes
- `server/src/ghost/service.ts`
- `supabase/ghost.sql`

Manual QA scenarios:

- Start Ghost against featured Ghost and complete a full game.
- Verify hidden/removed side-tile explanation is clear.
- Reload mid-hand and after game over.
- Complete result save and share card.
- Attempt duplicate complete and verify idempotent recovery.
- Confirm public setup does not show admin diagnostics.

Recommended patch sequence:

1. Browser QA full Ghost game and reload/abandon.
2. Remove public diagnostics from Ghost setup.
3. Verify production migration includes `ghost_games.match_id` and remove/alert on fallback later.
4. Align Ghost share/result visuals to Racehorse identity.

### F. Private Multiplayer

What works:

- Server uses the canonical Racehorse engine for legal moves, forced draw, pass, scoring, doubles, hand/game end, and tile-count invariants.
- Per-room action serialization exists through gameplay locks.
- Opponent hand masking and spectator masking are centralized.
- Duplicate/stale hand-ready and state-sequence handling exists.
- Disconnect grace can auto draw/pass if no legal play exists, avoiding some frozen games.
- Invite, create, join, ready, start, abandon, rematch, and reconnect paths are implemented.

What feels risky:

- Room state is in memory. Deploy/restart loses live games, and hydration can recreate shells without full game state.
- Host/non-host policy and host leave behavior need browser clarity.
- Lobby contains UI-only previews/toggles that may imply unsupported features.
- Chat/emote/socket abuse limits exist, but social abuse UX and reporting are not mature.
- Public match logs are app-deduped, not DB-unique by room match id.
- Browser smoke exists for sockets, but masking, disconnect grace, and full game-over/reveal are not fully covered.

Specific files/components/routes to inspect:

- `client/src/multiplayer/PrivateMatchLobbyScreen.tsx`
- `client/src/multiplayer/useMultiplayerConnection.ts`
- `client/src/multiplayer/useRoomSocketSync.ts`
- `client/src/match/LiveMatchScreen.tsx`
- `server/src/multiplayer/registerRoomSessionHandlers.ts`
- `server/src/multiplayer/roomSession.ts`
- `server/src/multiplayer/disconnectGrace.ts`
- `server/src/rooms.ts`
- `server/src/stats/recordPublicMatch.ts`

Manual QA scenarios:

- Browser A creates room; Browser B joins by code and invite link.
- Host/non-host ready states and start game.
- Play forced draw, pass with locked boneyard, scoring keep-turn, double keep-turn.
- Confirm each browser never sees opponent hand before reveal.
- Spectator sees board/counts but no hands.
- Host leaves before start, during hand, and after game over.
- Disconnect active player and observe grace behavior.
- Reload both browsers during lobby, match, hand-over, and game-over.
- Confirm abandon persists correct outcome and no duplicate public result rows.

Recommended patch sequence:

1. Browser QA create/join/start/play/end/masking/reload.
2. Remove or relabel unwired lobby controls.
3. Add browser smoke for masking and disconnect grace.
4. Plan durable room snapshots before broad launch.

### G. Quick Match / Matchmaking

What works:

- Queue identity rejects authenticated user mismatches and prevents UUID-like guest spoofing without auth.
- In-memory queue prevents duplicate queue entries by user id.
- Match found emits a reserved room and uses the same live match engine as private multiplayer.
- Join/cancel/timeout flows exist.
- Socket rate limits include `queue:join`.

What feels risky:

- Queue is in memory and single-process. Deploy/restart loses queue and active room state.
- UI pairing copy does not match server pairing windows and timeout. The UI says one expansion model; server uses 0-15s +/-150, 15-30s +/-300, 30-60s +/-500, 60s+ any, with a 90s timeout.
- Empty queue, timeout, opponent disconnect, and abandon need more premium explanation.
- Ranking/result trust inherits `ranked_games` idempotency risks.

Specific files/components/routes to inspect:

- `client/src/matchmaking/MatchmakingScreen.tsx`
- `client/src/matchmaking/useMatchmaking.ts`
- `client/src/matchmaking/MatchFoundOverlay.tsx`
- `server/src/matchmaking/index.ts`
- `server/src/matchmaking/queueService.ts`
- `server/src/matchmaking/pairing.ts`
- `server/src/matchmaking/persistence.ts`

Manual QA scenarios:

- Join queue as signed-in user, cancel, rejoin.
- Try mismatched authenticated payload and verify rejection.
- Match two browsers and attach to live match.
- Let queue timeout and verify retry UX.
- Opponent disconnects before attach and mid-game.
- Abandon and verify result/rating behavior.
- Test empty queue on slow network.

Recommended patch sequence:

1. Align UI copy to server pairing windows.
2. Browser QA two-browser queue to full game end.
3. Add attach/retry/disconnect premium messaging.
4. Move queue and active match reservations to durable storage before public scale.

### H. Tournaments

Tournament is the highest priority mode and the biggest upside mode. It has received substantial P0 hardening, but it remains the highest public-beta risk because its failure modes are visible, time-bound, and trust-sensitive.

What works:

- Upcoming list, auth registration, withdraw, bracket fetch, `/me` recovery, and match attach are implemented in newer scheduled tournament screens.
- Tournament rooms use the multiplayer server engine and tournament `win_target`, usually 30.
- P0 hardening already defers live game-over finalization so the overlay can render.
- Bot-only matches no longer auto-resolve at bracket generation; simulation is gated by scheduled start and prior-round completion.
- Bracket display now stages bot result reveal based on human progress.
- Fritz bot IDs are stable and client display resolves to Fritz 1, Fritz 2, Elite Fritz 1, etc.
- Hand rack spacing was patched to match live multiplayer.
- Server has many tournament unit tests covering bracket, dispatch, recovery, attach, completion, and human/bot flow.
- Waiting room has improved event framing, field count, bracket preview, and countdown.

What feels risky:

- Full browser sign-off remains pending. Existing docs explicitly mark human browser confirmation as required.
- The game-over overlay must stay until user action at score 30; any regression here is a P0 public trust failure.
- Draw animation visibility in tournament depends on shared live-match timing and needs real-browser verification.
- Reload during lobby, bracket lobby, assigned match, live match, game-over overlay, and bracket return needs proof.
- Socket disconnect and slow network behavior during match-ready deadline can feel punitive or confusing.
- Bot-heavy tournaments can still feel automated unless the waiting room and bracket explain what is happening.
- Multi-instance tournament match completion and ready reconciliation remain unsafe without DB lease/conditional update.
- Legacy `client/src/screens/TournamentScreen.tsx` is still imported even though scheduled tournaments use the newer flow.

Specific files/components/routes to inspect:

- `client/src/tournament/TournamentHubScreen.tsx`
- `client/src/tournament/TournamentBracketScreen.tsx`
- `client/src/tournament/TournamentResultScreen.tsx`
- `client/src/tournament/useTournament.ts`
- `client/src/tournament/tournamentBracketDisplay.ts`
- `client/src/tournament/tournamentPostgamePolicy.ts`
- `client/src/match/session/useTournamentMatchSession.ts`
- `client/src/tournament/TournamentMatchHud.tsx`
- `client/src/match/LiveMatchScreen.tsx`
- `server/src/scheduledTournament/engine.ts`
- `server/src/scheduledTournament/matchDispatch.ts`
- `server/src/scheduledTournament/routes.ts`
- `server/src/scheduledTournament/recovery.ts`
- `server/src/multiplayer/registerRoomSessionHandlers.ts`

Manual QA scenarios:

- Mostly-bot tournament from registration to champion.
- Register, wait in room, confirm field filling and bot-fill copy.
- Bracket lock countdown, no future rounds completed visually.
- Human QF attach, match HUD target 30, draw animation visible, rack spacing correct.
- Human wins QF; return to bracket; only QF results revealed; next match attach works.
- Human loses QF; bracket reveals full resolved path after elimination.
- Semifinal and final progression, including bot-only opponent timing.
- Reload during lobby, bracket lobby, assigned match, live match, game-over modal, and bracket return.
- Socket disconnect during match-ready and live match.
- Slow network during attach and final move.
- Confirm no stale old tournament recovery appears after terminal match.

Recommended patch sequence:

1. Tournament P0 browser failures only: run the matrix, patch only failing overlay/draw/reload/reveal/attach issues.
2. Tournament P1 waiting room/bracket UX: live-event framing, stronger status copy, bot-fill explanation, richer result states.
3. Add a Playwright or browser-driven smoke for the mostly-bot tournament path and reload checkpoints.
4. Add durable tournament room snapshot/lease strategy before multi-instance deployment.

## Tournament Deep Dive

### Current Tournament Runtime Model

Scheduled tournaments are DB-backed for tournament, registration, match, and bracket records, but live match state is still an in-memory room. `server/src/scheduledTournament/engine.ts` generates bracket rows, dispatches ready matches, applies results, advances winners, and completes the tournament. `server/src/scheduledTournament/matchDispatch.ts` creates reserved multiplayer rooms with tournament metadata and emits `tournament:match_ready` to assigned human sockets. `server/src/multiplayer/registerRoomSessionHandlers.ts` handles `tournament:attach_assigned_match` and joins the player into the reserved room.

This is a reasonable controlled-beta architecture, but not broad-launch architecture. DB rows can tell the app a match exists, but they cannot restore the exact live hand, boneyard, animation state, and turn after a process restart.

### Registration, Waiting Room, And Countdown

What works:

- Upcoming tournament cards show time, registration count, full/open status, and register/withdraw actions.
- Waiting room shows a countdown, field fill, registered seats, and projected/bracket preview.
- Bot fill is disclosed in copy.
- `/api/tournaments/me` provides phase and recovery context for registered users.

Risks:

- Waiting room still needs to feel more like a live competitive event. Current structure is functional but can read as status/admin if not visually tuned.
- Registration close and scheduled start are time-bound; slow refresh or socket loss needs clear "refreshing bracket" and "match starting" messages.
- Bot fill should feel intentional, not like missing humans.

Patches:

- Add event language: "Field locking", "Fritz seats filling", "Your quarterfinal is being prepared".
- Keep bot-fill explanation visible near open seats.
- Add browser proof of countdown boundary refresh.

### Bracket Generation And Reveal Gating

What works:

- Bracket generation is idempotent if matches already exist.
- Bot-only simulation is staged by scheduled start and previous-round completion.
- Client display hides bot/future completed styling until human progression permits reveal.
- Human's own completed match remains visible.

Risks:

- Display gating is not the same as server truth. If API data is stale or over-advanced, the UI hides some symptoms but browser QA must ensure no confusing flash.
- Spectator/no-user behavior reveals all completions by design. That is fine for public viewing, but signed-in participants should get the staged reveal.
- Champion column depends on display-completed state; this is good, but must be tested in bracket lobby and post-elimination.

Patches:

- Browser QA should record screenshots before human QF, after human QF win, after human QF loss, after SF, and after final.
- Add E2E assertions for "no champion name before participant is allowed to see it".

### Human Match Attach And HUD

What works:

- Match dispatch uses tournament `win_target`, passed into room config and LiveMatch HUD.
- Attach flow rejects non-participants and repairs missing ready rooms where possible.
- Tournament match HUD uses tournament context and opponent labeling.

Risks:

- Attach is socket-timing sensitive. Pending, failed, retry, and recovery banners must be obvious.
- Ready deadline behavior can feel harsh if a user reloads or has a slow network.
- Bot opponent naming is client-derived from bot ID; stable enough, but any malformed bot ID falls back to generic tier labels.

Patches:

- Browser QA attach after fresh event, after reload, and after socket reconnect.
- Add clear failed-attach copy with retry and bracket return.

### Live Tournament Match

What works:

- Uses the same `LiveMatchScreen` as private multiplayer.
- Server rules are canonical: forced play if legal, forced draw while drawable, boneyard lock, scoring/double keep turn, hand/game end.
- Hand rack spacing was patched through the shared live hand row structure.
- Draw animation payload exists through `game:draw_animation`.

Risks:

- Draw animation visibility is still browser-evidence dependent.
- Final move at 30 is the highest-risk timing moment. The app must not freeze, skip overlay, or jump to bracket before the user sees the result.
- The overlay stays until user action only if tournament postgame policy and socket events remain ordered correctly.

Patches:

- Record browser video of final score crossing 30, including 2-3 seconds after overlay.
- Test win and loss.
- Test draw during tournament against a bot and against a human if available.

### Postgame And Bracket Return

What works:

- `shouldDeferTournamentMatchFinalize` defers bracket navigation while the user is in the live tournament match.
- `shouldShowTournamentGameOverOverlay` prevents consumed terminal match ids from reopening stale overlays.
- `navigateAfterTournamentMatch` and terminal match markers are intended to prevent stale auto-rejoin.

Risks:

- Reload after game-over modal is the fragile case: the browser must not recover into an already terminal room, skip result, or bounce between bracket and multiplayer.
- If `tournament:match_completed` arrives before or during local game-over state, ordering must remain stable.

Patches:

- Browser QA reload on modal, then press View Bracket.
- Add E2E around terminal match id persistence.

### Bot-Only Simulation

What works:

- Bot-only matches no longer complete at bracket generation.
- Bot QFs resolve at/after scheduled start; later rounds require prior round completion.
- Human path controls display reveal.

Risks:

- A mostly-bot tournament can still feel like the system is playing around the user unless the UI stages explanation and reveals elegantly.
- No browser-visible "Fritz match resolving" animation/state exists yet.

Patches:

- P1 only after P0 browser pass: show bracket pulses or "Fritz 3 advanced after QF" style status.

### Tournament Production Risks

- Single-instance scheduler/reconciliation is explicitly first-release.
- No DB lease prevents two workers from completing/advancing the same match in parallel.
- Live room state loss on deploy/restart remains the main launch blocker.
- External monitoring/error tracking should capture tournament attach failures, missing ready rooms, terminal join suppressions, and match-completed ordering.

## I. Friends / Social / Activity

What works:

- Friend request, accept, decline, remove, presence, challenge invite, profile preview, recent activity, and H2H are implemented.
- Server social routes require auth for most social reads/writes.
- Duplicate friend requests are checked before insert.
- Presence has online/in-game/offline states.

What feels risky:

- Client friends API still talks directly to Supabase for some operations while server social routes also exist; policy consistency should be verified.
- Friend invites are socket events; accept/decline/reachability flows need abuse limits and UX polish.
- Empty states are functional but not yet strong retention loops.
- Activity feed has no idempotency key, so duplicate completion/activity writes can spam the feed.
- Public profile reads are auth-gated; privacy expectations should be explicit.

Specific files/components/routes to inspect:

- `client/src/friends/FriendsScreen.tsx`
- `client/src/friends/friendsApi.ts`
- `client/src/social/ActivityFeedScreen.tsx`
- `client/src/social/ActivityFeedPanel.tsx`
- `client/src/social/socialApi.ts`
- `server/src/social/routes.ts`
- `server/src/social/presence.ts`
- `server/src/social/activityWriter.ts`

Manual QA scenarios:

- Empty friend list, add by username, duplicate request, self-request.
- Incoming request accept/decline.
- Online/offline/in-game presence refresh.
- Challenge online friend, decline challenge, accept challenge.
- Duplicate invite spam and rate-limit behavior.
- Activity feed after win, loss, streak, puzzle, tournament.

Recommended patch sequence:

1. Browser QA full friend request/challenge loop.
2. Add/review rate limits and duplicate invite UX.
3. Add activity idempotency key plan.
4. Polish empty states and privacy copy.

## J. Leaderboards / Stats / Profile

What works:

- Global, friends, weekly, and mode leaderboards exist.
- Profile/stats surfaces aggregate ranked, Fritz, Ghost, and Puzzle records.
- Display paths dedupe some public match rows for stats/social display.
- Daily Puzzle leaderboard trust is substantially improved by server validation.

What feels risky:

- `ranked_games` has no live source/idempotency columns yet, so public rating trust is not launch-ready.
- Public `matches` rows are pre-check deduped, not DB unique by `metadata.roomMatchId`.
- Daily Fritz leaderboard depends on client-submitted set results.
- Stats cards include many dense metrics and small labels; older-player readability needs inspection.
- Some color choices drift from mode identities, especially Ghost purple accents.

Specific files/components/routes to inspect:

- `client/src/social/LeaderboardScreen.tsx`
- `client/src/social/PublicProfileScreen.tsx`
- `client/src/stats/StatsScreen.tsx`
- `client/src/stats/statsApi.ts`
- `server/src/social/routes.ts`
- `server/src/stats/dedupeMatchRows.ts`
- `server/src/stats/recordPublicMatch.ts`
- `server/src/ranking/rankedGamePayload.ts`

Manual QA scenarios:

- Empty leaderboard, self outside top 100, provisional account, top ranked account.
- Daily Fritz leaderboard after win/loss/skunk.
- Daily Puzzle leaderboard after Slot 3 completion.
- Ghost/Fritz stats after completed games.
- Duplicate result replay does not double-display.
- Mobile/tablet stats readability.

Recommended patch sequence:

1. Keep leaderboards beta-labeled until ranked idempotency and Daily Fritz proof improve.
2. Run duplicate-row inventory and add ranked source columns only after migration plan.
3. Add public profile/stat visual hierarchy pass.
4. Add stale cache/error/loading state QA.

## K. Share / Results Flows

What works:

- Daily Fritz share text exists and includes set result, game lines, margin, rating, streak, and URL.
- Daily Puzzle share text exists and includes score, rank, slots, streak/rating, and URL.
- Ghost can generate a PNG share card.
- Tournament has a result screen showing champion, placement, and next tournament.

What feels risky:

- Tournament does not yet have a polished share flow.
- Ghost share card visual language uses gradients and generic typography that drift from Racehorse identity.
- Share text can overstate rank if rank is stale; rank should be omitted or clearly current at time of completion.
- Clipboard failures and native share dismissals need clearer fallback.
- External share output is not yet at growth-grade polish.

Specific files/components/routes to inspect:

- `client/src/dailyFritz/shareCard.ts`
- `client/src/dailyFritz/DailyFritzFinalResultOverlay.tsx`
- `client/src/dailyPuzzle/ladderShareCard.ts`
- `client/src/ghost/share.ts`
- `client/src/tournament/TournamentResultScreen.tsx`

Manual QA scenarios:

- Share Daily Fritz normal win, loss, skunk win, skunk loss.
- Share Daily Puzzle final result with rank and without rank.
- Share Ghost result on browser with native file share and fallback download.
- Tournament result return flow and missing share CTA.
- Clipboard disabled/unavailable fallback.

Recommended patch sequence:

1. Fix share failure/fallback messaging.
2. Add tournament share text/card.
3. Normalize all share cards to Racehorse identity.
4. Avoid overclaiming rank or score when leaderboard save is pending.

## Visual/Product Polish Audit

Cross-screen findings:

- Play vs Fritz and Daily Fritz are closest to the desired premium product identity.
- Tournament waiting room and bracket are materially improved, but still need live-event polish.
- Ghost setup exposes diagnostics and uses more experimental visual language.
- Friends/social/stats are useful but can read like app panels rather than a serious competitive identity layer.
- Some legacy CSS/classes and old art still reference deprecated visual directions; treat names as implementation artifacts only.
- Gradients appear in some share cards, art treatments, and legacy surfaces. The locked system prefers matte solids, crisp borders, restrained glows, and no generic gradient sheen.
- Some dense rows and HUD labels may be too small for older players, especially leaderboards, stats, social activity, and match HUD secondary copy.
- Buttons in disabled/offline states need stronger explanation, not just opacity.
- Result screens need consistent modal/button hierarchy so hand-end, game-end, set-end, and tournament-end all feel like one product family.

## Performance Audit

Findings:

- Client route splitting exists for many modes through `React.lazy`, including Play vs Fritz, BotMatchScreen, Daily Fritz, Daily Puzzle, Ghost, Learn, Stats, Friends, Profile, and Feed.
- Scheduled tournament screens are currently imported eagerly in `client/src/App.tsx`, and the legacy `TournamentScreen` is also imported and kept alive.
- Live match, socket orchestration, room recovery, analyzer utilities, and tournament session logic still pull significant code through `App.tsx`.
- Vite manual chunks separate Supabase, Socket.IO, Recharts, and confetti vendors, which is useful.
- Asset folders are large and contain duplicated or legacy images. This likely affects install/build size and can affect route-level load if imported broadly.
- Client build warnings or bundle sizes should be reviewed after a production build.
- Animation jank risk is highest on final move, draw animation, hand-over, and tournament overlay transitions because these combine socket events, state updates, sounds, and visual animation.

Recommended performance patches:

1. Lazy-load scheduled tournament Hub/Bracket/Result and remove legacy `TournamentScreen` import from the initial graph after confirming no old route depends on it.
2. Audit imported images and delete/stop importing unused legacy PNGs.
3. Add route-level bundle analysis for home, Play vs Fritz, Daily Fritz, Daily Puzzle, Tournament, and Multiplayer.
4. Test final-move and draw animation on older mobile/tablet hardware.

## Security/Trust/Abuse Audit

What is strong:

- REST and socket rate limits exist in `server/src/rateLimit.ts` and `server/src/index.ts`.
- Socket limits cover room create/join/spectate, queue join, friend invite/decline, chat/emote, game action, hand ready, and player ready.
- Server multiplayer is authoritative for live game actions.
- Private multiplayer masking is centralized.
- Daily Puzzle new submissions are server-replayed.
- Ghost and Daily Fritz require auth and attempt/verified-match ownership.
- Admin/cron routes have rate limits and secrets.
- `/health` and `/ready` exist.

Remaining risks:

- Rate limits are in-memory and reset per process/deploy.
- Daily Fritz result trust is not fully replayed.
- Ghost result trust is sanity-bounded but not fully replayed.
- `ranked_games` lacks source id DB uniqueness.
- `matches` lacks a unique expression index on `metadata.roomMatchId`.
- Activity feed lacks idempotency keys.
- Tournament match completion needs conditional DB update/lease for multi-instance.
- Guest behavior in social/quick/private should be abuse-tested at beta volume.

## Production Architecture Audit

Current architecture is suitable for a monitored single-instance controlled beta, not broad public launch.

Launch-risk areas:

- Active live rooms are process memory.
- Matchmaking queue is process memory.
- Tournament room state is process memory, even though tournament rows are DB-backed.
- Disconnect grace and reconnect seats are process memory.
- Rate-limit buckets are process memory.
- Some recovery can recreate room shells, but not exact live hand state.
- Multi-instance tournament scheduler/reconciliation is not lease-protected.
- Ranked source columns are prepared but not migrated/enabled.
- External error tracking and analytics are not yet visible as first-class launch systems.

Recommended durable strategy:

- Snapshot room state, event sequence, hands, boneyard, turn, scores, config, and tournament metadata after each accepted action.
- Store live room snapshots in Redis or a durable DB with short TTL and optimistic version.
- Use a DB/Redis lock for tournament match completion and scheduler jobs.
- Make queue state durable or accept queue loss only in controlled beta.
- Move rate limiting to Redis before scale.
- Add Sentry or equivalent error tracking with tournament attach, room action, and finalize breadcrumbs.

## Browser QA Checklist

| Scenario | Exact Steps | Expected Result | Priority |
|---|---|---|---|
| Play vs Fritz full game | Clear storage, open Play vs Fritz, confirm Standard default, play to game over with at least one score, one double, one forced draw, and one hand transition. | Legal flow preserved, no voluntary draw/pass if playable, result overlay clear, return/reset works. | P1 |
| Daily Fritz normal win | Start today's set, win without skunk, complete set, share result. | Game 1/2/3 progression correct, hand-end reveal visible, set result saved, share works. | P1 |
| Daily Fritz skunk win | Win Game 1 before Fritz reaches 30. | Set ends 2-0, skunk shown, no skipped reveal. | P1 |
| Daily Fritz skunk loss | Lose Game 1 before reaching 30. | Set ends 0-2, practice nudge/result copy clear. | P1 |
| Daily Puzzle slots 1/2/3 | Start puzzle, complete Slot 1, reload, complete Slot 2, reload, complete Slot 3, finalize. | Slot order and setVersion preserved; final overlay and share correct. | P1 |
| Learn lesson complete | Complete Level 1/how-to-play and guided lesson. | Highlights match legal concepts, next steps clear, locked levels intentional. | P2 |
| Ghost full game | Start Ghost, play to game over, save result, share card. | Hidden/side tile clarity, result save, no duplicate complete, share fallback works. | P1 |
| Private room create/join/start/play/end | Browser A creates, Browser B joins, both ready, start, play full hand/game. | Masking correct, actions serialized, reveal correct, result saved once. | P1 |
| Quick match queue/attach/play/end | Browser A/B join queue, match found, attach, play to game over. | Queue copy accurate, attach stable, result/rating no duplicate. | P1 |
| Tournament mostly-bot champion | Register for tournament with mostly bots, wait for lock/start, play all assigned matches to champion. | No premature future results, target 30, overlay persists, staged reveal, final result correct. | P0 |
| Tournament reload lobby | Register, open waiting room, reload before and after bracket lock. | Registration and bracket lobby recover; no stale admin state. | P0 |
| Tournament reload match | Attach to match, reload mid-hand, rejoin. | Same room recovers or clear recovery message; no terminal stale room. | P0 |
| Tournament reload game-over modal | Finish tournament match, wait for overlay, reload before clicking View Bracket. | No skipped/looped overlay; bracket return works. | P0 |
| Tournament human loses Round 1 | Lose QF at 30. | Overlay appears, bracket reveals full resolved path after elimination, no next-match join prompt. | P0 |
| Tournament human wins Round 1 | Win QF at 30, View Bracket. | Other QF results may reveal, SF/Final not completed early, next match attach works. | P0 |
| Mobile/tablet smoke | Run Home, Play vs Fritz, Daily Fritz, Daily Puzzle, Tournament lobby/bracket, and LiveMatch at phone/tablet sizes. | No body scroll on hub screens, buttons readable, rack usable, overlays fit. | P1 |
| Slow network smoke | Throttle network, test tournament attach/final move, Daily Puzzle submit/finalize, quick-match attach. | Clear pending/error states, no double submit, no surprise jumps. | P1 |

## Recommended Patch Plan

1. Tournament P0 browser failures only. Run the matrix above and patch only confirmed tournament runtime failures: overlay, draw animation, reload, attach, staged reveal, score target, terminal recovery.
2. Tournament P1 waiting room/bracket premium UX. Improve live-event feel, field-filling explanation, bot progression presentation, bracket readability, and result states after P0 flow is proven.
3. Browser E2E smoke suite. Add a small browser suite for final move/modal/reload across Play vs Fritz, Daily Fritz, Daily Puzzle, Private Multiplayer, Quick Match, and Tournament.
4. External monitoring/error tracking. Add Sentry or equivalent, structured tournament/room breadcrumbs, and alerts for attach failures, missing rooms, duplicate result attempts, and readiness failures.
5. Durable room strategy. Design and implement Redis/DB room snapshots, queue durability, rate-limit durability, tournament leases, and recovery semantics.
6. Cross-mode result/share polish. Normalize result overlays and share flows; add tournament share; avoid overclaiming rank while saves are pending.
7. Performance/lazy-load pass. Lazy-load tournament screens, remove legacy tournament import, audit assets, and add bundle reporting.
8. Older-player readability pass. Increase critical text sizes, confirm contrast, make disabled states explanatory, and test tablet/mobile/zoom.

## Do Not Do Yet

- Do not mix broad architecture refactors with tournament P0 fixes.
- Do not change Racehorse rules, scoring, forced draw, pass behavior, doubles, or bot AI while tournament runtime is under browser QA.
- Do not rework bot AI before tournament attach/game-over/reload is stable.
- Do not add new modes.
- Do not add Casual Daily Fritz before Classic Daily Fritz is fully polished and trusted.
- Do not enable `ranked_games` source columns before the DB migration, duplicate scans, backfill review, and staging verification.
- Do not add a unique `ranked_games` index before historical duplicate cleanup.
- Do not deploy multi-instance live rooms before durable room snapshots and tournament completion leases exist.
- Do not hide tournament issues with display-only masking if server progression is wrong.
- Do not turn Ghost diagnostics into public UI polish; remove or gate them.
- Do not continue adding shared board CSS overrides outside the emerging board ownership structure unless the fix is a small P0.

## Validation Notes

This was a read-only audit of source code and existing stabilization docs, with one documentation file created. Evidence was gathered from the canonical server engine, client bot engine, Daily Fritz/Daily Puzzle routes, Ghost routes, multiplayer room/session handlers, matchmaking, scheduled tournament engine/dispatch/recovery, social/stats/share surfaces, and existing readiness/idempotency/security docs.

Build results:

| Command | Result | Notes |
|---|---|---|
| `npm run build --prefix client` | Pass | Vite warned that some chunks exceed 500 kB. The largest reported app chunk was `dist/assets/index-B5gYQTqG.js` at 1,945.87 kB minified / 240.90 kB gzip. |
| `npm run build --prefix server` | Pass | TypeScript build completed. |
