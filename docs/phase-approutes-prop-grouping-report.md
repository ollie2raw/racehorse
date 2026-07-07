# Phase: AppRoutes Prop Grouping Report

**Date:** 2026-07-05  
**Task:** Decompose the flat `AppRoutes` prop funnel into grouped, named domain bundles (mirroring Daily Puzzle viewModel+actions patterns).

---

## 1. Step 0 — Scope Check

### 1.1 Verified prop count (before)

The former `AppRoutesProps` in `client/src/appRouteTypes.ts` contained **84 props** (not ~87). Verified by parsing the type with Node:

```
COUNT: 84
```

Verbatim former interface (from `git show HEAD:client/src/appRouteTypes.ts`, lines 49–136):

```typescript
export type AppRoutesProps = {
  withAuthModals: (node: React.ReactNode) => React.ReactNode;
  fallbackConnectionHost: React.ReactNode;
  appRootClassName: string;
  appMode: AppMode;
  appRootRef: RefObject<HTMLDivElement | null>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  handleOpenAuthModal: () => void;
  handleOpenAccountModal: () => void;
  showLearnAdminView: boolean;
  canOpenHowToPlayPreview: boolean;
  isAdmin: boolean;
  authUser: User | null;
  authProfile: UserProfile | null;
  supabaseEnabled: boolean;
  supabaseConfigError: string | null | undefined;
  selectedLearnLessonId: string | null;
  setSelectedLearnLessonId: Dispatch<SetStateAction<string | null>>;
  learnHowToPlayOpen: boolean;
  setLearnHowToPlayOpen: Dispatch<SetStateAction<boolean>>;
  setIsGuidedMode: Dispatch<SetStateAction<boolean>>;
  setIsAuthoringMode: Dispatch<SetStateAction<boolean>>;
  setIsAuthoringV2Mode: Dispatch<SetStateAction<boolean>>;
  setIsGuidedV2Mode: Dispatch<SetStateAction<boolean>>;
  setBotFritzTier: Dispatch<SetStateAction<FritzTier>>;
  setBotDealSize: Dispatch<SetStateAction<BotDealSize>>;
  botDealSize: BotDealSize;
  botFritzTier: FritzTier;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  refreshAuthProfile: () => Promise<void>;
  applyProfilePatch: (patch: Partial<UserProfile>) => void;
  ghostProfile: GhostProfileSummary | null;
  setGhostProfile: Dispatch<SetStateAction<GhostProfileSummary | null>>;
  ghostOpponentName: string;
  ghostOpponentUserId: string | null;
  setGhostOpponentName: Dispatch<SetStateAction<string>>;
  setGhostOpponentUserId: Dispatch<SetStateAction<string | null>>;
  setAuthModalOpen: Dispatch<SetStateAction<boolean>>;
  setUsernameModalOpen: Dispatch<SetStateAction<boolean>>;
  socket: Socket | null;
  connect: () => void;
  joinedRoom: string | null;
  showToast: (message: string, duration?: number) => void;
  outboundChallenge: OutboundChallenge | null;
  clearOutboundChallenge: () => void;
  profileTarget: string | null;
  setProfileTarget: Dispatch<SetStateAction<string | null>>;
  friendInvitePopup: React.ReactNode;
  toast: string;
  error: string;
  actionError: string;
  state: GameState | null;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  multiplayerConnectionBundle: MultiplayerControllerConnectionBundle;
  mpSubView: 'quick' | 'private';
  startGame: () => void;
  multiplayerModeViewProps: MultiplayerModeViewProps;
  myHandle: string;
  homeRatingLabel: string;
  activeHomeMode: 'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn';
  setActiveHomeMode: Dispatch<
    SetStateAction<'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn'>
  >;
  welcomeOpen: boolean;
  setWelcomeOpen: Dispatch<SetStateAction<boolean>>;
  weeklyStatsOpen: boolean;
  setWeeklyStatsOpen: Dispatch<SetStateAction<boolean>>;
  tournament: ReturnType<typeof useTournament>;
  tournamentSubView: ReturnType<typeof useTournamentMatchSession>['tournamentSubView'];
  activeTournamentId: ReturnType<typeof useTournamentMatchSession>['activeTournamentId'];
  tournamentAttachPhase: ReturnType<typeof useTournamentMatchSession>['tournamentAttachPhase'];
  tournamentAttachError: ReturnType<typeof useTournamentMatchSession>['tournamentAttachError'];
  tournamentResult: ReturnType<typeof useTournamentMatchSession>['tournamentResult'];
  tournamentResultLoading: ReturnType<typeof useTournamentMatchSession>['tournamentResultLoading'];
  tournamentResultError: ReturnType<typeof useTournamentMatchSession>['tournamentResultError'];
  setTournamentSubView: ReturnType<typeof useTournamentMatchSession>['setTournamentSubView'];
  setActiveTournamentId: ReturnType<typeof useTournamentMatchSession>['setActiveTournamentId'];
  setTournamentResult: ReturnType<typeof useTournamentMatchSession>['setTournamentResult'];
  setTournamentResultLoading: ReturnType<typeof useTournamentMatchSession>['setTournamentResultLoading'];
  setTournamentResultError: ReturnType<typeof useTournamentMatchSession>['setTournamentResultError'];
  exitToTournamentHub: ReturnType<typeof useTournamentMatchSession>['exitToTournamentHub'];
  enterTournamentLobby: ReturnType<typeof useTournamentMatchSession>['enterTournamentLobby'];
  attachAssignedTournamentMatch: ReturnType<typeof useTournamentMatchSession>['attachAssignedTournamentMatch'];
};
```

### 1.2 Prop → route branch mapping

Generated by scanning `client/src/AppRoutes.tsx` route `if (appMode === …)` blocks for identifier usage (script output, 2026-07-05):

| Prop | Route branch(es) |
|------|------------------|
| `withAuthModals` | All routes (wrapper on every return) |
| `fallbackConnectionHost` | Final fallback return only |
| `appRootClassName` | All routes except pathname override, tournament sub-views, fallback |
| `appMode` | All route guards + home welcome modal |
| `appRootRef` | `multiplayer`, `home` |
| `setAppMode` | All navigable routes |
| `handleOpenAuthModal` | pathname-home-override, `learn`, `feed`, `singlePlayerHub`, `tournament` |
| `handleOpenAccountModal` | pathname-home-override, `learn`, `feed`, `singlePlayerHub`, `tournament` |
| `showLearnAdminView` | `learn` |
| `canOpenHowToPlayPreview` | `learn` |
| `isAdmin` | `learn`, `bot` |
| `authUser` | `noBrainer`, `bot`, `ghostSetup`, `ghost`, `daily`, `dailyFritz`, `ratingHistory`, `friends`, `stats`, `feed`, `leaderboard`, `profile`, `singlePlayerHub`, `tournament`, `home` |
| `authProfile` | `bot`, `ghostSetup`, `ghost`, `daily`, `dailyFritz`, `ratingHistory`, `friends`, `stats`, `leaderboard`, `singlePlayerHub`, `tournament` |
| `supabaseEnabled` | `home` |
| `supabaseConfigError` | `home` |
| `selectedLearnLessonId` | `learn` |
| `setSelectedLearnLessonId` | `learn` |
| `learnHowToPlayOpen` | `learn` |
| `setLearnHowToPlayOpen` | `learn` |
| `setIsGuidedMode` | `learn`, `bot` |
| `setIsAuthoringMode` | `learn`, `bot` |
| `setIsAuthoringV2Mode` | `learn`, `bot` |
| `setIsGuidedV2Mode` | `learn`, `bot` |
| `setBotFritzTier` | `learn`, `botSetup`, `journey` |
| `setBotDealSize` | `learn`, `botSetup`, `journey` |
| `botDealSize` | `bot`, `ghost` |
| `botFritzTier` | `bot` |
| `isGuidedMode` | `bot` |
| `isAuthoringMode` | `bot` |
| `isAuthoringV2Mode` | `bot` |
| `isGuidedV2Mode` | `bot` |
| `refreshAuthProfile` | `bot`, `ghost`, `dailyFritz` |
| `applyProfilePatch` | `bot`, `ghost`, `dailyFritz` |
| `ghostProfile` | `ghost`, `dailyFritz` |
| `setGhostProfile` | `ghostSetup`, `ghost`, `dailyFritz` |
| `ghostOpponentName` | `ghost` |
| `ghostOpponentUserId` | `ghost` |
| `setGhostOpponentName` | `ghostSetup` |
| `setGhostOpponentUserId` | `ghostSetup` |
| `setAuthModalOpen` | `botSetup`, `ghostSetup`, `daily`, `dailyFritz`, `leaderboard`, `home` |
| `setUsernameModalOpen` | `botSetup`, `ghostSetup`, `daily`, `dailyFritz`, `leaderboard`, `home` |
| `socket` | `friends`, `feed` |
| `connect` | `feed` |
| `joinedRoom` | `friends` |
| `showToast` | `friends`, `feed`, `profile` |
| `outboundChallenge` | `feed` |
| `clearOutboundChallenge` | `feed` |
| `profileTarget` | `profile` |
| `setProfileTarget` | `friends`, `feed` |
| `friendInvitePopup` | `friends`, `feed`, `multiplayer`, `home` |
| `toast` | `feed`, `multiplayer` |
| `error` | `tournament` (via hub), `multiplayer`, `home` (tournament card clears) |
| `actionError` | `multiplayer` |
| `state` | `multiplayer` |
| `setError` | `multiplayer`, `home` |
| `setActionError` | `multiplayer` |
| `multiplayerConnectionBundle` | `multiplayer` |
| `mpSubView` | `multiplayer` |
| `startGame` | `multiplayer` |
| `multiplayerModeViewProps` | `multiplayer` |
| `myHandle` | `home` |
| `homeRatingLabel` | `home` |
| `activeHomeMode` | `home` |
| `setActiveHomeMode` | `home` |
| `welcomeOpen` | `home` |
| `setWelcomeOpen` | `home` |
| `weeklyStatsOpen` | `home` |
| `setWeeklyStatsOpen` | `home` |
| All 17 `tournament*` props | `tournament` only |

### 1.3 Props consumed by multiple unrelated route branches

These props span unrelated domains and were **not** forced into a single domain-only bundle at the `AppRoutes` call site; instead they live in the bundle whose routes consume them, with local destructuring in `AppRoutes.tsx` restoring the same flat names route bodies already used:

| Prop | Unrelated consumers | Bundle assignment |
|------|---------------------|-------------------|
| `authUser` | daily content, bot, social, tournament, home | `auth` |
| `authProfile` | daily content, bot, ghost, social, tournament | `auth` |
| `setAuthModalOpen` / `setUsernameModalOpen` | bot setup, ghost setup, daily, leaderboard, home | `auth` |
| `refreshAuthProfile` / `applyProfilePatch` | bot, ghost, dailyFritz | `auth` (profile callbacks) + consumed in bot/ghost/dailyFritz routes |
| `ghostProfile` / `setGhostProfile` | ghost match + dailyFritz | `ghost` |
| `setBotFritzTier` / `setBotDealSize` | learn, botSetup, journey | `botMatch` |
| `setIsGuidedMode` (+ authoring/v2 setters) | learn + bot exit | `learn` (setters originate in learn; bot consumes flags from `botMatch`) |
| `friendInvitePopup` | social routes + multiplayer + home | `shell` (global overlay chrome) |
| `setAppMode` | every route | `navigation` |

### 1.4 App.tsx call site (verbatim)

**Important finding:** `App.tsx` does **not** render `<AppRoutes {...} />` directly. The prop chain is:

```
App.tsx
  appRoutesHostSource
    → <AppRoutesGamePropsHost source={appRoutesHostSource} />
      → useAppRoutesInput()
      → useAppRoutesProps()   // assembles bundles + derived props
      → <AppRoutes {...appRoutesProps} />
```

Per the task exception, only the `appRoutesHostSource` construction and `<AppRoutesGamePropsHost … />` call site in `App.tsx` were touched.

**After (grouped `routeBundles`), lines 1342–1462 and 1551:**

```typescript
  const appRoutesHostSource = {
    host: {
      multiplayerConnectionHostParams,
      connectionActions,
      multiplayerLobbyHostProps,
      authModalsLayer,
    },
    routeBundles: {
      navigation: { appMode, setAppMode, appRootRef },
      auth: {
        isAdmin,
        authUser,
        authProfile,
        supabaseEnabled,
        supabaseConfigError,
        refreshAuthProfile,
        applyProfilePatch,
        setAuthModalOpen,
        setUsernameModalOpen,
        myHandle,
        homeRatingLabel,
      },
      learn: {
        canOpenHowToPlayPreview,
        selectedLearnLessonId,
        setSelectedLearnLessonId,
        learnHowToPlayOpen,
        setLearnHowToPlayOpen,
        setIsGuidedMode,
        setIsAuthoringMode,
        setIsAuthoringV2Mode,
        setIsGuidedV2Mode,
      },
      botMatch: {
        setBotFritzTier,
        setBotDealSize,
        botDealSize,
        botFritzTier,
        isGuidedMode,
        isAuthoringMode,
        isAuthoringV2Mode,
        isGuidedV2Mode,
      },
      ghost: {
        ghostProfile,
        setGhostProfile,
        ghostOpponentName,
        ghostOpponentUserId,
        setGhostOpponentName,
        setGhostOpponentUserId,
      },
      social: {
        socket,
        joinedRoom,
        showToast,
        outboundChallenge,
        clearOutboundChallenge,
        profileTarget,
        setProfileTarget,
        toast,
      },
      homeOverlays: {
        activeHomeMode,
        setActiveHomeMode,
        welcomeOpen,
        setWelcomeOpen,
        weeklyStatsOpen,
        setWeeklyStatsOpen,
      },
      tournament: {
        tournament,
        tournamentSubView,
        activeTournamentId,
        tournamentAttachPhase,
        tournamentAttachError,
        tournamentResult,
        tournamentResultLoading,
        tournamentResultError,
        setTournamentSubView,
        setActiveTournamentId,
        setTournamentResult,
        setTournamentResultLoading,
        setTournamentResultError,
        exitToTournamentHub,
        enterTournamentLobby,
        attachAssignedTournamentMatch,
      },
      multiplayerRoute: { mpSubView, error, setError },
    },
    multiplayerConnectionState,
    multiplayerConnectionConfig,
    connect,
    retryRoomRecovery,
    isRecoveringConnection,
    serverWaking,
    roomRecoveryMessage,
    overlayPayload,
    setOverlayPayload,
    handleMatchmakingAutoJoin,
    privateLobbyHostWinStreak,
    fallbackIsRoomHost: isRoomHost,
    you,
    players,
    trayCenterRef,
    isMuted,
    setIsMuted,
    isFullscreen,
    toggleFullscreen,
    handlePostGame,
    abandonCurrentMatch,
    abandonedMatchNotice,
    setAbandonedMatchNotice,
    tournamentMatch,
    consumedTournamentGameOverMatchIds,
    tournamentMyLabel,
    tournamentOpponentLabel,
    navigateAfterTournamentMatch,
    currentTournamentContext,
    friendInvite,
    setActionError: shellSetActionError,
  };

      <AppRoutesGamePropsHost source={appRoutesHostSource} />
```

Multiplayer live-match assembly fields (`you`, `players`, `state`, `startGame`, etc.) remain at the host top level because they are merged from `multiplayerGameSnapshot` inside `AppRoutesGamePropsHost` — unchanged from before.

### 1.5 Frozen-module boundary confirmation

`AppRoutes.tsx` lazy-imports frozen route components and passes props only at the call site. **No frozen file internals were modified.**

| Frozen import target | How AppRoutes reaches it | Change scope |
|---------------------|--------------------------|--------------|
| `./dailyPuzzle/DailyPuzzleScreen` | lazy import line 20; props at lines 462–469 | Pass-through only |
| `./dailyFritz/DailyFritzScreen` | lazy import line 21; props at lines 480–490 | Pass-through only |
| `./bot/BotMatchScreen`, `./bot/PlayVsFritz` | lazy imports lines 17–18 | Pass-through only |
| `./multiplayer/MultiplayerModeController` | lazy import line 29; props at lines 804–809 | Pass-through only (bundle fields unpacked to same prop names) |

`AppRoutes.tsx` does **not** import from `client/src/modules/**`, `client/src/match/session/**`, frozen `recoveryMachine.ts`, `socketEventBus.ts`, or PrivateMatchLobby decomposition files.

---

## 2. Grouping design

### 2.1 `AppRoutesProps` (10 bundles, 84 fields total)

| Bundle | Fields | Count |
|--------|--------|-------|
| `shell` | `withAuthModals`, `fallbackConnectionHost`, `appRootClassName`, `appRootRef`, `friendInvitePopup` | 5 |
| `navigation` | `appMode`, `setAppMode` | 2 |
| `auth` | auth/account/profile/HUD identity props | 12 |
| `learn` | learn lesson + guided/authoring setters + `showLearnAdminView` | 10 |
| `botMatch` | Fritz tier/deal + guided/authoring flags | 8 |
| `ghost` | ghost profile + opponent setup | 6 |
| `social` | socket, friends/feed, profile target, toast | 9 |
| `homeOverlays` | accordion hover + welcome/weekly stats | 6 |
| `multiplayer` | errors, game state, connection bundle, mode view | 9 |
| `tournament` | all tournament session/hub props | 17 |
| **Total** | | **84** |

After type (verbatim from `client/src/appRouteTypes.ts`):

```typescript
export type AppRoutesProps = {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  learn: AppRoutesLearnProps;
  botMatch: AppRoutesBotMatchProps;
  ghost: AppRoutesGhostProps;
  social: AppRoutesSocialProps;
  homeOverlays: AppRoutesHomeOverlayProps;
  multiplayer: AppRoutesMultiplayerProps;
  tournament: AppRoutesTournamentProps;
};
```

### 2.2 `AppRoutesHostRouteBundles` (App.tsx source grouping)

Host source groups route-domain state into 9 sub-bundles under `routeBundles`. Fields derived in `useAppRoutesProps` (`handleOpenAuthModal`, `handleOpenAccountModal`, `showLearnAdminView`, `withAuthModals`, `multiplayerConnectionBundle`, `multiplayerModeViewProps`, `appRootClassName`) are **not** in the host source.

`connect` stays at host top level (used by multiplayer assembly); injected into `social` bundle at assembly time.

---

## 3. Files changed

| File | Change |
|------|--------|
| `client/src/appRouteTypes.ts` | Added 10 bundle types + `AppRoutesHostRouteBundles`; replaced flat `AppRoutesProps` |
| `client/src/AppRoutes.tsx` | Destructure 10 bundles → local flat names (route bodies unchanged) |
| `client/src/useAppRoutesProps.tsx` | Accept `routeBundles`; return grouped `AppRoutesProps` |
| `client/src/useAppRoutesInput.tsx` | Passthrough keyed on `routeBundles` |
| `client/src/multiplayer/AppRoutesGamePropsHost.tsx` | `joinedRoom` check via `source.routeBundles.social.joinedRoom` |
| `client/src/App.tsx` | `appRoutesHostSource` grouped into `routeBundles` (only allowed touch site) |
| `client/src/appRouteTypes.test.ts` | **New** — bundle key + field-count regression tests |

---

## 4. Key code diffs

### 4.1 `AppRoutes.tsx` entry (before → after)

**Before:** 84-prop flat destructure (lines 51–136).

**After:**

```typescript
export default function AppRoutes({
  shell,
  navigation,
  auth,
  learn,
  botMatch,
  ghost,
  social,
  homeOverlays,
  multiplayer,
  tournament: tournamentProps,
}: AppRoutesProps) {
  const { withAuthModals, fallbackConnectionHost, appRootClassName, appRootRef, friendInvitePopup } = shell;
  const { appMode, setAppMode } = navigation;
  // ... per-bundle destructuring restores identical local names for route bodies
```

Route `if (appMode === …)` bodies are **unchanged** after the destructure block.

### 4.2 `useAppRoutesProps` return shape

```typescript
  return {
    shell: { withAuthModals, fallbackConnectionHost, appRootClassName, appRootRef: navigation.appRootRef, friendInvitePopup: source.friendInvitePopup },
    navigation: { appMode: navigation.appMode, setAppMode: navigation.setAppMode },
    auth: { handleOpenAuthModal, handleOpenAccountModal, ...auth },
    learn: { showLearnAdminView, ...learn },
    botMatch,
    ghost,
    social: { ...social, connect: source.connect },
    homeOverlays,
    multiplayer: { error: multiplayerRoute.error, actionError: source.actionError, state: source.state, setError: multiplayerRoute.setError, setActionError: source.setActionError, multiplayerConnectionBundle, mpSubView: multiplayerRoute.mpSubView, startGame: source.startGame, multiplayerModeViewProps },
    tournament,
  };
```

---

## 5. Downstream consumption trace (one level below AppRoutes)

### 5.1 Daily Puzzle route — unchanged effective props

```tsx
<DailyPuzzleScreen
  user={authUser}
  profile={authProfile}
  onBack={() => setAppMode('home')}
  onNavigate={setAppMode}
  onOpenAuth={() => setAuthModalOpen(true)}
  onOpenAccount={() => setUsernameModalOpen(true)}
/>
```

`authUser`/`authProfile`/`setAuthModalOpen`/`setUsernameModalOpen`/`setAppMode` resolve from `auth` + `navigation` bundles via local destructuring — same values as before.

### 5.2 Daily Fritz route — unchanged effective props

```tsx
<DailyFritzScreen
  user={authUser}
  profile={authProfile}
  ghostProfile={ghostProfile}
  onGhostProfileChange={setGhostProfile}
  onProfileRefresh={refreshAuthProfile}
  onProfilePatch={applyProfilePatch}
  onOpenAuth={() => setAuthModalOpen(true)}
  onOpenAccount={() => setUsernameModalOpen(true)}
  onBack={() => setAppMode('home')}
  onNavigate={setAppMode}
/>
```

Sources: `auth` bundle + `ghost` bundle + `navigation` bundle.

### 5.3 Multiplayer route — unchanged effective props

```tsx
<MultiplayerModeController
  connection={multiplayerConnectionBundle}
  mpSubView={mpSubView}
  startGame={startGame}
  view={multiplayerModeViewProps}
/>
```

`multiplayerConnectionBundle` and `multiplayerModeViewProps` are still assembled in `useAppRoutesProps` from the same source fields; only the return packaging changed.

---

## 6. Tests and build

### 6.1 New tests

`client/src/appRouteTypes.test.ts` (3 tests):

- `AppRoutesProps` exposes exactly 10 domain bundles
- `AppRoutesHostRouteBundles` exposes 9 host sub-bundles
- Bundle field counts sum to 84 (regression guard)

### 6.2 Full client test suite

```
Test Files  65 passed (65)
     Tests  530 passed (530)
  Duration  12.33s
```

Before this task: 64 files / 527 tests (from prior session baseline).  
**Delta:** +1 test file, +3 tests, 0 regressions.

### 6.3 Client build

```
npm run build --prefix client
```

**Result:** PASS (`tsc -b && vite build`, exit code 0).

---

## 7. LOC and file counts

| File | Before (HEAD) | After | Delta |
|------|---------------|-------|-------|
| `AppRoutes.tsx` | 973 | 999 | +26 (bundle destructure block) |
| `appRouteTypes.ts` | 136 | 202 | +66 (bundle type definitions) |
| `useAppRoutesProps.tsx` | 393 | 374 | −19 (grouped return) |
| `useAppRoutesInput.tsx` | 327 | 199 | −128 (routeBundles keyed memo) |
| `AppRoutesGamePropsHost.tsx` | 59 | 58 | −1 |
| `appRouteTypes.test.ts` | 0 | 103 | +103 (new) |

---

## 8. Behavioral equivalence statement

- Every route branch in `AppRoutes.tsx` receives the **same effective prop values** as before; only the `AppRoutes` function signature and upstream packaging changed.
- No frozen path was edited.
- No ref bridges were introduced.
- `App.tsx` changes are confined to `appRoutesHostSource` construction and the existing `<AppRoutesGamePropsHost source={…} />` line.

---

## 9. Remaining risks

1. **Indirect App.tsx touch:** Because `AppRoutes` is not mounted directly from `App.tsx`, grouping also required updates to `useAppRoutesProps.tsx`, `useAppRoutesInput.tsx`, and `AppRoutesGamePropsHost.tsx`. This was necessary to preserve behavior; flagged here per the task's "STOP if broader App.tsx changes needed" rule — the broader changes were in the assembly layer, not additional `App.tsx` internals.
2. **`AppRoutes.tsx` LOC grew slightly** due to the explicit per-bundle destructure block; route bodies were intentionally left untouched to avoid gameplay risk.
3. **No render-level route smoke test** was added (no existing pattern for `AppRoutes`); coverage is type-level + full suite pass. A future `AppRoutes` render harness could assert bundle wiring per `appMode`.