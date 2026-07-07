import { playBlockedSound, playHandLoseSound, playHandWinSound } from '../utils/sound';
import type { GameRematchStatusPayload } from './legacyTournamentTypes';
import type { MultiplayerConnectionScope } from './multiplayerConnectionScope';
import type { ConnectionHandEndedPayload } from './gameplaySocketTypes';

/** Gameplay-layer handler for `hand:ended` — sound, reveal timer, UI staging. */
export function applyHandEndedSocketEvent(
  scope: MultiplayerConnectionScope,
  payload: ConnectionHandEndedPayload,
  getScope: () => MultiplayerConnectionScope,
): void {
  const currentState = scope.room.stateRef.current;
  const myId = scope.room.youRef.current;
  const myRemaining = currentState?.players[myId]?.hand ?? [];
  const yourRemainingTiles = payload.yourRemainingTiles ?? myRemaining;
  const opponentRemainingTiles = payload.opponentRemainingTiles ?? [];
  const blocked = yourRemainingTiles.length > 0 && opponentRemainingTiles.length > 0;
  if (blocked) playBlockedSound(scope.gameplay.isMutedRef.current);
  const stateNow = scope.room.stateRef.current;
  const target = stateNow?.config?.winningScore ?? 60;
  const oppId = stateNow?.playerIds.find((pid) => pid !== myId) ?? null;
  const myAward = payload.pointsAwarded?.you ?? 0;
  const oppAward = payload.pointsAwarded?.opponent ?? 0;
  const myPostScore = (stateNow?.players?.[myId]?.score ?? 0) + myAward;
  const oppPostScore = oppId ? (stateNow?.players?.[oppId]?.score ?? 0) + oppAward : oppAward;
  const matchWillBeOver = myPostScore >= target || oppPostScore >= target;
  if (!matchWillBeOver) {
    const handWinnerId = payload.handWinnerId ?? payload.winnerId ?? null;
    const iWonHand = Boolean(handWinnerId && handWinnerId === myId);
    if (iWonHand) playHandWinSound(scope.gameplay.isMutedRef.current);
    else playHandLoseSound(scope.gameplay.isMutedRef.current);
  }
  scope.gameplay.handRevealShownRef.current = payload.handNumber;
  scope.gameplay.handRevealTimerRef.current = window.setTimeout(() => {
    scope.gameplay.handRevealTimerRef.current = null;
    getScope().ui.setHandReveal({ ...payload, yourRemainingTiles });
  }, 1400);
}

let lastOpponentRematchReady = false;

export function applyGameRematchStatusSocketEvent(
  scope: MultiplayerConnectionScope,
  payload: GameRematchStatusPayload,
): void {
  const readyPlayerIds = Array.isArray(payload?.readyPlayerIds)
    ? payload.readyPlayerIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
  scope.ui.setRematchReadyIds(readyPlayerIds);
  const you = scope.room.youRef.current;
  scope.ui.setRematchRequested(readyPlayerIds.includes(you));

  const opponentReady = readyPlayerIds.some((id) => id !== you);
  if (opponentReady && !lastOpponentRematchReady) {
    scope.config.showToast('Opponent requested a rematch.', 2500);
  }
  lastOpponentRematchReady = opponentReady;
}

export function applyGameRematchStartedSocketEvent(scope: MultiplayerConnectionScope): void {
  if (scope.gameplay.handRevealTimerRef.current !== null) {
    clearTimeout(scope.gameplay.handRevealTimerRef.current);
    scope.gameplay.handRevealTimerRef.current = null;
  }
  scope.ui.setHandReveal(null);
  scope.gameplay.handRevealShownRef.current = null;
  scope.session.dispatchSession({ type: 'GAME_REMATCH_STARTED' });
  scope.recovery.rematchAwaitingStateRef.current = true;
  scope.ui.setRematchRequested(false);
  scope.ui.setRematchReadyIds([]);
  lastOpponentRematchReady = false;
  scope.config.showToast('Rematch started.', 1200);
}

export function applyPlayerDraggingSocketEvent(
  scope: MultiplayerConnectionScope,
  payload: { playerId?: string; dragging?: boolean },
): void {
  if (!payload?.playerId || payload.playerId === scope.room.youRef.current) return;
  scope.ui.setOpponentDragging(Boolean(payload.dragging));
}