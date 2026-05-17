# Racehorse Tournament Flow Skill

Use this whenever changing tournament registration, bracket generation, bracket lobby, match dispatch, match attach, tournament recovery, tournament result, no-show, bot fill, stale cleanup, or tournament UI state.

## Goal

Protect the automatic 8 Ball Pool-style tournament flow.

Players should register, wait in bracket lobby, be automatically sent into their assigned match, then return to bracket/result. Players should not manually enter room codes.

## Core tournament flow

1. Tournament is scheduled.
2. Registration opens 30 minutes before scheduled_start.
3. Registration closes 2 minutes before scheduled_start.
4. After registration closes, bracket is locked/generated.
5. Registered player is routed to Bracket Lobby automatically.
6. Bracket Lobby shows the bracket and countdown to the assigned match.
7. At scheduled_start, server dispatches playable matches.
8. Bot-vs-bot matches may auto-resolve.
9. Human-vs-bot and human-vs-human matches must be playable.
10. Server creates hidden internal room_code.
11. Client receives tournament:match_ready or recovers activeAssignedMatch.
12. Client attaches exactly once per matchId.
13. Attach ack must use normal joined-room payload shape.
14. Client switches to multiplayer only after successful hydrated attach.
15. Completed matches must not be recoverable.
16. Final completion makes tournament terminal.
17. Stale/cancelled/expired tournaments must not trap the player.
18. Back to Tournament must hard-clear tournament/match/recovery state.

## Important rules

- No visible room codes.
- No player-entered tournament rooms.
- Server assigns matches.
- Client must not spam attach.
- Completed rooms are terminal.
- Completed tournament brackets must not show Join Match.
- Cancelled/expired tournaments must not return activeTournamentId.
- Leave Game in tournament is a forfeit, not simple navigation.
- Final result should route to bracket/result, not back to live board.

## Required audit questions

Before changing tournament code, answer:

1. Which tournament phase does this affect?
2. Does it affect registration_open, bracket_lobby, ready, in_progress, completed, cancelled, or expired?
3. Does it affect /api/tournaments/me recovery?
4. Does it affect activeAssignedMatch?
5. Does it affect socket attach?
6. Does it affect room recovery/localStorage?
7. Does it affect bot-vs-bot auto-resolve?
8. Does it accidentally auto-sim human-vs-bot?
9. Does it affect final result routing?
10. Can it trap the user in a stale tournament?
11. Can it reattach to a completed room?
12. Does it require a Supabase migration?

## Files to inspect

Server:
- server/src/scheduledTournament/engine.ts
- server/src/scheduledTournament/scheduler.ts
- server/src/scheduledTournament/matchDispatch.ts
- server/src/scheduledTournament/recovery.ts
- server/src/scheduledTournament/meState.ts
- server/src/scheduledTournament/persistence.ts
- server/src/scheduledTournament/routes.ts
- server/src/multiplayer/registerRoomSessionHandlers.ts
- server/src/multiplayer/roomSession.ts
- server/src/rooms.ts

Client:
- client/src/App.tsx
- client/src/tournament/useTournament.ts
- client/src/tournament/hubState.ts
- client/src/tournament/TournamentHubScreen.tsx
- client/src/tournament/TournamentBracketScreen.tsx
- client/src/tournament/TournamentResultScreen.tsx
- client/src/tournament/tournamentAttachGuard.ts
- client/src/tournament/terminalMatches.ts
- client/src/tournament/bracketTerminal.ts
- client/src/multiplayer/useMultiplayerConnection.ts

Database:
- supabase/migrations/*tournament*
- scheduled_tournaments
- scheduled_tournament_registrations
- scheduled_tournament_matches

## Expected logs

Use or preserve useful logs:

Client:
[tournament] match_ready received
[tournament] recovery activeAssignedMatch received
[tournament:attach-client] start
[tournament:attach-client] ack/success
[tournament:attach-client] ack/error
[tournament:complete] received match_completed
[tournament:exit] back-to-tournament clicked
[tournament:bracket] suppressed join for terminal tournament

Server:
[tournament:dispatch] match ready
[tournament:match_ready] skipped — no connected assigned sockets
[tournament:attach-server] received
[tournament:attach-server] ack/success
[tournament:match] promoted in_progress only after human attach
[tournament:recovery] skipped-completed
[tournament:forfeit] applied

## Tests expected

When relevant, add/update tests for:

- registration closes 2 minutes before start
- registration close routes to bracket lobby
- bracket generated after registration close
- human-vs-bot match is playable
- bot-vs-bot match auto-resolves
- attach happens once per matchId
- attach ack returns full room join payload
- ready and in_progress matches are attachable
- completed matches are not attachable
- completed rooms reject rejoin
- final completed bracket does not show Join Match
- stale tournaments are skipped from recovery
- Back to Tournament clears state
- Leave Game finalizes tournament match as forfeit
- refresh after completed match does not reopen live board

## Manual acceptance checklist

For any tournament flow change, manually test:

1. Register for a fresh tournament.
2. Registration countdown reaches zero.
3. App routes to Bracket Lobby without refresh.
4. Bracket Lobby shows correct round/opponent/countdown.
5. Match starts or Join Match appears at correct time.
6. Human-vs-bot is playable.
7. Finish match.
8. Return to bracket/result.
9. Refresh.
10. App does not reopen completed board.
11. Back to Tournament goes to hub and stays there.
12. No stale old tournament appears.

## Rules for agents

- Do not broad rewrite tournament code.
- Do not mix tournament lifecycle fixes with unrelated UI polish.
- Do not use room-code mental model for players.
- Do not make completed matches recoverable.
- Do not auto-sim human-vs-bot matches.
- Do not show Join Match for terminal final brackets.
- Do not change registration timing without tests and migration.
- If unsure whether a tournament is active/current/stale, inspect DB state and recovery code before guessing.

## Final report format

Tournament Flow Review

What changed:
...

Phase affected:
...

Recovery/attach impact:
...

DB/migration impact:
...

Tests added/updated:
...

Manual test needed:
...

Risks:
...

Build/test result:
...
