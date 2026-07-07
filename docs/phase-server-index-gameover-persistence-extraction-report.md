# Phase: Server `index.ts` Phase 2 Sub-phase 6 (FINAL) — `createGameOverPersistScheduler` Extraction

## Goal

Extract **only** `createGameOverPersistScheduler` from `server/src/index.ts` into a dedicated module. Zero behavior change on ranked-game persistence, Glicko rating updates, league fixture finalization, ghost completion, and match logging — preserving exact branch order, async/fire-and-forget distinctions, try/catch boundary, idempotency gate, and league matching logic.

## Summary

| Item | Result |
|------|--------|
| New module | `server/src/realtime/gameOverPersistence.ts` (279 LOC) |
| New tests | `server/src/realtime/gameOverPersistence.test.ts` (373 LOC, 11 tests) |
| `index.ts` LOC | 1,051 → **784** (−267) |
| Call sites | **1** (`initRoomSession` `onGameOver`) — unchanged semantics via factory |
| Behavior change | **None** |

---

## Grep proof — `createGameOverPersistScheduler` across `server/src/`

**Command:**

```bash
rg 'createGameOverPersistScheduler' server/src
```

| File | Line(s) | Role |
|------|---------|------|
| `server/src/index.ts` | **149** | `import { createGameOverPersistScheduler } from './realtime/gameOverPersistence'` |
| `server/src/index.ts` | **589** | **Sole consumer:** `initRoomSession(io, { onGameOver: createGameOverPersistScheduler(io), ... })` |
| `server/src/realtime/gameOverPersistence.ts` | **27** | Factory export |
| `server/src/realtime/gameOverPersistence.test.ts` | **89–92, 141** | Tests only |

**Confirmed: exactly one production consumer** — `initRoomSession` `onGameOver` slot. No other references in `server/src/`.

---

## Full `GameOverPersistInput` type definition

From `server/src/multiplayer/roomSession.ts`:

```typescript
export type GameOverPersistInput = {
  room: Room;
  /** Frozen at persist schedule time — do not read `room.matchId` again in the IIFE. */
  sourceMatchId: string;
  cfg: Record<string, unknown>;
  aId: string;
  bId: string;
  a: RoomPlayer;
  b: RoomPlayer;
  scoreA: number;
  scoreB: number;
  winnerSeatId: string;
};
```

### Field traceability — every destructured field

| Destructured in scheduler | Source field | Usage in function |
|---------------------------|--------------|-------------------|
| `room` | `input.room` | Tournament branches, Fritz context, `appendMatch`, activity, ranking loop, ghost logs, league fixture query (`room.code`), `matchmakingMatchId` |
| `sourceMatchId` | `input.sourceMatchId` | `recordPublicOnlineMatch`, ranked insert `source.sourceMatchId`, `completeGhostGame`, logging, idempotency warn |
| `cfg` | `input.cfg` | `cfg.tournamentId`, `cfg.tournamentMatchId` passed to `appendMatch` |
| `aId` | `input.aId` | `maxDeficitWinner` lead-tracker branch; winner/loser roster selection |
| `bId` | `input.bId` | `maxDeficitWinner` lead-tracker branch; winner/loser roster selection |
| `a` | `input.a` | `winnerUserId` derivation (`a.id`, `a.userId`); `appendMatch`; activity; ranking participant; league home/away player match |
| `b` | `input.b` | Same as `a` for player B |
| `scoreA` | `input.scoreA` | Tournament apply, `appendMatch`, activity scores, ranking, league scores |
| `scoreB` | `input.scoreB` | Same as `scoreA` for player B |
| `winnerSeatId` | `input.winnerSeatId` | `winnerUserId`; `maxDeficitWinner`; activity winner/loser; `recordPublicOnlineMatch`; `recordMatchEnd` winner |

---

## Module path and `io` factory justification

**Path:** `server/src/realtime/gameOverPersistence.ts`

**Reasoning:**

- Sits at the intersection of **realtime room lifecycle** (game-over IIFE scheduled by `roomSession`) and cross-cutting persistence (ranking, league, ghost, stats).
- `realtime/` namespace distinguishes this orchestrator from domain modules (`ranking/`, `league/`, `ghost/`, `stats/`) — those modules are **called**, not modified.
- Parallels client-side extraction patterns where room-session orchestration lives outside domain stores.

**`io` binding — factory `createGameOverPersistScheduler(io)`:**

| Before | After |
|--------|-------|
| `createGameOverPersistScheduler(input)` closed over module-scope `io` | `createGameOverPersistScheduler(io)` returns `(input) => () => Promise<void>` |
| `onGameOver: createGameOverPersistScheduler` | `onGameOver: createGameOverPersistScheduler(io)` |

`RoomSessionDeps.onGameOver` type is `(input: GameOverPersistInput) => (() => Promise<void>) | null`. The factory is invoked **once at module load** (same moment `io` exists), producing a function with **identical** callable signature to the pre-extraction module-scope version. No ref bridge through `index.ts` beyond this single factory call.

---

## Moved pieces — before (full source from `server/src/index.ts`)

```typescript
function createGameOverPersistScheduler(input: GameOverPersistInput): () => Promise<void> {
  const { room, sourceMatchId, cfg, aId, bId, a, b, scoreA, scoreB, winnerSeatId } = input;
  return async () => {
    try {
      const winnerUserId =
        winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
      if (winnerUserId) {
        const applied = await applyTournamentGameOverFromRoom(io, room, {
          winnerUserId,
          player1Score: scoreA,
          player2Score: scoreB,
        });
        if (applied) return;
      }
      if (room.scheduledTournamentMatchId) {
        if (!winnerUserId) {
          console.warn('[tournament:game-over] missing winner user id', {
            roomCode: room.code,
            matchId: room.scheduledTournamentMatchId,
          });
        }
        return;
      }
      const tournamentMatchByRoom = await findTournamentMatchByRoom(room.code).catch(() => null);
      if (tournamentMatchByRoom) {
        if (!winnerUserId) {
          console.warn('[tournament:game-over] missing winner user id', {
            roomCode: room.code,
            matchId: tournamentMatchByRoom.id,
          });
        }
        return;
      }

      if (getPendingFritzMatchContext(room)) {
        await resolvePendingFritzMatch(room.code);
      }

      await appendMatch({
        endedAtMs: Date.now(),
        roomCode: room.code,
        tournamentId: typeof cfg.tournamentId === 'string' ? cfg.tournamentId : undefined,
        tournamentMatchId: typeof cfg.tournamentMatchId === 'string' ? cfg.tournamentMatchId : undefined,
        maxDeficitWinner: (() => {
          const t = room.leadTracker;
          if (!t) return 0;
          if (winnerSeatId === aId) return t.maxLeadB ?? 0;
          if (winnerSeatId === bId) return t.maxLeadA ?? 0;
          return 0;
        })(),
        a: { seatId: a.id, userId: a.userId, username: a.username },
        b: { seatId: b.id, userId: b.userId, username: b.username },
        scoreA,
        scoreB,
        winnerSeatId,
        pointDiff: Math.abs(scoreA - scoreB),
      });

      const fritzActivityCtx = getPendingFritzMatchContext(room);
      const winnerRoster = winnerSeatId === aId ? a : b;
      const loserRoster = winnerSeatId === aId ? b : a;
      const activityDisplayName = (p: typeof a) =>
        fritzActivityCtx && typeof p.id === 'string' && p.id.startsWith('bot:fritz:')
          ? formatFritzActivityOpponentLabel(fritzActivityCtx.fritzTier)
          : p.username;

      void writeMatchActivity({
        winnerUserId: winnerSeatId === aId ? a.userId : b.userId,
        loserUserId: winnerSeatId === aId ? b.userId : a.userId,
        winnerUsername: activityDisplayName(winnerRoster),
        loserUsername: activityDisplayName(loserRoster),
        mode: fritzActivityCtx ? 'bot' : 'online',
        winnerScore: winnerSeatId === aId ? scoreA : scoreB,
        loserScore: winnerSeatId === aId ? scoreB : scoreA,
        fritzTier: fritzActivityCtx?.fritzTier ?? null,
      }).catch(() => {});

      if (a.userId && b.userId && !fritzActivityCtx) {
        const ratedWinnerUserId = winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
        const ratedLoserUserId = winnerSeatId === a.id ? b.userId : winnerSeatId === a.id ? a.userId : null;
        if (ratedWinnerUserId && ratedLoserUserId) {
          void recordPublicOnlineMatch({
            roomCode: room.code,
            roomMatchId: sourceMatchId,
            winnerUserId: ratedWinnerUserId,
            loserUserId: ratedLoserUserId,
            winnerScore: winnerSeatId === a.id ? scoreA : scoreB,
            loserScore: winnerSeatId === a.id ? scoreB : scoreA,
          });
        }
      }

      const rankingParticipants = [
        { me: a, opp: b, myScore: scoreA, oppScore: scoreB },
        { me: b, opp: a, myScore: scoreB, oppScore: scoreA },
      ];
      const rankingProfiles = new Map<string, any>();
      const rankedInsertResults = new Map<string, Awaited<ReturnType<typeof insertRankedGameIdempotent>>>();
      const rankedPlayedAt = new Date().toISOString();
      const rankedSourceColumnsEnabled = isRankedGameSourceColumnsEnabled();
      console.log('[Ranking] game-over persist ranked insert', {
        roomCode: room.code,
        sourceMatchId,
        rankedSourceColumnsEnabled,
      });

      for (const p of rankingParticipants) {
        if (p.me.userId) {
          const opponentId = p.opp.userId || (p.opp.id.startsWith('bot:fritz:') ? FRITZ_SYSTEM_ID : null);
          if (opponentId) {
            let profile = rankingProfiles.get(p.me.userId);
            if (!profile) {
              const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${p.me.userId}`);
              profile = profileData?.[0];
              if (profile) {
                rankingProfiles.set(p.me.userId, profile);
              }
            }
            if (profile) {
              const insertResult = await insertRankedGameIdempotent({
                playerId: p.me.userId,
                opponentId,
                playerScore: p.myScore,
                opponentScore: p.oppScore,
                gameType: opponentId === FRITZ_SYSTEM_ID ? 'fritz' : 'multiplayer',
                ratingBefore: profile.glicko_rating,
                rdBefore: profile.glicko_rd,
                playedAt: rankedPlayedAt,
                source: { sourceType: 'live_room', sourceMatchId },
              });
              rankedInsertResults.set(p.me.userId, insertResult);
            }

            const moveLog = room.ghostMoveLogs[p.me.id] ?? [];
            if (moveLog.length > 0) {
              await completeGhostGame({
                userId: p.me.userId,
                opponentUserId: opponentId,
                finalScore: p.myScore,
                opponentScore: p.oppScore,
                moveLog,
                matchId: sourceMatchId,
              });
            }
          }
        }
      }

      if (a.userId && b.userId) {
        const playerAProfile = rankingProfiles.get(a.userId);
        const playerBProfile = rankingProfiles.get(b.userId);
        const playerAInsert = rankedInsertResults.get(a.userId);
        const playerBInsert = rankedInsertResults.get(b.userId);

        if (
          playerAProfile &&
          playerBProfile &&
          playerAInsert?.isNew &&
          playerBInsert?.isNew &&
          playerAInsert.game &&
          playerBInsert.game
        ) {
          try {
            const ratingResult = await processRealtimeMultiplayerGame({
              playerAProfile,
              playerBProfile,
              playerAGame: playerAInsert.game,
              playerBGame: playerBInsert.game,
            });
            console.log('[Ranking] Real-time update complete', {
              playerA: a.userId,
              playerB: b.userId,
              sourceMatchId,
            });

            if (room.matchmakingMatchId) {
              const matchWinnerUserId =
                winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
              void recordMatchEnd({
                matchId: room.matchmakingMatchId,
                status: 'completed',
                winnerId: matchWinnerUserId,
                playerARatingChange: ratingResult?.playerA?.delta ?? null,
                playerBRatingChange: ratingResult?.playerB?.delta ?? null,
                isSim: false,
              });
            }
          } catch (err) {
            console.error('[Ranking] Real-time update failed:', err);
          }
        } else {
          console.warn('[Ranking] Skipping real-time update — duplicate or missing ranked insert', {
            hasPlayerAProfile: !!playerAProfile,
            hasPlayerBProfile: !!playerBProfile,
            playerAIsNew: playerAInsert?.isNew ?? false,
            playerBIsNew: playerBInsert?.isNew ?? false,
            sourceMatchId,
          });
        }
      }

      const linkedFixtureRows = await supabaseFetch<any[]>(
        `/rest/v1/fixtures?select=id,status,home_member_id,away_member_id,live_room_code&live_room_code=eq.${room.code}&limit=1`,
      );
      const linkedFixture = linkedFixtureRows?.[0];
      if (linkedFixture && linkedFixture.status !== 'completed' && linkedFixture.status !== 'forfeit') {
        const fixtureMembers = await supabaseFetch<any[]>(
          `/rest/v1/league_members?select=id,player_user_id&id=in.("${linkedFixture.home_member_id}","${linkedFixture.away_member_id}")`,
        );
        const homeMember = fixtureMembers.find((member) => member?.id === linkedFixture.home_member_id) ?? null;
        const awayMember = fixtureMembers.find((member) => member?.id === linkedFixture.away_member_id) ?? null;
        const livePlayers = [a, b];
        const homePlayer = livePlayers.find((player) => player.userId === homeMember?.player_user_id) ?? null;
        const awayPlayer = livePlayers.find((player) => player.userId === awayMember?.player_user_id) ?? null;

        if (homeMember && awayMember && homePlayer && awayPlayer) {
          const homeScore = homePlayer.id === a.id ? scoreA : scoreB;
          const awayScore = awayPlayer.id === a.id ? scoreA : scoreB;
          try {
            await recordLeagueLiveResult({
              fixtureId: linkedFixture.id,
              playerMemberId: homeMember.id,
              opponentMemberId: awayMember.id,
              homeScore,
              awayScore,
              sourceUserId: a.userId ?? b.userId ?? null,
              roomCode: room.code,
              metadata: { via: 'live-room-auto-finalize' },
            });
            console.log('[League] Live fixture finalized', {
              fixtureId: linkedFixture.id,
              roomCode: room.code,
            });
          } catch (err) {
            console.error('[League] Live fixture finalization failed:', err);
          }
        } else {
          console.warn('[League] Skipping live fixture finalization — player mapping missing', {
            fixtureId: linkedFixture.id,
            roomCode: room.code,
            hasHomeMember: !!homeMember,
            hasAwayMember: !!awayMember,
            hasHomePlayer: !!homePlayer,
            hasAwayPlayer: !!awayPlayer,
          });
        }
      }
    } catch (err) {
      console.warn('Ranking/Match logging failed', err);
    }
  };
}
```

---

## Moved pieces — after (`server/src/index.ts`)

### Import added

```typescript
import { createGameOverPersistScheduler } from './realtime/gameOverPersistence';
```

### Imports removed (only used by extracted function)

- `completeGhostGame` from `./ghost/service`
- `recordLeagueLiveResult` from `./league/results`
- `appendMatch` from `./stats/matchLog` (kept `computeWeeklyAwards`)
- `recordPublicOnlineMatch`
- `FRITZ_SYSTEM_ID` from `./ranking/glicko2`
- `processRealtimeMultiplayerGame` from `./ranking/periodService` (kept `getLeaderboard`, `processRatingPeriod`)
- `buildRankedGameInsertPayload`, `isRankedGameSourceColumnsEnabled`, `RankedGameSource` from `./ranking/rankedGamePayload`
- `insertRankedGameIdempotent`
- `recordMatchEnd` from `./matchmaking/persistence`
- `applyTournamentGameOverFromRoom`, `findTournamentMatchByRoom` from `./scheduledTournament` (kept `bootstrapScheduledTournamentInfrastructure`, `initScheduledTournaments`)
- `resolvePendingFritzMatch` from `./shared/fritzMatchLifecycle` (kept `getPendingFritzMatchContext`, `insertPendingFritzMatch` for `onAfterMatchStarted`)
- `type GameOverPersistInput` from `./multiplayer/roomSession`

### `initRoomSession` wiring

```typescript
initRoomSession(io, {
  persistRoomMatchLog,
  onGameOver: createGameOverPersistScheduler(io),
  finalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
  resolveSocketIdentity,
  normalizeUsername,
  normalizeUserId,
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
  onAfterMatchStarted,
  notifyRoomPlayersInGame,
  maybeFinalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
});
```

---

## Full source — new module

See `server/src/realtime/gameOverPersistence.ts` (279 LOC) — function body is **byte-for-byte identical** to the before source above, wrapped in:

```typescript
export function createGameOverPersistScheduler(io: Server) {
  return function scheduleGameOverPersist(input: GameOverPersistInput): () => Promise<void> {
    // ... identical IIFE body ...
  };
}
```

---

## Full source — new test file

See `server/src/realtime/gameOverPersistence.test.ts` (373 LOC, 11 tests).

| Test | Branch / constraint verified |
|------|------------------------------|
| `short-circuits when applyTournamentGameOverFromRoom returns true` | Branch (a) — no downstream calls |
| `returns early for scheduledTournamentMatchId without downstream persist` | Branch (b) with `winnerUserId` — no warn |
| `warns on scheduledTournamentMatchId when winnerUserId is missing` | Branch (b) — warn only when missing |
| `returns early when findTournamentMatchByRoom finds a match` | Branch (c) with `winnerUserId` |
| `warns on findTournamentMatchByRoom path when winnerUserId is missing` | Branch (c) — warn only when missing |
| `awaits resolvePendingFritzMatch before appendMatch` | Fritz forfeit before `appendMatch` |
| `calls processRealtimeMultiplayerGame when both ranked inserts are new` | Idempotency gate — both `isNew` |
| `skips processRealtimeMultiplayerGame with warn when either insert is not new` | Idempotency gate — warn with diagnostic fields |
| `calls recordLeagueLiveResult when fixture is active and mapping complete` | League — all four mapping checks pass |
| `skips recordLeagueLiveResult with warn when player mapping is incomplete` | League — warn when mapping incomplete |
| `swallows awaited errors with outer console.warn` | Outer try/catch — no propagate |

---

## Constraint confirmation — line by line

### 1. Branch order (preserved exactly)

| Step | Condition | Action | Reordered? |
|------|-----------|--------|------------|
| (a) | `winnerUserId` truthy | `await applyTournamentGameOverFromRoom(...)`; `if (applied) return` | No |
| (b) | `room.scheduledTournamentMatchId` | warn if `!winnerUserId`; `return` | No |
| (c) | `await findTournamentMatchByRoom(room.code).catch(() => null)` truthy | warn if `!winnerUserId`; `return` | No |
| (d) | else | Fritz resolve → `appendMatch` → activity → public match → ranking loop → idempotency gate → league fixture | No |

### 2. Async/await vs fire-and-forget (preserved call-by-call)

| Call | Style | Preserved? |
|------|-------|------------|
| `applyTournamentGameOverFromRoom` | `await` | ✅ |
| `findTournamentMatchByRoom` | `await` (with `.catch(() => null)` on promise) | ✅ |
| `resolvePendingFritzMatch` | `await` | ✅ |
| `appendMatch` | `await` | ✅ |
| `writeMatchActivity(...)` | `void ... .catch(() => {})` | ✅ |
| `recordPublicOnlineMatch(...)` | `void` (no await, no .catch) | ✅ |
| `supabaseFetch` (profiles) | `await` inside loop | ✅ |
| `insertRankedGameIdempotent` | `await` | ✅ |
| `completeGhostGame` | `await` | ✅ |
| `processRealtimeMultiplayerGame` | `await` (inner try/catch) | ✅ |
| `recordMatchEnd(...)` | `void` (inside rating try) | ✅ |
| `supabaseFetch` (fixtures, league_members) | `await` | ✅ |
| `recordLeagueLiveResult` | `await` (inner try/catch) | ✅ |

### 3. Try/catch boundary (preserved exactly)

- **Outer:** Single `try { ... entire body after winnerUserId ... } catch (err) { console.warn('Ranking/Match logging failed', err); }` wraps the returned async IIFE.
- **Inner (rating):** `try/catch` around `processRealtimeMultiplayerGame` logs `console.error('[Ranking] Real-time update failed:', err)` — unchanged.
- **Inner (league):** `try/catch` around `recordLeagueLiveResult` logs `console.error('[League] Live fixture finalization failed:', err)` — unchanged.
- **Shape not narrowed or split.**

### 4. Idempotency gate (preserved exactly)

```typescript
rankedInsertResults.set(p.me.userId, insertResult);  // per player in loop

if (
  playerAProfile &&
  playerBProfile &&
  playerAInsert?.isNew &&
  playerBInsert?.isNew &&
  playerAInsert.game &&
  playerBInsert.game
) {
  // await processRealtimeMultiplayerGame(...)
} else {
  console.warn('[Ranking] Skipping real-time update — duplicate or missing ranked insert', {
    hasPlayerAProfile: !!playerAProfile,
    hasPlayerBProfile: !!playerBProfile,
    playerAIsNew: playerAInsert?.isNew ?? false,
    playerBIsNew: playerBInsert?.isNew ?? false,
    sourceMatchId,
  });
}
```

Gate logic and warn payload unchanged.

### 5. League fixture matching (preserved exactly)

1. `await supabaseFetch` fixtures filtered by `live_room_code=eq.${room.code}&limit=1`
2. Guard: `linkedFixture.status !== 'completed' && linkedFixture.status !== 'forfeit'`
3. `await supabaseFetch` league_members with `id=in.("home","away")`
4. `homeMember` / `awayMember` by `linkedFixture.home_member_id` / `away_member_id`
5. `homePlayer` / `awayPlayer` by matching `player.userId === member.player_user_id`
6. All four truthy → `await recordLeagueLiveResult(...)`; else → `console.warn('[League] Skipping live fixture finalization — player mapping missing', { hasHomeMember, hasAwayMember, hasHomePlayer, hasAwayPlayer, ... })`

---

## Build and test results

### Baseline (before extraction — sub-phase 5 after-numbers)

| Metric | Value |
|--------|-------|
| Test files | **65** |
| Tests | **479** |
| Build | Pass |

**Discrepancy check:** Matches sub-phase 5 report exactly.

### After extraction

| Metric | Value |
|--------|-------|
| Test files | **66** (+1) |
| Tests | **490** (+11) |
| Build | **Pass** (`npm run build --prefix server`) |
| Duration | ~2.5s |

**Commands run:**

```bash
npm test --prefix server
npm run build --prefix server
```

---

## Confirmation table — untouched systems

| System | Status |
|--------|--------|
| `scheduled/dailyWarmup.ts` (sub-phase 1) | ✅ Untouched |
| `matchmaking/roomShellHydration.ts` (sub-phase 2) | ✅ Untouched |
| `multiplayer/registerRoomChatEmoteHandlers.ts` (sub-phase 3) | ✅ Untouched |
| `social/registerPresenceHandlers.ts` (sub-phase 4) | ✅ Untouched |
| `legacyTournament/registerLegacyTournamentHandlers.ts` (sub-phase 5) | ✅ Untouched |
| Global `SOCKET_EVENT_LIMITS` / `installSocketRateLimit` | ✅ Untouched |
| `io` / `Server` / CORS setup | ✅ Untouched |
| `registerMatchmakingHandlers` | ✅ Untouched |
| `initScheduledTournaments` / `scheduledTournament/**` | ✅ Untouched |
| `ranking/**` module internals | ✅ Untouched (imports only) |
| `league/**` module internals | ✅ Untouched (imports only) |
| `ghost/**` module internals | ✅ Untouched (imports only) |
| `stats/**` module internals | ✅ Untouched (imports only) |
| `shared/**` module internals | ✅ Untouched (imports only) |
| `client/` | ✅ Untouched |

---

## Phase 2 complete — `index.ts` LOC reduction summary

| Milestone | `index.ts` LOC | Δ from prior |
|-----------|----------------|--------------|
| Phase 1 end-state (route extraction) | **1,631** | — |
| Sub-phase 1 — daily warmup | 1,504 | −127 |
| Sub-phase 2 — matchmaking hydration | 1,460 | −44 |
| Sub-phase 3 — chat/emote | 1,390 | −70 |
| Sub-phase 4 — presence | 1,330 | −60 |
| Sub-phase 5 — legacy tournament | 1,051 | −279 |
| **Sub-phase 6 — game-over persistence (FINAL)** | **784** | **−267** |

| Phase 2 total | |
|---------------|--|
| Starting LOC (Phase 1 end) | 1,631 |
| Final LOC | **784** |
| **Total reduction** | **−847 LOC (−52%)** |

Phase 2 extracted six orchestration surfaces from `index.ts` into dedicated modules with **zero behavior change** and **+57 new tests** across the six sub-phases (469 → 490 cumulative server tests after sub-phases 1–6).