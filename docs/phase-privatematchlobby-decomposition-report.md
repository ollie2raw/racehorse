# Phase: Private Match Lobby Screen Decomposition

Decompose `client/src/multiplayer/PrivateMatchLobbyScreen.tsx` (1,203 LOC) into a controller-shaped entry file plus supporting modules, following Daily Puzzle / Daily Fritz decomposition patterns.

---

## Step 0 — Scope check

### 0.1 Recovery UI boundary

**Finding: PrivateMatchLobbyScreen only consumes recovery state from its parent. It does not import or run `recoveryMachine.ts`, `socketEventBus.ts`, or projection-gate logic from `useRoomSocketSync.ts`.**

Recovery-related props (passed from `MultiplayerModeController.tsx`):

| Prop | Role in lobby screen |
|------|----------------------|
| `roomRecoveryState` | Read-only display (`'idle' \| 'reconnecting' \| 'resyncing' \| 'failed'`) |
| `roomRecoveryMessage` | Read-only subtitle text |
| `onRetryRoomRecovery` | Click handler on retry CTA only |

**BEFORE** recovery UI (git `HEAD`, `PrivateMatchLobbyScreen.tsx`, lines 1112–1133):

```tsx
                  {roomRecoveryState !== 'idle' ? (
                    <div className="pml-muted-card">
                      <div className="pml-player-card__title">
                        {roomRecoveryState === 'reconnecting'
                          ? 'Reconnecting…'
                          : roomRecoveryState === 'resyncing'
                            ? 'Syncing room…'
                            : 'Reconnect failed'}
                      </div>
                      <div className="pml-player-card__meta" style={{ marginTop: 6 }}>
                        {roomRecoveryMessage || 'Restoring your room session.'}
                      </div>
                    </div>
                  ) : null}
                  {roomRecoveryState === 'failed' ? (
                    <ClaudePrimaryAction
                      accent={MP_BLUE}
                      title="Retry reconnect"
                      meta="Restore this room session"
                      onClick={onRetryRoomRecovery}
                    />
                  ) : null}
```

**AFTER:** Identical JSX moved to `PrivateMatchLobbyControlPanel.tsx` (room phase section). No reconnect/resync/replay decision logic was found inline in the lobby screen before or after decomposition.

**No frozen files touched.** Recovery orchestration remains in parent connection layer (`MultiplayerModeController` / `useMultiplayerConnection`).

### 0.2 Socket events — direct subscriptions vs emits

**Finding: The lobby screen has zero `socket.on` / `socket.off` subscriptions. It does not use `useRoomSocketSync` or `socketEventBus`.**

| Socket interaction | Event | Direction | When fired | Setup / teardown |
|--------------------|-------|-----------|------------|------------------|
| Friend picker open | `presence:online` | **emit** (with ack callback) | When `showFriendPicker && isRatedEligible`, after `fetchFriendsWithPresence()` resolves | Inside `useEffect` in friends hook; no listener registration; effect deps `[showFriendPicker, isRatedEligible]` with `socket` intentionally excluded (eslint-disable) |
| Top bar live counts | (internal to `MultiplayerTopBar`) | pass-through | `socket` prop passed unchanged to `MultiplayerTopBar` | Not owned by lobby screen |

**Chat:** `roomChatFeed` and `onSendRoomChat` are destructured as `_roomChatFeed` / `_onSendRoomChat` — **unused** in this screen before and after decomposition.

### 0.3 Call sites and public contract

| Call site | Import |
|-----------|--------|
| `client/src/multiplayer/MultiplayerModeController.tsx` | `React.lazy(() => import('./PrivateMatchLobbyScreen'))` |

**Exported types:** `PrivateMatchLobbyScreenProps` re-exported from `PrivateMatchLobbyScreen.tsx` via `privateMatchLobbyScreenTypes.ts` (same interface, same field names and optionality).

**Full prop list (37 props on `PrivateMatchLobbyScreenProps`):**

1. `phase`
2. `onNavigate?`
3. `onOpenAuth?`
4. `onOpenAccount?`
5. `onBackHome`
6. `isConnecting`
7. `serverWaking`
8. `serverUrl`
9. `onConnect`
10. `roomCode`
11. `onRoomCodeChange`
12. `onCreateRoom`
13. `onJoinRoom`
14. `pendingLobbyAction`
15. `joinedRoom`
16. `players`
17. `you`
18. `isRoomHost`
19. `onLeaveRoom`
20. `onStartGame`
21. `pendingStart`
22. `onCopyInviteLink`
23. `onCopyRoomCode?`
24. `roomRecoveryState`
25. `roomRecoveryMessage`
26. `onRetryRoomRecovery`
27. `myRating?`
28. `myUsername?`
29. `hostWinStreak?`
30. `roomChatFeed?`
31. `onSendRoomChat?`
32. `winTarget?`
33. `isRatedEligible?`
34. `onOpenQuickMatch?`
35. `socket?`
36. `pendingChallenge?`
37. `lobbyError?`
38. `sendFriendChallenge?`

(38 named fields including optional markers.)

**Post-decomposition diff:** None. Same default export, same props interface, same call site in `MultiplayerModeController.tsx`. `App.tsx` not modified.

### 0.4 Prop categorization

| Category | Props | Extracted destination |
|----------|-------|----------------------|
| **(a) Pass-through to child unchanged** | `socket` → `MultiplayerTopBar`; `onNavigate`, `onOpenAuth`, `onOpenAccount` → `GlobalNav`; most action callbacks → `PrivateMatchLobbyControlPanel` | Controller wires props to views |
| **(b) Read only, not mutated locally** | `phase`, `players`, `you`, `isRoomHost`, `joinedRoom`, `pendingLobbyAction`, `pendingStart`, `myRating`, `myUsername`, `hostWinStreak`, `winTarget`, `isRatedEligible`, `pendingChallenge`, `lobbyError`, `roomRecoveryState`, `roomRecoveryMessage`, `isConnecting`, `serverWaking`, `roomCode` | View-model builders + panel/matchup views |
| **(c) Unused (read ignored)** | `serverUrl` (`_serverUrl`), `roomChatFeed`, `onSendRoomChat` | Controller destructuring only |
| **(d) Drive effects with cleanup** | `socket` (friends `presence:online` emit effect), `players[1]` (guest profile fetch effect), `pendingChallenge` + guest presence ( `useSyncNow` tick) | `usePrivateMatchLobbyFriends`, `usePrivateMatchLobbyGuestProfile`, `useSyncNow` in controller |
| **Local UI state (not props)** | `lobbyTab`, `dealFormat`, `privacy`, `timedTurnsUi`, `copiedInvite`, `showFriendPicker`, `creatingUserId`, friends list state | `usePrivateMatchLobbyUiState`, `usePrivateMatchLobbyFriends` inside `PrivateMatchLobbyControlPanel` |

---

## 1. Responsibility inventory (pre-decomposition)

| Concern | Approx LOC | Description |
|---------|------------|-------------|
| Icon components | 92–231 | Inline SVG icons |
| Local lobby UI state | 273–287 | Tab, format, privacy, timed turns, copy invite |
| Friends + presence emit | 290–335 | Fetch friends, `socket.emit('presence:online')` |
| Friend challenges | 337–367 | `handleSendChallenge`, `getChallengeState` |
| Duel matchup view-model | 369–400 | Host/guest names, ratings, pending invite tick |
| Guest profile fetch | 402–456 | Supabase username lookup + `fetchRankingProfile` |
| Footer hints | 458–467 | Waiting messages |
| Settings / format / privacy UI | 469–618 | Tile rows and settings strip |
| Invite + friend picker UI | 628–704 | Copy link, challenge buttons |
| Shell layout + top bar | 706–736 | GlobalNav, MultiplayerTopBar |
| Duel column JSX | 753–890 | Arena rings, host/guest cards |
| Control panel JSX | 898–1196 | Disconnected/lobby/room phases, recovery display, CTAs |

---

## 2. Decomposition plan (executed)

| Module | Role |
|--------|------|
| `privateMatchLobbyScreenTypes.ts` | Props + phase/recovery types |
| `PrivateMatchLobbyIcons.tsx` | SVG icon components |
| `privateMatchLobbyViewModel.ts` | Pure duel/footer/challenge view-model helpers |
| `usePrivateMatchLobbyFriends.ts` | Friends fetch + `presence:online` emit effect |
| `usePrivateMatchLobbyGuestProfile.ts` | Guest rating/streak fetch effect |
| `usePrivateMatchLobbyUiState.ts` | Local create/join UI state + copy-invite timer |
| `PrivateMatchLobbyMatchupView.tsx` | Left duel column presentation |
| `PrivateMatchLobbyControlPanel.tsx` | Right panel (phases, recovery display, CTAs, invites) |
| `PrivateMatchLobbyScreen.tsx` | Thin controller (186 LOC) |

**No ref bridges.** Hooks return values; views receive props/callbacks.

---

## 3. Thin controller — full current source

```tsx
import { useMemo } from 'react';
import { GlobalNav } from '../components';
import { MultiplayerTopBar } from '../matchmaking/MultiplayerTopBar';
import { useSyncNow } from '../ui/useSyncNow';
import '../screens/RacehorseHomeArt.css';
import './privateMatchLobby.css';
import '../ui/claudeMode.css';
import { MultiplayerHubFeatureStrip } from './MultiplayerHubFeatureStrip';
import { MultiplayerTwoColumnPvLayout } from './MultiplayerTwoColumnPvLayout';
import type { PrivateMatchLobbyScreenProps } from './privateMatchLobbyScreenTypes';
import {
  buildPendingInviteState,
  buildPrivateLobbyDuelViewModel,
  resolveLobbyBackAction,
} from './privateMatchLobbyViewModel';
import { usePrivateMatchLobbyGuestProfile } from './usePrivateMatchLobbyGuestProfile';
import { PrivateMatchLobbyMatchupView } from './PrivateMatchLobbyMatchupView';
import { PrivateMatchLobbyControlPanel } from './PrivateMatchLobbyControlPanel';

export type { PrivateMatchLobbyScreenProps } from './privateMatchLobbyScreenTypes';

export default function PrivateMatchLobbyScreen({
  phase,
  onNavigate,
  onOpenAuth,
  onOpenAccount,
  onBackHome,
  isConnecting,
  serverWaking,
  serverUrl: _serverUrl,
  onConnect,
  roomCode,
  onRoomCodeChange,
  onCreateRoom,
  onJoinRoom,
  pendingLobbyAction,
  joinedRoom,
  players,
  you,
  isRoomHost,
  onLeaveRoom,
  onStartGame,
  pendingStart,
  onCopyInviteLink,
  onCopyRoomCode,
  roomRecoveryState,
  roomRecoveryMessage,
  onRetryRoomRecovery,
  myRating,
  myUsername = null,
  hostWinStreak,
  roomChatFeed: _roomChatFeed,
  onSendRoomChat: _onSendRoomChat,
  winTarget = 60,
  isRatedEligible = false,
  onOpenQuickMatch,
  socket = null,
  pendingChallenge = null,
  lobbyError = '',
  sendFriendChallenge,
}: PrivateMatchLobbyScreenProps) {
  const duelViewModel = useMemo(
    () =>
      buildPrivateLobbyDuelViewModel({
        phase,
        players,
        you,
        myUsername,
        myRating,
      }),
    [phase, players, you, myUsername, myRating],
  );

  const roomGuest = players[1];
  const guestProfile = usePrivateMatchLobbyGuestProfile({
    guestPresent: duelViewModel.guestPresent,
    roomGuestUserId: roomGuest?.userId,
    roomGuestUsername: roomGuest?.username,
  });

  const inviteExpiryTick = Boolean(pendingChallenge && !duelViewModel.guestPresent);
  const now = useSyncNow(1000, inviteExpiryTick);
  const { pendingInviteActive, pendingInviteName } = buildPendingInviteState(
    pendingChallenge,
    duelViewModel.guestPresent,
    now,
  );

  const onBackClick = resolveLobbyBackAction(phase, onLeaveRoom, onBackHome);

  return (
    <div className="pml-root pml-mp-bridge multiplayer-hub">
      <div className="home-bg" aria-hidden>
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <GlobalNav
        currentMode="multiplayer"
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
        activeColor="var(--tier-standard)"
      />

      <div className="mp-hub-shell mp-hub-shell--pvf">
        <MultiplayerTopBar
          activeTab="private"
          onSelectQuick={() => onOpenQuickMatch?.()}
          onSelectPrivate={() => {}}
          privateTabLocksQuick={phase === 'room'}
          onBackMultiplayer={onBackClick}
          backAriaLabel={phase === 'room' ? 'Leave room' : 'Back to home'}
          fetchCounts={phase !== 'disconnected'}
          socket={socket}
        />

        <MultiplayerTwoColumnPvLayout
          leftColClassName={`pml-left--stack${phase === 'room' ? ' pml-left--room' : ''}`}
          left={
            <>
              <div className="pvf-header">
                <div className="pvf-label">MULTIPLAYER</div>
                <h1 className="pvf-title">Private Match</h1>
                <p className="pvf-subtitle mp-hub-subtitle">
                  <span className="mp-hub-subtitle-line">
                    Invite-only 1v1 dominos. Host a room, share code or link, and your guest may join
                  </span>
                  <span className="mp-hub-subtitle-line">anytime. Start when ready.</span>
                </p>
              </div>

              <PrivateMatchLobbyMatchupView
                phase={phase}
                duelViewModel={duelViewModel}
                hostWinStreak={hostWinStreak}
                guestProfile={guestProfile}
                pendingInviteActive={pendingInviteActive}
                pendingInviteName={pendingInviteName}
                pendingChallenge={pendingChallenge}
              />

              <MultiplayerHubFeatureStrip variant="private" />
            </>
          }
          right={
            <PrivateMatchLobbyControlPanel
              phase={phase}
              isConnecting={isConnecting}
              serverWaking={serverWaking}
              onConnect={onConnect}
              roomCode={roomCode}
              onRoomCodeChange={onRoomCodeChange}
              onCreateRoom={onCreateRoom}
              onJoinRoom={onJoinRoom}
              pendingLobbyAction={pendingLobbyAction}
              joinedRoom={joinedRoom}
              players={players}
              isRoomHost={isRoomHost}
              onLeaveRoom={onLeaveRoom}
              onStartGame={onStartGame}
              pendingStart={pendingStart}
              onCopyInviteLink={onCopyInviteLink}
              onCopyRoomCode={onCopyRoomCode}
              roomRecoveryState={roomRecoveryState}
              roomRecoveryMessage={roomRecoveryMessage}
              onRetryRoomRecovery={onRetryRoomRecovery}
              winTarget={winTarget}
              isRatedEligible={isRatedEligible}
              pendingChallenge={pendingChallenge}
              pendingInviteActive={pendingInviteActive}
              pendingInviteName={pendingInviteName}
              lobbyError={lobbyError}
              socket={socket}
              sendFriendChallenge={sendFriendChallenge}
            />
          }
        />
      </div>
    </div>
  );
}
```

---

## 4. Subscription / effect lifecycle tracing

### 4.1 Friends + `presence:online` emit

**BEFORE** (git `HEAD`, lines 290–335):

```tsx
  useEffect(() => {
    if (!showFriendPicker || !isRatedEligible) return;
    setFriendsLoading(true);
    setFriendsError(null);
    fetchFriendsWithPresence()
      .then((res) => {
        if (res.error) {
          setFriendsError(res.error);
          setFriendsLoading(false);
        } else {
          if (socket && socket.connected) {
            const friendUserIds = res.friends.map((f) => f.userId);
            socket.emit(
              'presence:online',
              friendUserIds,
              (resp: { ok?: boolean; onlineUserIds?: string[] }) => {
                if (resp && resp.ok && Array.isArray(resp.onlineUserIds)) {
                  const onlineSet = new Set(resp.onlineUserIds);
                  const updatedFriends = res.friends.map((friend) => ({
                    ...friend,
                    presence_status: onlineSet.has(friend.userId)
                      ? ('online' as const)
                      : ('offline' as const),
                  }));
                  const onlineFriends = updatedFriends.filter((f) => f.presence_status === 'online');
                  setFriends(onlineFriends);
                } else {
                  const onlineFriends = res.friends.filter((f) => f.presence_status === 'online');
                  setFriends(onlineFriends);
                }
                setFriendsLoading(false);
              }
            );
          } else {
            const onlineFriends = res.friends.filter((f) => f.presence_status === 'online');
            setFriends(onlineFriends);
            setFriendsLoading(false);
          }
        }
      })
      .catch((err) => {
        setFriendsError(err instanceof Error ? err.message : 'Failed to load friends.');
        setFriendsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFriendPicker, isRatedEligible]);
```

**AFTER** (`usePrivateMatchLobbyFriends.ts`, lines 27–72):

```tsx
  useEffect(() => {
    if (!showFriendPicker || !isRatedEligible) return;
    setFriendsLoading(true);
    setFriendsError(null);
    fetchFriendsWithPresence()
      .then((res) => {
        if (res.error) {
          setFriendsError(res.error);
          setFriendsLoading(false);
        } else {
          if (socket && socket.connected) {
            const friendUserIds = res.friends.map((f) => f.userId);
            socket.emit(
              'presence:online',
              friendUserIds,
              (resp: { ok?: boolean; onlineUserIds?: string[] }) => {
                if (resp && resp.ok && Array.isArray(resp.onlineUserIds)) {
                  const onlineSet = new Set(resp.onlineUserIds);
                  const updatedFriends = res.friends.map((friend) => ({
                    ...friend,
                    presence_status: onlineSet.has(friend.userId)
                      ? ('online' as const)
                      : ('offline' as const),
                  }));
                  const onlineFriends = updatedFriends.filter((f) => f.presence_status === 'online');
                  setFriends(onlineFriends);
                } else {
                  const onlineFriends = res.friends.filter((f) => f.presence_status === 'online');
                  setFriends(onlineFriends);
                }
                setFriendsLoading(false);
              }
            );
          } else {
            const onlineFriends = res.friends.filter((f) => f.presence_status === 'online');
            setFriends(onlineFriends);
            setFriendsLoading(false);
          }
        }
      })
      .catch((err) => {
        setFriendsError(err instanceof Error ? err.message : 'Failed to load friends.');
        setFriendsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFriendPicker, isRatedEligible]);
```

**Lifecycle proof:** Same guard (`!showFriendPicker || !isRatedEligible` → early return). Same effect dependency array with same eslint-disable and same intentional `socket` omission. No `socket.on` added. Emit runs once per effect run when picker opens; no unsubscribe needed (emit-with-ack, not a listener). Hook is invoked from `PrivateMatchLobbyControlPanel` when friend picker is toggled — same component subtree as before.

### 4.2 Guest profile fetch (async effect with cancellation)

**BEFORE** (git `HEAD`, lines 402–456):

```tsx
  useEffect(() => {
    if (!guestPresent || !roomGuest) {
      void (async () => {
        await Promise.resolve();
        setGuestRankedLoading(false);
        setGuestRating(null);
        setGuestWinStreak(null);
      })();
      return;
    }

    const uname = roomGuest.username.replace(/^@+/, '').trim();
    const isPlaceholderGuest = !uname || uname.toLowerCase() === 'guest';

    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setGuestRankedLoading(true);
      setGuestRating(null);
      setGuestWinStreak(null);
      let userId: string | null = roomGuest.userId;

      if (!userId && supabase && !isPlaceholderGuest) {
        const { data, error } = await supabase.from('profiles').select('id').eq('username', uname).maybeSingle();
        if (!cancelled && !error && data?.id && typeof data.id === 'string') {
          userId = data.id;
        }
      }

      if (!userId) {
        if (!cancelled) {
          setGuestRankedLoading(false);
          setGuestRating(null);
          setGuestWinStreak(null);
        }
        return;
      }

      const { data, error } = await fetchRankingProfile(userId);
      if (cancelled) return;
      setGuestRankedLoading(false);
      if (error || !data) {
        setGuestRating(null);
        setGuestWinStreak(null);
        return;
      }
      setGuestRating(Math.round(Number(data.glicko_rating)));
      setGuestWinStreak(data.currentWinStreak);
    })();

    return () => {
      cancelled = true;
    };
  }, [guestPresent, roomGuest?.userId, roomGuest?.username]);
```

**AFTER** (`usePrivateMatchLobbyGuestProfile.ts`, lines 27–81):

```tsx
  useEffect(() => {
    if (!guestPresent || !roomGuestUsername) {
      void (async () => {
        await Promise.resolve();
        setGuestRankedLoading(false);
        setGuestRating(null);
        setGuestWinStreak(null);
      })();
      return;
    }

    const uname = normalizeLobbyUsername(roomGuestUsername);
    const isPlaceholderGuest = !uname || uname.toLowerCase() === 'guest';

    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setGuestRankedLoading(true);
      setGuestRating(null);
      setGuestWinStreak(null);
      let userId: string | null = roomGuestUserId ?? null;

      if (!userId && supabase && !isPlaceholderGuest) {
        const { data, error } = await supabase.from('profiles').select('id').eq('username', uname).maybeSingle();
        if (!cancelled && !error && data?.id && typeof data.id === 'string') {
          userId = data.id;
        }
      }

      if (!userId) {
        if (!cancelled) {
          setGuestRankedLoading(false);
          setGuestRating(null);
          setGuestWinStreak(null);
        }
        return;
      }

      const { data, error } = await fetchRankingProfile(userId);
      if (cancelled) return;
      setGuestRankedLoading(false);
      if (error || !data) {
        setGuestRating(null);
        setGuestWinStreak(null);
        return;
      }
      setGuestRating(Math.round(Number(data.glicko_rating)));
      setGuestWinStreak(data.currentWinStreak);
    })();

    return () => {
      cancelled = true;
    };
  }, [guestPresent, roomGuestUserId, roomGuestUsername]);
```

**Equivalence:** Guard condition equivalent (`!roomGuest` in BEFORE vs `!roomGuestUsername` in AFTER — controller passes `roomGuest?.username` only when `guestPresent` is true). Username normalization uses same `replace(/^@+/, '').trim()` via `normalizeLobbyUsername`. Same `cancelled` flag cleanup on unmount/deps change. Dependency array values unchanged (`roomGuest?.userId` → `roomGuestUserId`, `roomGuest?.username` → `roomGuestUsername`).

### 4.3 Pending invite expiry tick (`useSyncNow`)

**BEFORE** (lines 393–397):

```tsx
  const inviteExpiryTick = Boolean(pendingChallenge && !guestPresent);
  const now = useSyncNow(1000, inviteExpiryTick);
```

**AFTER** (controller lines 81–82):

```tsx
  const inviteExpiryTick = Boolean(pendingChallenge && !duelViewModel.guestPresent);
  const now = useSyncNow(1000, inviteExpiryTick);
```

`duelViewModel.guestPresent` is computed by the same expression as before (`inRoom && !!roomGuest?.username`). Tick interval and enable flag unchanged.

### 4.4 Copy-invite `setTimeout` (no effect cleanup)

**BEFORE** (lines 620–626):

```tsx
  const handleCopyInviteLink = () => {
    onCopyInviteLink();
    setCopiedInvite(true);
    setTimeout(() => {
      setCopiedInvite(false);
    }, 2000);
  };
```

**AFTER** (`usePrivateMatchLobbyUiState.ts`, lines 30–36):

```tsx
  const handleCopyInviteLink = useCallback((onCopyInviteLink: () => void) => {
    onCopyInviteLink();
    setCopiedInvite(true);
    setTimeout(() => {
      setCopiedInvite(false);
    }, 2000);
  }, []);
```

Same 2000ms timer behavior; no unmount cleanup in either version.

---

## 5. Sequencing / idempotency tracing

### 5.1 Friend challenge UI state

**BEFORE** (`getChallengeState`, lines 357–367):

```tsx
  const getChallengeState = (friend: FriendWithPresence) => {
    if (creatingUserId === friend.userId) return 'creating';
    if (
      pendingChallenge &&
      (pendingChallenge.friendUsername === friend.username ||
        pendingChallenge.friendUsername.replace(/^@+/, '') === friend.username.replace(/^@+/, ''))
    ) {
      return 'pending';
    }
    return 'idle';
  };
```

**AFTER** (`privateMatchLobbyViewModel.ts`, `getFriendChallengeUiState`):

```tsx
export function getFriendChallengeUiState(
  friendUsername: string,
  friendUserId: string,
  creatingUserId: string | null,
  pendingChallenge: PendingChallenge | null,
): FriendChallengeUiState {
  if (creatingUserId === friendUserId) return 'creating';
  if (
    pendingChallenge &&
    (pendingChallenge.friendUsername === friendUsername ||
      normalizeLobbyUsername(pendingChallenge.friendUsername) === normalizeLobbyUsername(friendUsername))
  ) {
    return 'pending';
  }
  return 'idle';
}
```

Same precedence: `creating` wins over `pending` over `idle`. Same username normalization semantics.

### 5.2 `handleSendChallenge` (outbound, no dedup beyond `creatingUserId`)

**BEFORE and AFTER** (in `PrivateMatchLobbyControlPanel.tsx`):

```tsx
  const handleSendChallenge = async (friend: FriendWithPresence) => {
    if (!sendFriendChallenge) return;
    setCreatingUserId(friend.userId);
    try {
      const res = await sendFriendChallenge({
        userId: friend.userId,
        username: friend.username,
        presenceStatus: friend.presence_status,
      });
      if (!res.ok) {
        const errMsg = res.error === 'unreachable' ? 'Friend is unreachable.' : 'Failed to send challenge.';
        alert(errMsg);
      }
    } catch {
      alert('An error occurred while sending the challenge.');
    } finally {
      setCreatingUserId(null);
    }
  };
```

No additional in-flight guard; `creatingUserId` disables button via `isChallengeButtonDisabled` — unchanged.

### 5.3 Pending invite active window

**BEFORE** (lines 395–400):

```tsx
  const pendingInviteActive = Boolean(
    pendingChallenge && pendingChallenge.expiresAt > now && !guestPresent,
  );
  const pendingInviteName = pendingInviteActive
    ? pendingChallenge!.friendUsername.replace(/^@+/, '')
    : null;
```

**AFTER** (`buildPendingInviteState` in `privateMatchLobbyViewModel.ts`):

```tsx
export function buildPendingInviteState(
  pendingChallenge: PendingChallenge | null,
  guestPresent: boolean,
  now: number,
): {
  pendingInviteActive: boolean;
  pendingInviteName: string | null;
} {
  const pendingInviteActive = Boolean(
    pendingChallenge && pendingChallenge.expiresAt > now && !guestPresent,
  );
  const pendingInviteName = pendingInviteActive
    ? normalizeLobbyUsername(pendingChallenge!.friendUsername)
    : null;
  return { pendingInviteActive, pendingInviteName };
}
```

Same boolean gate on `expiresAt > now` and `!guestPresent`.

---

## 6. File map and LOC

| File | LOC |
|------|-----|
| `PrivateMatchLobbyScreen.tsx` | **186** (was **1,203**) |
| `privateMatchLobbyScreenTypes.ts` | 63 |
| `PrivateMatchLobbyIcons.tsx` | 138 |
| `privateMatchLobbyViewModel.ts` | 122 |
| `usePrivateMatchLobbyFriends.ts` | 74 |
| `usePrivateMatchLobbyGuestProfile.ts` | 83 |
| `usePrivateMatchLobbyUiState.ts` | 52 |
| `PrivateMatchLobbyMatchupView.tsx` | 168 |
| `PrivateMatchLobbyControlPanel.tsx` | 695 |
| `privateMatchLobbyViewModel.test.ts` | 82 |

---

## 7. Tests added

`privateMatchLobbyViewModel.test.ts` — 7 tests:

- `normalizeLobbyUsername` strips `@`
- `getFriendChallengeUiState` creating / pending paths
- `buildPendingInviteState` guest-present inactive / expiry active
- `buildPrivateLobbyFooterHint` waiting_for_ready
- `buildPrivateLobbyDuelViewModel` lobby-phase host display

---

## 8. Verification

| Metric | Before | After |
|--------|--------|-------|
| `PrivateMatchLobbyScreen.tsx` LOC | **1,203** | **186** |
| Client test files | 63 | **64** (+1) |
| Client tests | 520 | **527** (+7) |
| Client build | PASS | **PASS** (5.55s) |

```
Test Files  64 passed (64)
Tests       527 passed (527)
✓ built in 5.55s
```

---

## 9. Frozen paths — confirmation

Not modified: `recoveryMachine.ts`, `socketEventBus.ts`, projection gates in `useRoomSocketSync.ts`, `modules/**`, `bot/**`, `match/session/**`, `dailyPuzzle/**`, `dailyFritz/**`, `App.tsx`, shellDelegates files, listed server paths.

---

## 10. Files changed summary

| File | Action |
|------|--------|
| `client/src/multiplayer/PrivateMatchLobbyScreen.tsx` | Rewritten — thin controller |
| `client/src/multiplayer/privateMatchLobbyScreenTypes.ts` | **Created** |
| `client/src/multiplayer/PrivateMatchLobbyIcons.tsx` | **Created** |
| `client/src/multiplayer/privateMatchLobbyViewModel.ts` | **Created** |
| `client/src/multiplayer/usePrivateMatchLobbyFriends.ts` | **Created** |
| `client/src/multiplayer/usePrivateMatchLobbyGuestProfile.ts` | **Created** |
| `client/src/multiplayer/usePrivateMatchLobbyUiState.ts` | **Created** |
| `client/src/multiplayer/PrivateMatchLobbyMatchupView.tsx` | **Created** |
| `client/src/multiplayer/PrivateMatchLobbyControlPanel.tsx` | **Created** |
| `client/src/multiplayer/privateMatchLobbyViewModel.test.ts` | **Created** |
| `docs/phase-privatematchlobby-decomposition-report.md` | **Created** — this report |