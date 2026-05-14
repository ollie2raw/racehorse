# League Feature Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the entire `league/` feature and remove all references to it across the codebase so TypeScript compiles cleanly with zero league-related code remaining.

**Architecture:** Four independent passes — (1) update type unions and remove `openLeagueLiveRoom` from the multiplayer hook; (2) remove the lazy import, mode union entry, path entry, hook destructure, and render block from App.tsx; (3) remove league persistence logic from BotMatchScreen.tsx and simplify the affected `??` chains and effects; (4) delete the `client/src/league/` directory. TypeScript check at the end proves completeness.

**Tech Stack:** TypeScript, React. No CSS changes. No new files.

**Protected files — do NOT touch:**
- `client/src/styles/walnut-live.css`
- `client/src/learn/`
- `client/src/learning/`
- `client/src/multiplayer/` — except the specific lines called out below

---

### Task 1: Remove `| 'league'` from type unions and delete `openLeagueLiveRoom` from the multiplayer hook

**Files:**
- Modify: `client/src/types.ts` (line 91)
- Modify: `client/src/screens/HomeScreen.tsx` (line 27)
- Modify: `client/src/multiplayer/useMultiplayerRoomActions.ts` (lines 64, 242–286, 393)

**Context:** `AppMode` is a union type defined in both `client/src/types.ts` and re-declared locally in `client/src/screens/HomeScreen.tsx` and `client/src/multiplayer/useMultiplayerRoomActions.ts`. All three need `| 'league'` removed. The multiplayer hook also has an `openLeagueLiveRoom` callback that joins a live room from the league — this entire callback and its return entry must go.

- [ ] **Step 1: Remove `| 'league'` from types.ts**

Read `client/src/types.ts` around line 91 to confirm the exact text, then use the Edit tool to remove the line.

The line to remove is:
```
  | 'league'
```
(it sits between `| 'dailyFritz'` and `| 'learn'` in the AppMode union)

After edit, the union should flow directly from `| 'dailyFritz'` to `| 'learn'`.

- [ ] **Step 2: Remove `| 'league'` from HomeScreen.tsx**

Read `client/src/screens/HomeScreen.tsx` around line 27 to confirm, then use the Edit tool.

The line to remove is the same pattern: `  | 'league'`

- [ ] **Step 3: Remove `| 'league'` from useMultiplayerRoomActions.ts**

Read `client/src/multiplayer/useMultiplayerRoomActions.ts` lines 58–71. The union looks like:

```ts
      | 'botSetup'
      | 'bot'
      | 'ghostSetup'
      | 'ghost'
      | 'daily'
      | 'dailyFritz'
      | 'league'
      | 'learn'
      | 'friends'
      | 'stats'
      | 'ratingHistory'
      | 'singlePlayerHub'
      | 'tournament'
```

Remove `      | 'league'` so the union flows from `| 'dailyFritz'` to `| 'learn'`.

- [ ] **Step 4: Remove `openLeagueLiveRoom` callback from useMultiplayerRoomActions.ts**

Read lines 240–290 of `client/src/multiplayer/useMultiplayerRoomActions.ts`. The block to delete is:

```ts
  const openLeagueLiveRoom = useCallback(
    async (code: string) => {
      const normalizedCode = params.normalizeRoomCode(code);
      if (!normalizedCode) {
        throw new Error('Live room code is invalid.');
      }

      params.setRoomCode(normalizedCode);
      params.setAppMode('multiplayer');
      params.setError('');
      params.setActionError('');

      const activeSocket = params.socketRef.current;
      if (activeSocket?.connected) {
        const resp = await params.emitWithAck<any>(
          activeSocket,
          'room:join',
          normalizedCode,
          {
            username: params.authUsernameRef.current,
            userId: params.authUserIdRef.current,
            authToken: params.authTokenRef.current,
          },
        );
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to join live room.');
        }
        params.applyJoinedRoomResponse(resp);
        params.autoJoinAttemptedRef.current = false;
        params.preventAutoRejoinRef.current = false;
        return;
      }

      params.reconnectRoomCodeRef.current = normalizedCode;
      params.reconnectShouldJoinRef.current = true;
      params.preventAutoRejoinRef.current = false;
      params.autoJoinAttemptedRef.current = false;
      params.setRoomRecoveryState('reconnecting');
      params.setRoomRecoveryMessage('Joining live room…');
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(params.lastRoomStorageKey, normalizedCode);
      }
      params.connectRef.current();
    },
    [params],
  );
```

Use the Edit tool to delete this entire block (including any blank lines above/below it that would create a double blank line).

- [ ] **Step 5: Remove `openLeagueLiveRoom` from the hook's return object**

Read `client/src/multiplayer/useMultiplayerRoomActions.ts` around line 393. The return object contains:

```ts
    openLeagueLiveRoom,
```

Remove that line from the return object.

- [ ] **Step 6: Verify**

```bash
grep -n "league\|League" /Users/olivermorid/racehorse-dominoes/client/src/types.ts
grep -n "league\|League" /Users/olivermorid/racehorse-dominoes/client/src/screens/HomeScreen.tsx
grep -n "league\|League" /Users/olivermorid/racehorse-dominoes/client/src/multiplayer/useMultiplayerRoomActions.ts
```

Expected: no output from any of the three commands.

- [ ] **Step 7: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/types.ts client/src/screens/HomeScreen.tsx client/src/multiplayer/useMultiplayerRoomActions.ts
git commit -m "chore: remove league from AppMode unions and delete openLeagueLiveRoom hook"
```

---

### Task 2: Remove league from App.tsx

**Files:**
- Modify: `client/src/App.tsx` (lines 123, 140, 757, 1604, 3024–3037)

**Context:** App.tsx has five distinct league references: (1) `| 'league'` in its local AppMode union, (2) a `React.lazy` import for `LeagueScreen`, (3) `league: '/league'` in the path map, (4) `openLeagueLiveRoom` destructured from `useMultiplayerRoomActions`, and (5) a full `if (appMode === 'league')` render block. All five must be removed.

- [ ] **Step 1: Remove `| 'league'` from App.tsx local AppMode union**

Read `client/src/App.tsx` lines 118–130 to confirm. The union member to delete is `  | 'league'` between `| 'dailyFritz'` and `| 'learn'`.

- [ ] **Step 2: Remove the LeagueScreen lazy import**

Read `client/src/App.tsx` around line 140. Delete the line:

```ts
const LeagueScreen = React.lazy(() => import('./league/LeagueScreen'));
```

- [ ] **Step 3: Remove `league: '/league'` from MODE_TO_PATH**

Read `client/src/App.tsx` around line 757. The constant looks like:

```ts
const MODE_TO_PATH: Partial<Record<AppMode, string>> = {
  home: '/',
  stats: '/stats',
  friends: '/friends',
  daily: '/daily',
  dailyFritz: '/daily-fritz',
  league: '/league',
  ratingHistory: '/rating-history',
  ...
```

Delete the `  league: '/league',` line only.

- [ ] **Step 4: Remove `openLeagueLiveRoom` from the useMultiplayerRoomActions destructure**

Read `client/src/App.tsx` around line 1599–1610. The destructure looks like:

```ts
  const {
    onCreatePrivateRoom,
    copyInviteLink,
    createRoom,
    joinRoom,
    openLeagueLiveRoom,
    acceptFriendInvite,
  } = useMultiplayerRoomActions({
```

Delete only the `    openLeagueLiveRoom,` line.

- [ ] **Step 5: Remove the league render block**

Read `client/src/App.tsx` lines 3024–3037. The block to delete is:

```ts
  if (appMode === 'league') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading League…" />}>
          <LeagueScreen
            user={authUser}
            profile={authProfile}
            onBack={() => setAppMode('home')}
            onOpenLiveMatch={openLeagueLiveRoom}
          />
        </Suspense>
      </div>
    );
  }
```

Delete this entire block. The file should have no gap — the `if` block before league and after league should sit adjacent.

- [ ] **Step 6: Verify no league references remain in App.tsx**

```bash
grep -n "league\|League" /Users/olivermorid/racehorse-dominoes/client/src/App.tsx
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/App.tsx
git commit -m "chore: remove league lazy import, AppMode entry, path entry, and render block from App.tsx"
```

---

### Task 3: Remove league persistence from BotMatchScreen.tsx

**Files:**
- Modify: `client/src/bot/BotMatchScreen.tsx`

**Context:** BotMatchScreen has two optional props (`resumeKey`, `onMatchComplete`) that were only ever passed from `LeagueScreen`. With league gone these props will never be set, but they must be removed to keep the interface clean. The league persistence block (`LEAGUE_MATCH_META_KEY`, `leagueResumeStorageKey`, `loadPersistedLeagueMatch`, `initialPersistedLeagueMatch`, `clearPersistedLeagueMatch`) must be deleted. Five `??` chains that fall back to `initialPersistedLeagueMatch` must be simplified. Three effects that reference `isLeagueMatch` or `clearPersistedLeagueMatch` must be cleaned up. `isLeagueMatch` itself must be removed.

Do these edits in order — top to bottom — so each edit has a unique match.

- [ ] **Step 1: Remove `resumeKey` and `onMatchComplete` from the interface**

Read `client/src/bot/BotMatchScreen.tsx` lines 134–158 to confirm. Delete these two lines from `BotMatchScreenProps`:

```ts
  resumeKey?: string | null;
  onMatchComplete?: ((result: {
    winner: 'you' | 'bot' | null;
    yourScore: number;
    botScore: number;
  }) => void) | null;
```

- [ ] **Step 2: Remove `resumeKey` and `onMatchComplete` from the destructure**

Read around line 671. The function signature destructure contains:

```ts
  resumeKey = null,
  onMatchComplete = null,
```

Delete both lines.

- [ ] **Step 3: Delete the league persistence initialization block**

Read lines 682–734. Delete this entire block:

```ts
  const LEAGUE_MATCH_META_KEY = 'racehorse:league-match-meta';
  const leagueResumeStorageKey = resumeKey ? `racehorse:league-match:${resumeKey}` : null;
```

and the entire `loadPersistedLeagueMatch` function plus its call:

```ts
  const loadPersistedLeagueMatch = () => {
    if (!leagueResumeStorageKey || typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(leagueResumeStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        resumeKey?: string;
        mode?: 'bot' | 'ghost';
        opponentName?: string;
        winningScore?: number;
        dealSize?: number;
        match?: BotMatchState;
        movesUsed?: number;
        moveLog?: MoveEntry[];
        ghostMoveLog?: GhostMoveLogEntry[];
        ghostProfile?: GhostProfileSummary | null;
        matchStartGlickoRating?: number | null;
      };
      if (parsed.resumeKey !== resumeKey || !parsed.match) return null;
      return parsed;
    } catch {
      return null;
    }
  };
  const initialPersistedLeagueMatch = loadPersistedLeagueMatch();
```

Use the Edit tool. The `old_string` starts at `  const LEAGUE_MATCH_META_KEY` and ends after `  const initialPersistedLeagueMatch = loadPersistedLeagueMatch();`.

- [ ] **Step 4: Simplify the match useState initializer**

Read around line 888–894. The current initializer:

```ts
    return (
      initialPersistedDailyFritzMatch?.match ??
      initialPersistedLeagueMatch?.match ??
      (mode === 'daily-fritz' && dailyFritzPackage
        ? createFixedBotMatch(dailyFritzPackage.first_hand, winningScore, dealSize)
        : createBotMatch(winningScore, dealSize))
    );
```

Replace with (remove the `initialPersistedLeagueMatch?.match ??` line):

```ts
    return (
      initialPersistedDailyFritzMatch?.match ??
      (mode === 'daily-fritz' && dailyFritzPackage
        ? createFixedBotMatch(dailyFritzPackage.first_hand, winningScore, dealSize)
        : createBotMatch(winningScore, dealSize))
    );
```

- [ ] **Step 5: Simplify movesUsed useState initializer**

Read around line 915–916. Current:

```ts
  const [movesUsed, setMovesUsed] = useState(
    initialPersistedDailyFritzMatch?.movesUsed ?? initialPersistedLeagueMatch?.movesUsed ?? 0,
  );
```

Replace with:

```ts
  const [movesUsed, setMovesUsed] = useState(
    initialPersistedDailyFritzMatch?.movesUsed ?? 0,
  );
```

- [ ] **Step 6: Simplify moveLog useState initializer**

Read around line 921–923. Current:

```ts
  const [moveLog, setMoveLog] = useState<MoveEntry[]>(
    initialPersistedDailyFritzMatch?.moveLog ?? initialPersistedLeagueMatch?.moveLog ?? [],
  );
```

Replace with:

```ts
  const [moveLog, setMoveLog] = useState<MoveEntry[]>(
    initialPersistedDailyFritzMatch?.moveLog ?? [],
  );
```

- [ ] **Step 7: Simplify ghostMoveLog useState initializer**

Read around line 924. Current:

```ts
  const [ghostMoveLog, setGhostMoveLog] = useState<GhostMoveLogEntry[]>(initialPersistedLeagueMatch?.ghostMoveLog ?? []);
```

Replace with:

```ts
  const [ghostMoveLog, setGhostMoveLog] = useState<GhostMoveLogEntry[]>([]);
```

- [ ] **Step 8: Remove `isLeagueMatch` declaration**

Read around line 1092. Delete this line:

```ts
  const isLeagueMatch = Boolean(onMatchComplete && resumeKey);
```

- [ ] **Step 9: Simplify `isStandaloneFritzMatch` — remove the `!onMatchComplete` condition**

Read around line 1093–1096. Current:

```ts
  const isStandaloneFritzMatch = Boolean(
    userId && !isGhostMode && !isDailyPuzzleRun && !isDailyFritzMode && !onMatchComplete
    && !isGuidedMode && !isAuthoringMode && !isAuthoringV2Mode && !isGuidedV2Mode
  );
```

Replace with:

```ts
  const isStandaloneFritzMatch = Boolean(
    userId && !isGhostMode && !isDailyPuzzleRun && !isDailyFritzMode
    && !isGuidedMode && !isAuthoringMode && !isAuthoringV2Mode && !isGuidedV2Mode
  );
```

- [ ] **Step 10: Delete `clearPersistedLeagueMatch` callback**

Read around lines 1175–1179. Delete:

```ts
  const clearPersistedLeagueMatch = useCallback(() => {
    if (!leagueResumeStorageKey || typeof window === 'undefined') return;
    window.sessionStorage.removeItem(leagueResumeStorageKey);
    window.sessionStorage.removeItem(LEAGUE_MATCH_META_KEY);
  }, [leagueResumeStorageKey]);

```

(Include trailing blank line so no double blank is left.)

- [ ] **Step 11: Remove `clearPersistedLeagueMatch()` call from `startFreshMatch`**

Read around line 2217. In the `startFreshMatch` function, delete:

```ts
    clearPersistedLeagueMatch();
```

- [ ] **Step 12: Delete the league session-storage persistence effect**

Read around lines 2266–2309. Delete the entire `useEffect` block:

```ts
  useEffect(() => {
    if (!isLeagueMatch || !leagueResumeStorageKey || typeof window === 'undefined') return;
    if (match.gameOver) {
      clearPersistedLeagueMatch();
      return;
    }
    const payload = {
      resumeKey,
      mode,
      opponentName,
      winningScore,
      dealSize,
      match,
      movesUsed,
      moveLog,
      ghostMoveLog,
      ghostProfile,
      matchStartGlickoRating,
    };
    window.sessionStorage.setItem(leagueResumeStorageKey, JSON.stringify(payload));
    window.sessionStorage.setItem(
      LEAGUE_MATCH_META_KEY,
      JSON.stringify({
        resumeKey,
        mode,
        ghostProfile,
      }),
    );
  }, [
    clearPersistedLeagueMatch,
    dealSize,
    ghostMoveLog,
    ghostProfile,
    isLeagueMatch,
    leagueResumeStorageKey,
    match,
    matchStartGlickoRating,
    mode,
    moveLog,
    movesUsed,
    opponentName,
    resumeKey,
    winningScore,
  ]);
```

- [ ] **Step 13: Simplify ghost match start effect — remove `isLeagueMatch` guard**

Read around lines 2432–2459. Current effect condition:

```ts
    if (!userId || !isGhostMode || isDailyPuzzleRun || isLeagueMatch) return;
```

Replace with:

```ts
    if (!userId || !isGhostMode || isDailyPuzzleRun) return;
```

Also remove `isLeagueMatch,` from this effect's dependency array.

- [ ] **Step 14: Delete the `onMatchComplete` effect**

Read around lines 2501–2515. Delete the entire effect:

```ts
  useEffect(() => {
    if (!onMatchComplete) return;
    if (!match.gameOver) {
      matchCompleteKeyRef.current = '';
      return;
    }
    const key = `${match.handNumber}:${match.winnerId}:${match.players.you.score}:${match.players.bot.score}`;
    if (matchCompleteKeyRef.current === key) return;
    matchCompleteKeyRef.current = key;
    onMatchComplete({
      winner: match.winnerId,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
    });
  }, [match.gameOver, match.handNumber, match.winnerId, match.players.you.score, match.players.bot.score, onMatchComplete]);
```

- [ ] **Step 15: Delete `matchCompleteKeyRef` declaration**

Read `client/src/bot/BotMatchScreen.tsx` line 970. This ref is only used inside the effect deleted in Step 14. Delete:

```ts
  const matchCompleteKeyRef = useRef('');
```

- [ ] **Step 16: Remove `matchCompleteKeyRef.current = '';` from `startFreshMatch`**

Read around line 2241. In the `startFreshMatch` function body, delete:

```ts
    matchCompleteKeyRef.current = '';
```

- [ ] **Step 17: Remove `clearPersistedLeagueMatch()` from the LeaveGameModal onLeave handler**

Read around line 6964 (search for the `LeaveGameModal` `onLeave` callback — line numbers shift after prior edits). Delete:

```ts
            clearPersistedLeagueMatch();
```

- [ ] **Step 18: Verify no league references remain in BotMatchScreen**

```bash
grep -n "league\|League\|LEAGUE\|resumeKey\|onMatchComplete\|clearPersistedLeague\|isLeagueMatch\|leagueResumeStorageKey\|LEAGUE_MATCH_META\|matchCompleteKeyRef" /Users/olivermorid/racehorse-dominoes/client/src/bot/BotMatchScreen.tsx
```

Expected: no output.

- [ ] **Step 19: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/bot/BotMatchScreen.tsx
git commit -m "chore: remove league persistence props and session-storage logic from BotMatchScreen"
```

---

### Task 4: Delete the `client/src/league/` directory

**Files:**
- Delete: `client/src/league/LeagueScreen.tsx`
- Delete: `client/src/league/LeagueHistoryScreen.tsx`
- Delete: `client/src/league/api.ts`
- Delete: `client/src/league/types.ts`
- Delete: `client/src/league/league.css`

**Context:** After Tasks 1–3 removed all callers and imports, the `league/` directory is completely unreferenced. Delete the whole directory.

- [ ] **Step 1: Confirm the directory contents**

```bash
ls /Users/olivermorid/racehorse-dominoes/client/src/league/
```

Expected output lists all five files: `LeagueScreen.tsx`, `LeagueHistoryScreen.tsx`, `api.ts`, `types.ts`, `league.css`.

- [ ] **Step 2: Delete the directory**

```bash
rm -rf /Users/olivermorid/racehorse-dominoes/client/src/league/
```

- [ ] **Step 3: Verify it's gone**

```bash
ls /Users/olivermorid/racehorse-dominoes/client/src/league/ 2>&1
```

Expected: `ls: ... No such file or directory`

- [ ] **Step 4: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add -A client/src/league/
git commit -m "chore: delete client/src/league/ directory — feature removed"
```

---

### Task 5: TypeScript verification and final grep

**Files:** Read-only verification pass, no edits.

- [ ] **Step 1: TypeScript check**

```bash
cd /Users/olivermorid/racehorse-dominoes/client && npx tsc --noEmit 2>&1
```

Expected: no output (zero errors).

If there ARE errors, read each one carefully. Every remaining reference to league must be found and deleted. Common missed spots: another file that imports from `./league/` or `../league/`, or a string literal `'league'` used as an AppMode in a `setAppMode()` call somewhere.

- [ ] **Step 2: Full-codebase grep for league remnants**

```bash
grep -rn "league\|League\|LEAGUE" \
  /Users/olivermorid/racehorse-dominoes/client/src \
  --include="*.ts" --include="*.tsx" --include="*.css" \
  | grep -v "node_modules"
```

Expected: no output.

- [ ] **Step 3: Git log confirms clean commits**

```bash
cd /Users/olivermorid/racehorse-dominoes && git log --oneline -6
```

Expected: shows the four league-cleanup commits at the top.
