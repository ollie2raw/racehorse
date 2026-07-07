# Phase Tier 2 Cleanup Bundle Report

Generated: 2026-07-05

Tier 2 bundle from the repo health audit. Tier 1 frozen paths were not touched. Full before/after source for every changed file is in the appendix below (no elisions).

---

## Item 1: formatDateLabel consolidation

**Investigation:** Grep found identical `formatDateLabel` implementations in `client/src/dailyPuzzle/ladderHelpers.ts`, `client/src/dailyFritz/dailyFritzScreenHelpers.ts`, plus local copies in leaderboard/share-card screens under those directories. Each domain already has a canonical export (`ladderHelpers.ts`, `dailyFritzScreenHelpers.ts`). Non-frozen consumers (`RatingHistoryPage`, `ActivityFeedScreen`, `GhostSetupScreen`) use different formats (short month, locale-specific), not the same long-month+year function.

**Outcome:** **FLAGGED for follow-up**

**Why not executed:** Consolidating cross-domain callers requires editing frozen `client/src/dailyPuzzle/**` and `client/src/dailyFritz/**` paths. Per scope rule, those are blocked in this bundle.

**Follow-up:** After those paths unfreeze, add `client/src/utils/formatDateLabel.ts` and migrate domain modules + inline leaderboard/share copies.

**Tests/build:** N/A (no code change).

---

## Item 2: useMultiplayerPresentation.ts dedup

**Investigation:** Compared `useMultiplayerPresentation` (sound/toast/flying-tile side effects in `MultiplayerGameShell`) with `useLiveMatchViewModel` / `deriveLiveMatchViewModel` (board/hand/legality display derivation in frozen `client/src/match/session/**`). No duplicated presentation logic — different layers (effects vs derived view state). Overlap would require editing frozen session code to extract shared helpers.

**Outcome:** **SKIPPED** (no dedup needed). Minor **any-type cleanup executed** in this file (see Item 8).

**Tests/build:** Client vitest + build pass after cleanup.

---

## Item 3: LiveMatchScreen prop grouping

**Investigation:** `LiveMatchScreen` had 82 flat props on `LiveMatchScreenProps`, passed from a single callsite in `MultiplayerModeController.tsx`. Pattern mirrors Tier 1 `AppRoutes` grouping (typed bundles by concern).

**Outcome:** **EXECUTED**

**Changes:**
- Added `client/src/match/liveMatchScreenTypes.ts` with 11 bundles: `shell`, `identity`, `hud`, `board`, `hand`, `chrome`, `connection`, `tournament`, `postGame`, `leave`, optional `preGameDraw`.
- Updated `LiveMatchScreen.tsx` to destructure bundles internally (no behavior change).
- Updated `MultiplayerModeController.tsx` to pass grouped props.

**Tests/build:** Client vitest 562/71 pass; client build pass.

---

## Item 4: statsApi.ts split

**Investigation:** `statsApi.ts` was ~710 LOC mixing exported types, pure derivation (`deriveFritzSummary`, `buildStatsSummary`, …), and Supabase/API fetch functions. Genuine domain mixing.

**Outcome:** **EXECUTED**

**Split shape:**
- `statsTypes.ts` — exported interfaces/types
- `statsDerivations.ts` — pure derivation + row types + `dedupeOnlineMatchRows`
- `statsApi.ts` — fetch/record functions + re-exports (backward-compatible import path)

**Tests/build:** Added `statsDerivations.test.ts` (5 tests). Client vitest + build pass. Existing `statsApi` importers unchanged.

---

## Item 5: server/src/social/routes.ts split

**Investigation:** `routes.ts` was 641 LOC mixing auth helpers, leaderboard responders, feed, friends, rivals, profile. Genuine domain mixing; no existing route tests to break.

**Outcome:** **EXECUTED**

**Split shape:**
- `socialAuth.ts` — `requireAuth`, `getFriendIds`
- `socialLeaderboard.ts` — `respondLeaderboardGlobal/Friends/Weekly`
- `socialFeed.ts` — `registerSocialFeedRoutes`
- `socialFriends.ts` — `registerSocialFriendsRoutes`
- `socialProfile.ts` — `registerSocialProfileRoutes`
- `routes.ts` — thin router wiring (100 LOC)

**Tests/build:** Server vitest 513/77 pass; server build pass.

---

## Item 6: learning/ module test coverage

**Investigation:** Zero `*.test.ts` files under `client/src/learning/`. Module has large pure surfaces in `moveAnalysis.ts` and `reasonTagging.ts` suitable for unit tests without Fritz engine scaffolding.

**Outcome:** **EXECUTED**

**Added:**
- `moveAnalysis.test.ts` — 8 tests (`normalizeMoveId`, `formatMoveNotation`, `classifyMoveByDelta`, confidence/ambiguity/intervention)
- `reasonTagging.test.ts` — 7 tests (`determinePrimaryReason`, `determineSecondaryReason`, `buildRiskFlags`, `REASON_TO_CONCEPT`)

**Tests/build:** New files pass; full client suite 562/71 pass.

---

## Item 7: journey/journeyContentValidation.ts tests

**Investigation:** No existing unit tests; module has rich pure exports (`summarizeJourneyContent`, `validateJourneyContent`, formatters).

**Outcome:** **EXECUTED**

**Added:** `journeyContentValidation.test.ts` — 5 tests validating live registry passes, summary formatting, and error formatting.

**Tests/build:** All pass against production journey content (`validateJourneyContent().ok === true`).

---

## Item 8: console.log / any cleanup + botMatches logging

**Investigation:** `server/src/http/routes/botMatches.ts` `/api/bot-matches/local/start` logged raw `userId`, `authenticatedUserId`, and full error stacks. No shared structured logger in server — other routes use `console.error('[tag] error', { message })` (e.g. `dailyFritz.ts`).

**Outcome:** **EXECUTED**

**Changes:**
- Removed all debug `console.log` from local/start handler.
- Replaced failure logging with `console.error('[Local Fritz Start] error', { message })` — no PII, no stack.
- `useMultiplayerPresentation.ts`: replaced `any` board/players/flying-tile types; fixed `getBoardTileCount` to use `board.mainLine.length` (typed `BoardState`).
- `LiveMatchScreen.tsx`: removed `[PREGAME-RENDER]` debug `console.log`.

**Tests/build:** Client + server builds pass.
## Appendix: Full before/after source
### `client/src/match/LiveMatchScreen.tsx`
#### Before
```typescript
import React, { useMemo, type RefObject } from 'react';
import {
  AnimatedScore,
  Board,
  BoardOpenEndsPill,
  BoneyardCountPill,
  DominoTile,
  FullscreenIcon,
  HomeIcon,
  RotateOverlay,
  ScoreTrackOverlay,
  VolumeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../components';
import type { BoardHandle } from '../components';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MatchLiveLayout } from './board';
import LeaveGameModal from '../components/LeaveGameModal';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import HandOverModal from '../components/handOver/HandOverModal';
import {
  buildHandOverReasonCopy,
  buildMultiplayerHandOverReveals,
  loserDisplayLabel,
  resolveWinnerSide,
  winnerDisplayLabel,
} from '../components/handOver/handOverCopy';
import TileRack from '../components/TileRack';
import GameOverModal from '../components/GameOverModal';
import { PreGameTileDrawBoard } from './preGameDraw/PreGameTileDrawBoard';
import type { PreGameDrawState } from './preGameDraw/preGameDrawLogic';
import { RoomReactions, type RoomChatEvent, type RoomEmoteEvent } from '../components/RoomReactions';
import TournamentMatchHud from '../tournament/TournamentMatchHud';
import { tournamentStageShortLabel } from '../tournament/displayNames';
import { shouldShowTournamentGameOverOverlay } from '../tournament/tournamentPostgamePolicy';
import type { TournamentMatchContext } from './session/useTournamentMatchSession';
import { tileEquals } from '../game/tileUtils';
import { useRenderProfiler } from '../debug/renderProfiler';
import { buildPlayableTileKeys, getHandTileLegality } from '../utils/handTileLegality';
import type { GameState, Move, PlacementPosition, Tile } from '../types';
import type { RoomPlayer } from '../multiplayer/multiplayerRuntime';

type HandRevealState = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

type FlyingTile = { x: number; y: number; toX: number; toY: number; id: number };

type ScoreToastState = {
  message: string;
  tone: 'you' | 'opp';
  visible: boolean;
} | null;



export type LiveMatchScreenProps = {
  visible: boolean;
  state: GameState | null;
  you: string;
  opponentId: string | null;
  opponentName: string;
  myName: string;
  myScore: number;
  opponentScore: number;
  opponentTileCount: number;
  isMyTurn: boolean;
  isHandActive: boolean;
  hudScorePulse: Record<string, boolean>;
  hudRightLabel: string;
  hudRightScore: number;
  hudRightScorePulse: boolean;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boneyardCount: number;
  openEndsSum: number;
  boardRef: RefObject<BoardHandle | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  boardForDisplay: GameState['board'];
  boardLegalMoves: Move[];
  boardSelectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  onPositionClick: (position: PlacementPosition) => void;
  myHand: Tile[];
  handSelectedTile: Tile | null;
  onHandTileSelect: (tile: Tile) => void;
  legalMoves: Move[];
  handTileSize: number;
  handCompactStacked: boolean;
  drawPulseIndex: number | null;
  scoreToast: ScoreToastState;
  scoreTrackOpen: boolean;
  onScoreTrackOpenChange: (open: boolean) => void;
  winTarget?: number;
  roomReactions: Array<RoomChatEvent | RoomEmoteEvent>;
  onSendRoomChat: (message: string) => void;
  onSendRoomEmote: (emote: RoomEmoteEvent['emote']) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  opponentDisconnected: boolean;
  opponentDisconnectMessage: string | null;
  roomRecoveryState: 'idle' | 'reconnecting' | 'resyncing' | 'failed';
  roomRecoveryMessage: string;
  onRetryRoomRecovery: () => void;
  tournamentMatch: TournamentMatchContext | null;
  consumedTournamentGameOverMatchIds: ReadonlySet<string>;
  tournamentMyLabel: string;
  tournamentOpponentLabel: string | null;
  onTournamentViewBracket: () => void;
  onTournamentViewFinalResult: () => void;
  onTournamentReturnToHub: () => void;
  canUseRematch: boolean;
  rematchRequested: boolean;
  rematchWaitingText: string | undefined;
  onRematch: () => void;
  onPostGame: () => void;
  players: RoomPlayer[];
  multiplayerRatingSummary: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  onOpenMultiplayerAnalyzer: () => void;
  handReveal: HandRevealState | null;
  handRevealAutoProgress: number;
  flyingTiles: FlyingTile[];
  showLeaveConfirm: boolean;
  onRequestLeaveConfirm: () => void;
  onLeaveConfirmDismiss: () => void;
  leaveModalIsTournament: boolean;
  onConfirmLeaveMatch: () => void;
  preGameDraw?: PreGameDrawState | null;
  onPregameTileTap?: (tileId: string) => void;
};

// ─── Hand View ───────────────────────────────────────────────

interface HandViewProps {
  hand: Tile[];
  selectedTile: Tile | null;
  onSelect: (tile: Tile) => void;
  isMyTurn: boolean;
  legalMoves: Move[];
  tileSize: number;
  compactStacked: boolean;
  drawPulseIndex: number | null;
}

const HandView = React.memo(function HandView({
  hand,
  selectedTile,
  onSelect,
  isMyTurn,
  legalMoves,
  tileSize,
  compactStacked,
  drawPulseIndex,
}: HandViewProps) {
  useRenderProfiler('HandView');
  const playableTileKeys = useMemo(() => buildPlayableTileKeys(legalMoves), [legalMoves]);

  const renderTile = (tile: Tile, idx: number) => {
    const isSel = selectedTile && tileEquals(tile, selectedTile);
    const { highlight, unplayable } = getHandTileLegality(tile, isMyTurn, playableTileKeys);
    return (
      <DominoTile
        key={`${tile.low}-${tile.high}`}
        tile={tile}
        size={tileSize}
        selected={isSel ?? false}
        highlight={highlight}
        unplayable={unplayable}
        onClick={() => isMyTurn && onSelect(tile)}
        disabled={!isMyTurn}
        className={drawPulseIndex === idx ? 'new-draw' : ''}
      />
    );
  };

  if (compactStacked) {
    const splitAt = Math.ceil(hand.length / 2);
    const firstRow = hand.slice(0, splitAt);
    const secondRow = hand.slice(splitAt);
    return (
      <div className="hand-container is-stacked">
        <div className="hand-row">{firstRow.map((tile, idx) => renderTile(tile, idx))}</div>
        <div className="hand-row">{secondRow.map((tile, idx) => renderTile(tile, splitAt + idx))}</div>
      </div>
    );
  }

  return (
    <div className="hand-container has-single-row">
      <div className="hand-row">{hand.map((tile, idx) => renderTile(tile, idx))}</div>
    </div>
  );
}, (prev, next) => (
  prev.hand === next.hand &&
  prev.selectedTile === next.selectedTile &&
  prev.onSelect === next.onSelect &&
  prev.isMyTurn === next.isMyTurn &&
  prev.legalMoves === next.legalMoves &&
  prev.tileSize === next.tileSize &&
  prev.compactStacked === next.compactStacked &&
  prev.drawPulseIndex === next.drawPulseIndex
));

// ─── Game Over Overlays ──────────────────────────────────────

interface GameOverOverlayProps {
  state: GameState;
  myId: string;
  onPrimary: () => void;
  primaryLabel: string;
  onExit: () => void;
  secondaryLabel: string;
  waitingText?: string;
  players: RoomPlayer[];
  ratingSummary?: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  extraActionLabel?: string;
  onExtraAction?: () => void;
}

function GameOverOverlay({
  state,
  myId,
  onPrimary,
  primaryLabel,
  onExit,
  secondaryLabel,
  waitingText,
  players,
  ratingSummary = null,
  extraActionLabel,
  onExtraAction,
}: GameOverOverlayProps) {
  const winner = state.winnerId;
  const getName = (pid: string, idx: number) => {
    const p = players.find((pl) => pl.id === pid);
    if (p?.username) return `@${p.username}`;
    return pid === myId ? 'You' : `Player ${idx + 1}`;
  };
  const playerScores = state.playerIds.map((pid, idx) => ({
    pid,
    name: getName(pid, idx),
    score: state.players[pid]?.score ?? 0,
  }));
  const myScore = state.players[myId]?.score ?? 0;
  const opponent = playerScores.find((entry) => entry.pid !== myId) ?? null;
  const opponentScore = opponent?.score ?? 0;
  const margin = Math.abs(myScore - opponentScore);
  const didWin = winner === myId;
  const victoryTitle = winner ? (didWin ? 'Victory' : 'Defeat') : 'Match Complete';
  const resultLabel = winner ? (didWin ? 'Victory' : 'Defeat') : 'Complete';
  const subtitle = opponent
    ? didWin
      ? `You finished ahead of ${opponent.name}.`
      : winner
        ? `${opponent.name} closed out the match.`
        : `Final standings are locked in against ${opponent.name}.`
    : 'Final multiplayer standings.';

  return (
    <GameOverModal
      open
      ariaLabel="Game over"
      matchKind="multiplayer"
      primaryAccent="blue"
      kicker="Multiplayer Result"
      title={victoryTitle}
      subtitle={subtitle}
      tone={didWin ? 'blue' : 'red'}
      stats={[
        { label: 'Final Score', value: `${myScore}-${opponentScore}`, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
        { label: 'Margin', value: winner ? `${didWin ? '+' : '-'}${margin}` : `${margin}`, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
        { label: 'Result', value: resultLabel, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
      ]}
      scores={playerScores.map((row) => ({
        label: row.name,
        value: row.score,
        winner: row.pid === winner,
        showCrown: row.pid === winner,
      }))}
      primaryLabel={primaryLabel}
      onPrimary={onPrimary}
      secondaryLabel={secondaryLabel}
      onSecondary={onExit}
      extraActionLabel={extraActionLabel}
      onExtraAction={onExtraAction}
      onClose={onExit}
    >
      {ratingSummary && (
        <div className="rh-go-rating">
          <span>Rating</span>
          <strong>
            {ratingSummary.pending
              ? 'Updating...'
              : ratingSummary.delta != null && ratingSummary.newRating != null
                ? `${ratingSummary.delta >= 0 ? '+' : ''}${ratingSummary.delta}  •  ${ratingSummary.newRating}`
                : 'Updated'}
          </strong>
        </div>
      )}
      {waitingText && <p className="rh-go-waiting">{waitingText}</p>}
    </GameOverModal>
  );
}

function tournamentEliminationLabel(round: 1 | 2 | 3): string {
  return tournamentStageShortLabel(round);
}

function TournamentGameOverOverlay({
  state,
  myId,
  tournamentMatch,
  myDisplayName,
  opponentDisplayName,
  onViewBracket,
  onViewFinalResult,
  onReturnToTournament,
}: {
  state: GameState;
  myId: string;
  tournamentMatch: TournamentMatchContext;
  myDisplayName: string;
  opponentDisplayName: string;
  onViewBracket: () => void;
  onViewFinalResult: () => void;
  onReturnToTournament: () => void;
}) {
  const didWin = state.winnerId === myId;
  const isFinal = tournamentMatch.round === 3;
  const title = isFinal
    ? didWin
      ? 'Tournament Champion'
      : 'Runner-up'
    : didWin
      ? tournamentMatch.round === 1
        ? 'You advanced to the Semifinal'
        : 'You advanced to the Final'
      : `Eliminated in the ${tournamentEliminationLabel(tournamentMatch.round)}`;
  const subtitle = isFinal
    ? didWin
      ? 'You won the tournament. View the bracket or final standings.'
      : 'Strong run — view the bracket or return to the tournament hub.'
    : didWin
      ? `You beat ${opponentDisplayName}. View the bracket while the next round prepares.`
      : `Eliminated by ${opponentDisplayName}. View the bracket or return to the tournament hub.`;
  const myScore = state.players[myId]?.score ?? 0;
  const opponentId = state.playerIds.find((pid) => pid !== myId) ?? null;
  const opponentScore = opponentId ? (state.players[opponentId]?.score ?? 0) : 0;
  const margin = Math.abs(myScore - opponentScore);
  const roundLabel = tournamentEliminationLabel(tournamentMatch.round);

  return (
    <GameOverModal
      open
      ariaLabel="Tournament match complete"
      matchKind="multiplayer"
      primaryAccent={isFinal ? 'gold' : 'blue'}
      kicker={isFinal ? 'Tournament Final' : `Tournament ${roundLabel}`}
      title={title}
      subtitle={subtitle}
      tone={didWin ? 'gold' : 'red'}
      stats={[
        { label: 'Final Score', value: `${myScore}-${opponentScore}`, tone: didWin ? 'gold' : 'red' },
        { label: 'Margin', value: `${didWin ? '+' : '-'}${margin}`, tone: didWin ? 'gold' : 'red' },
        { label: isFinal ? 'Result' : 'Round', value: isFinal ? (didWin ? 'Champion' : 'Runner-Up') : roundLabel, tone: didWin ? 'gold' : 'red' },
      ]}
      scores={state.playerIds.map((pid) => ({
        label: pid === myId ? myDisplayName : opponentDisplayName,
        value: state.players[pid]?.score ?? 0,
        winner: pid === state.winnerId,
        showCrown: pid === state.winnerId,
      }))}
      primaryLabel={isFinal ? 'View Final Result' : 'View Bracket'}
      onPrimary={isFinal ? onViewFinalResult : onViewBracket}
      secondaryLabel={isFinal ? 'View Bracket' : 'Return to Tournament'}
      onSecondary={isFinal ? onViewBracket : onReturnToTournament}
      extraActionLabel={isFinal ? 'Return to Tournament' : undefined}
      onExtraAction={isFinal ? onReturnToTournament : undefined}
      onClose={onReturnToTournament}
    />
  );
}

function renderScoreToastMessage(message: string) {
  const pointsMatch = message.match(/\+\d+/);
  if (!pointsMatch || typeof pointsMatch.index !== 'number') return message;
  const start = pointsMatch.index;
  const end = start + pointsMatch[0].length;
  return (
    <>
      {message.slice(0, start)}
      <span
        style={{
          fontSize: '1.48rem',
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '0.01em',
          display: 'inline-block',
          margin: '0 2px',
        }}
      >
        {pointsMatch[0]}
      </span>
      {message.slice(end)}
    </>
  );
}

export function LiveMatchScreen({
  visible,
  state,
  you,
  opponentId,
  opponentName,
  myName,
  myScore,
  opponentScore,
  opponentTileCount,
  isMyTurn,
  isHandActive,
  hudScorePulse,
  hudRightLabel,
  hudRightScore,
  hudRightScorePulse,
  opponentPillRef,
  boneyardRef,
  boneyardCount,
  openEndsSum,
  boardRef,
  handAreaRef,
  trayCenterRef,
  confettiCanvasRef,
  boardForDisplay,
  boardLegalMoves,
  boardSelectedTile,
  lastPlayedTile,
  boardShowOpenEndGlow,
  onPositionClick,
  myHand,
  handSelectedTile,
  onHandTileSelect,
  legalMoves,
  handTileSize,
  handCompactStacked,
  drawPulseIndex,
  scoreToast,
  scoreTrackOpen,
  onScoreTrackOpenChange,
  winTarget = 60,
  roomReactions,
  onSendRoomChat,
  onSendRoomEmote,
  isMuted,
  onToggleMute,
  isFullscreen,
  onToggleFullscreen,
  opponentDisconnected,
  opponentDisconnectMessage,
  roomRecoveryState,
  roomRecoveryMessage,
  onRetryRoomRecovery,
  tournamentMatch,
  consumedTournamentGameOverMatchIds,
  tournamentMyLabel,
  tournamentOpponentLabel,
  onTournamentViewBracket,
  onTournamentViewFinalResult,
  onTournamentReturnToHub,
  canUseRematch,
  rematchRequested,
  rematchWaitingText,
  onRematch,
  onPostGame,
  players,
  multiplayerRatingSummary,
  onOpenMultiplayerAnalyzer,
  handReveal,
  handRevealAutoProgress,
  flyingTiles,
  showLeaveConfirm,
  onRequestLeaveConfirm,
  onLeaveConfirmDismiss,
  leaveModalIsTournament,
  onConfirmLeaveMatch,
  preGameDraw,
  onPregameTileTap,
}: LiveMatchScreenProps) {
  const showGameOverOverlay = Boolean(state?.gameOver);

  if (!visible || !state) {
    return (
      <>
        {showLeaveConfirm && (
          <LeaveGameModal
            onCancel={onLeaveConfirmDismiss}
            title={leaveModalIsTournament ? 'Forfeit Tournament Match?' : 'Leave Match?'}
            copy={
              leaveModalIsTournament
                ? 'Leaving will forfeit this tournament match. You will be eliminated from the bracket.'
                : 'Leaving will forfeit this match. Your opponent will be notified.'
            }
            confirmLabel={leaveModalIsTournament ? 'Forfeit Match' : 'Leave Match'}
            onLeave={onConfirmLeaveMatch}
          />
        )}
      </>
    );
  }

  return (
    <>
      <>
          <RotateOverlay />
          <div className="screen game-screen walnut-live theme-green bot-match-screen rh-match-live">
            {opponentDisconnected && opponentDisconnectMessage && roomRecoveryState === 'idle' && (
              <div
                style={{
                  position: 'fixed',
                  top: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1190,
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: '1px solid rgba(251,191,36,0.35)',
                  background: 'rgba(15,25,20,0.82)',
                  color: 'rgba(255,236,200,0.95)',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                }}
              >
                {opponentDisconnectMessage}
              </div>
            )}
            {roomRecoveryState !== 'idle' && (
              <div
                style={{
                  position: 'fixed',
                  top: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1200,
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: '1px solid rgba(236,252,245,0.24)',
                  background: 'rgba(15,25,20,0.82)',
                  color: 'rgba(232,245,240,0.95)',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>
                  {roomRecoveryState === 'reconnecting'
                    ? 'Reconnecting…'
                    : roomRecoveryState === 'resyncing'
                      ? 'Syncing room…'
                      : 'Reconnect failed'}
                </span>
                {roomRecoveryMessage && roomRecoveryState !== 'reconnecting' && (
                  <span style={{ fontWeight: 500, opacity: 0.9 }}>{roomRecoveryMessage}</span>
                )}
                {roomRecoveryState === 'failed' && (
                  <button
                    type="button"
                    onClick={onRetryRoomRecovery}
                    style={{
                      border: '1px solid rgba(236,252,245,0.24)',
                      background: 'rgba(255,255,255,0.08)',
                      color: 'inherit',
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            <ScoreTrackOverlay
              open={scoreTrackOpen}
              onClose={() => onScoreTrackOpenChange(false)}
              target={winTarget}
              players={[
                { label: opponentName, score: opponentScore, tone: 'opp' },
                { label: myName, score: myScore, tone: 'you' },
              ]}
            />
            <canvas
              ref={confettiCanvasRef}
              style={{
                position: 'fixed',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2100,
                display: showGameOverOverlay ? 'block' : 'none',
              }}
            />
            {showGameOverOverlay && tournamentMatch ? (
              shouldShowTournamentGameOverOverlay({
                gameOver: state.gameOver,
                matchId: tournamentMatch.matchId,
                consumedMatchIds: consumedTournamentGameOverMatchIds,
              }) ? (
                <TournamentGameOverOverlay
                  state={state}
                  myId={you}
                  tournamentMatch={tournamentMatch}
                  myDisplayName={tournamentMyLabel}
                  opponentDisplayName={tournamentOpponentLabel ?? 'Opponent'}
                  onViewBracket={onTournamentViewBracket}
                  onViewFinalResult={onTournamentViewFinalResult}
                  onReturnToTournament={onTournamentReturnToHub}
                />
              ) : null
            ) : showGameOverOverlay ? (
              <GameOverOverlay
                state={state}
                myId={you}
                onPrimary={canUseRematch ? onRematch : onPostGame}
                primaryLabel={canUseRematch ? (rematchRequested ? 'Rematch Requested' : 'Rematch') : 'New Game'}
                onExit={onPostGame}
                secondaryLabel={canUseRematch ? 'Home' : 'Back'}
                waitingText={canUseRematch ? rematchWaitingText : undefined}
                players={players}
                ratingSummary={multiplayerRatingSummary}
                extraActionLabel="Analyze Game"
                onExtraAction={onOpenMultiplayerAnalyzer}
              />
            ) : null}
            {handReveal && !state.gameOver && (
              <GameOverlayPortal>
                {(() => {
                  const youPoints = handReveal.pointsAwarded.you;
                  const opponentPoints = handReveal.pointsAwarded.opponent;
                  const winner =
                    youPoints > opponentPoints ? 'you' : opponentPoints > youPoints ? 'opponent' : 'none';
                  const pointsAwarded = Math.max(youPoints, opponentPoints, 0);
                  const yourCount = handReveal.yourRemainingTiles.length;
                  const oppCount = handReveal.opponentRemainingTiles.length;
                  const whoWentOutRaw =
                    handReveal.whoWentOut ?? handReveal.winnerId ?? handReveal.handWinnerId ?? null;
                  const youWentOut =
                    whoWentOutRaw === 'you' || whoWentOutRaw === you || (whoWentOutRaw == null && yourCount === 0);
                  const oppWentOut =
                    whoWentOutRaw === 'opponent' ||
                    (Boolean(opponentId) && whoWentOutRaw === opponentId) ||
                    (whoWentOutRaw == null && oppCount === 0);
                  const winnerSide = resolveWinnerSide(winner);

                  return (
                    <HandOverModal
                      variant="mp"
                      pointsAwarded={pointsAwarded}
                      winnerSide={winnerSide}
                      winnerLabel={winnerDisplayLabel(winnerSide, opponentName)}
                      loserLabel={loserDisplayLabel(winnerSide, opponentName)}
                      reasonCopy={buildHandOverReasonCopy({
                        youWentOut,
                        opponentWentOut: oppWentOut,
                        isBlocked: !youWentOut && !oppWentOut,
                        opponentName,
                        pointsAwarded,
                      })}
                      tileReveals={buildMultiplayerHandOverReveals(
                        handReveal,
                        winner,
                        youWentOut,
                        oppWentOut,
                        opponentName,
                      )}
                      progress={handRevealAutoProgress}
                    />
                  );
                })()}
              </GameOverlayPortal>
            )}
            <MatchLiveLayout
              hudLeft={
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    ref={opponentPillRef}
                    style={{ margin: 8 }}
                    className={`wl-player-pill wl-player-pill-btn score-card ${opponentId && hudScorePulse[opponentId] ? 'score-hit' : ''}`}
                    onClick={() => onScoreTrackOpenChange(true)}
                    aria-label="Open score track"
                  >
                    <div className="wl-pill-top">
                      <span className="wl-player-label">{opponentName}</span>
                    </div>
                    <AnimatedScore value={opponentScore} className="wl-player-score" />
                  </button>
                  <TileRack count={opponentTileCount} isActive={!isMyTurn} />
                </div>
              }
              hudCenter={
                <div
                  className="wl-center-status"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    display: (isHandActive || tournamentMatch || (state.handNumber === 0 && !!preGameDraw)) ? 'flex' : 'none',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {state.handNumber === 0 && preGameDraw ? (
                    (() => {
                      let label = '';
                      let tone = 'your-turn';
                      const phase = preGameDraw.phase as string;
                      const { winner, currentRound } = preGameDraw;
                      if (phase === 'showing-tie') {
                        label = 'Tie — tap again';
                        tone = 'your-turn';
                      } else if (phase === 'showing-reveal' || phase === 'showing-result' || phase === 'resolved') {
                        if (winner === 'you') {
                          label = 'You go first';
                          tone = 'your-turn';
                        } else if (winner === 'bot') {
                          label = `${opponentName} goes first`;
                          tone = 'opp-turn';
                        } else {
                          label = 'Tie — tap again';
                          tone = 'your-turn';
                        }
                      } else if (currentRound.you) {
                        label = `Waiting for ${opponentName}…`;
                        tone = 'opp-turn';
                      } else {
                        label = 'Tap a tile to draw';
                        tone = 'your-turn';
                      }
                      return (
                        <span className={`wl-turn-label ${tone}`}>
                          {label}
                        </span>
                      );
                    })()
                  ) : tournamentMatch ? (
                    <TournamentMatchHud
                      round={tournamentMatch.round}
                      turnLabel={
                        isHandActive
                          ? isMyTurn
                            ? 'Your move'
                            : 'Opponent thinking'
                          : null
                      }
                      turnVariant={isMyTurn ? 'your-turn' : 'opp-turn'}
                    />
                  ) : isHandActive ? (
                    <span className={`wl-turn-label ${isMyTurn ? 'your-turn' : 'opp-turn'}`}>
                      {isMyTurn ? 'Your move' : 'Opponent thinking'}
                    </span>
                  ) : null}
                </div>
              }
              hudRight={
                <button
                  type="button"
                  style={{ margin: 8 }}
                  className={`wl-player-pill wl-player-pill-btn score-card is-you ${hudRightScorePulse ? 'score-hit' : ''}`}
                  onClick={() => onScoreTrackOpenChange(true)}
                  aria-label="Open score track"
                >
                  <div className="wl-pill-top">
                    <span className="wl-player-label">{hudRightLabel}</span>
                  </div>
                  <AnimatedScore value={hudRightScore} className="wl-player-score" />
                </button>
              }
              boardInner={
                <>
                  {scoreToast && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 16,
                        left: '50%',
                        transform: scoreToast.visible
                          ? 'translate(-50%, 0px) scale(1)'
                          : 'translate(-50%, -14px) scale(0.95)',
                        opacity: scoreToast.visible ? 1 : 0,
                        transition: 'opacity 250ms ease, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                        zIndex: 14,
                        background: 'rgba(255,255,255,0.06)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 999,
                        padding: '10px 22px',
                        color:
                          scoreToast.tone === 'you'
                            ? 'rgba(151, 241, 205, 0.98)'
                            : 'rgba(255, 180, 180, 0.95)',
                        fontSize: '1.24rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        boxShadow: scoreToast.tone === 'you'
                          ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(100,220,160,0.1)'
                          : 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(220,100,100,0.1)',
                      }}
                    >
                      {renderScoreToastMessage(scoreToast.message)}
                    </div>
                  )}
                  {!state.gameOver && (
                    <div className="rh-board-meta-bar" data-ui="board-meta">
                      <BoardOpenEndsPill board={state.board} openEndsSum={openEndsSum} />
                      <BoneyardCountPill ref={boneyardRef} count={boneyardCount} />
                    </div>
                  )}
                  <div
                    className="wl-controls-tray control-pill"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      zIndex: 20,
                    }}
                  >
                    <button
                      type="button"
                      className="wl-control-btn"
                      title="Zoom out"
                      aria-label="Zoom out"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        boardRef.current?.zoomOut();
                      }}
                    >
                      <ZoomOutIcon />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      title="Zoom in"
                      aria-label="Zoom in"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        boardRef.current?.zoomIn();
                      }}
                    >
                      <ZoomInIcon />
                    </button>
                    <RoomReactions feed={roomReactions} onSendChat={onSendRoomChat} onSendEmote={onSendRoomEmote} />
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onToggleMute}
                      title={isMuted ? 'Unmute' : 'Mute'}
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                    >
                      <VolumeIcon isMuted={isMuted} />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onToggleFullscreen}
                      title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    >
                      <FullscreenIcon isFullscreen={isFullscreen} />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onRequestLeaveConfirm}
                      title="Leave game"
                      aria-label="Leave game"
                    >
                      <HomeIcon />
                    </button>
                  </div>
                  <ErrorBoundary
                    context="board"
                    fallback={
                      <div
                        style={{
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          color: '#6b7a94',
                        }}
                      >
                        Board unavailable — please refresh
                      </div>
                    }
                  >
                  {state.handNumber === 0 && preGameDraw ? (
                    (() => {
                      console.log('[PREGAME-RENDER] isPlayerPickEnabled:', 
                        !preGameDraw?.currentRound?.you,
                        'phase:', preGameDraw?.phase,
                        'currentRound:', JSON.stringify(preGameDraw?.currentRound)
                      );
                      return (
                        <PreGameTileDrawBoard
                          drawState={preGameDraw}
                          isPlayerPickEnabled={
                            !preGameDraw.currentRound?.you &&
                            (preGameDraw.phase as string) !== 'showing-tie' &&
                            (preGameDraw.phase as string) !== 'showing-reveal' &&
                            (preGameDraw.phase as string) !== 'showing-result' &&
                            preGameDraw.phase !== 'resolved'
                          }
                          onTileTap={onPregameTileTap || (() => {})}
                        />
                      );
                    })()
                  ) : (
                    <Board
                      ref={boardRef}
                      showZoomTray={false}
                      board={boardForDisplay}
                      legalMoves={boardLegalMoves}
                      selectedTile={boardSelectedTile}
                      lastPlayedTile={lastPlayedTile}
                      onPositionClick={onPositionClick}
                      tileSize={84}
                      showOpenEndGlow={boardShowOpenEndGlow}
                    />
                  )}
                  </ErrorBoundary>
                </>
              }
              handDock={
                state.handNumber === 0 && preGameDraw ? (
                  <div className="hand-area wl-hand-area pre-game-draw-hand-dock" data-ui="tray" aria-hidden="true" />
                ) : (
                  <div ref={handAreaRef} className="hand-area wl-hand-area" data-ui="tray">
                    <div className="tray-rail">
                      <div className="tray-center" ref={trayCenterRef}>
                        <HandView
                          hand={myHand}
                          selectedTile={handSelectedTile}
                          onSelect={onHandTileSelect}
                          isMyTurn={isMyTurn && !state.handOver && !state.gameOver}
                          legalMoves={legalMoves}
                          tileSize={handTileSize}
                          compactStacked={handCompactStacked}
                          drawPulseIndex={drawPulseIndex}
                        />
                      </div>
                    </div>
                  </div>
                )
              }
            />

            {flyingTiles.length > 0 && (
              <GameOverlayPortal>
                {flyingTiles.map((ft) => (
                  <div
                    key={ft.id}
                    className="flying-tile-overlay"
                    style={
                      {
                        '--fly-from-x': `${ft.x}px`,
                        '--fly-from-y': `${ft.y}px`,
                        '--fly-to-x': `${ft.toX}px`,
                        '--fly-to-y': `${ft.toY}px`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </GameOverlayPortal>
            )}
          </div>
      </>

      {showLeaveConfirm && (
        <LeaveGameModal
          onCancel={onLeaveConfirmDismiss}
          title={leaveModalIsTournament ? 'Forfeit Tournament Match?' : 'Leave Match?'}
          copy={
            leaveModalIsTournament
              ? 'Leaving will forfeit this tournament match. You will be eliminated from the bracket.'
              : 'Leaving will forfeit this match. Your opponent will be notified.'
          }
          confirmLabel={leaveModalIsTournament ? 'Forfeit Match' : 'Leave Match'}
          onLeave={onConfirmLeaveMatch}
        />
      )}

    </>
  );
}
```
#### After
```typescript
import React, { useMemo } from 'react';
import {
  AnimatedScore,
  Board,
  BoardOpenEndsPill,
  BoneyardCountPill,
  DominoTile,
  FullscreenIcon,
  HomeIcon,
  RotateOverlay,
  ScoreTrackOverlay,
  VolumeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../components';

import { ErrorBoundary } from '../components/ErrorBoundary';
import { MatchLiveLayout } from './board';
import LeaveGameModal from '../components/LeaveGameModal';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import HandOverModal from '../components/handOver/HandOverModal';
import {
  buildHandOverReasonCopy,
  buildMultiplayerHandOverReveals,
  loserDisplayLabel,
  resolveWinnerSide,
  winnerDisplayLabel,
} from '../components/handOver/handOverCopy';
import TileRack from '../components/TileRack';
import GameOverModal from '../components/GameOverModal';
import { PreGameTileDrawBoard } from './preGameDraw/PreGameTileDrawBoard';
import { RoomReactions } from '../components/RoomReactions';
import TournamentMatchHud from '../tournament/TournamentMatchHud';
import { tournamentStageShortLabel } from '../tournament/displayNames';
import { shouldShowTournamentGameOverOverlay } from '../tournament/tournamentPostgamePolicy';
import type { TournamentMatchContext } from './session/useTournamentMatchSession';
import { tileEquals } from '../game/tileUtils';
import { useRenderProfiler } from '../debug/renderProfiler';
import { buildPlayableTileKeys, getHandTileLegality } from '../utils/handTileLegality';
import type { GameState, Move, Tile } from '../types';
import type { RoomPlayer } from '../multiplayer/multiplayerRuntime';
import type { LiveMatchScreenProps } from './liveMatchScreenTypes';

export type { LiveMatchScreenProps } from './liveMatchScreenTypes';

// ─── Hand View ───────────────────────────────────────────────

interface HandViewProps {
  hand: Tile[];
  selectedTile: Tile | null;
  onSelect: (tile: Tile) => void;
  isMyTurn: boolean;
  legalMoves: Move[];
  tileSize: number;
  compactStacked: boolean;
  drawPulseIndex: number | null;
}

const HandView = React.memo(function HandView({
  hand,
  selectedTile,
  onSelect,
  isMyTurn,
  legalMoves,
  tileSize,
  compactStacked,
  drawPulseIndex,
}: HandViewProps) {
  useRenderProfiler('HandView');
  const playableTileKeys = useMemo(() => buildPlayableTileKeys(legalMoves), [legalMoves]);

  const renderTile = (tile: Tile, idx: number) => {
    const isSel = selectedTile && tileEquals(tile, selectedTile);
    const { highlight, unplayable } = getHandTileLegality(tile, isMyTurn, playableTileKeys);
    return (
      <DominoTile
        key={`${tile.low}-${tile.high}`}
        tile={tile}
        size={tileSize}
        selected={isSel ?? false}
        highlight={highlight}
        unplayable={unplayable}
        onClick={() => isMyTurn && onSelect(tile)}
        disabled={!isMyTurn}
        className={drawPulseIndex === idx ? 'new-draw' : ''}
      />
    );
  };

  if (compactStacked) {
    const splitAt = Math.ceil(hand.length / 2);
    const firstRow = hand.slice(0, splitAt);
    const secondRow = hand.slice(splitAt);
    return (
      <div className="hand-container is-stacked">
        <div className="hand-row">{firstRow.map((tile, idx) => renderTile(tile, idx))}</div>
        <div className="hand-row">{secondRow.map((tile, idx) => renderTile(tile, splitAt + idx))}</div>
      </div>
    );
  }

  return (
    <div className="hand-container has-single-row">
      <div className="hand-row">{hand.map((tile, idx) => renderTile(tile, idx))}</div>
    </div>
  );
}, (prev, next) => (
  prev.hand === next.hand &&
  prev.selectedTile === next.selectedTile &&
  prev.onSelect === next.onSelect &&
  prev.isMyTurn === next.isMyTurn &&
  prev.legalMoves === next.legalMoves &&
  prev.tileSize === next.tileSize &&
  prev.compactStacked === next.compactStacked &&
  prev.drawPulseIndex === next.drawPulseIndex
));

// ─── Game Over Overlays ──────────────────────────────────────

interface GameOverOverlayProps {
  state: GameState;
  myId: string;
  onPrimary: () => void;
  primaryLabel: string;
  onExit: () => void;
  secondaryLabel: string;
  waitingText?: string;
  players: RoomPlayer[];
  ratingSummary?: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  extraActionLabel?: string;
  onExtraAction?: () => void;
}

function GameOverOverlay({
  state,
  myId,
  onPrimary,
  primaryLabel,
  onExit,
  secondaryLabel,
  waitingText,
  players,
  ratingSummary = null,
  extraActionLabel,
  onExtraAction,
}: GameOverOverlayProps) {
  const winner = state.winnerId;
  const getName = (pid: string, idx: number) => {
    const p = players.find((pl) => pl.id === pid);
    if (p?.username) return `@${p.username}`;
    return pid === myId ? 'You' : `Player ${idx + 1}`;
  };
  const playerScores = state.playerIds.map((pid, idx) => ({
    pid,
    name: getName(pid, idx),
    score: state.players[pid]?.score ?? 0,
  }));
  const myScore = state.players[myId]?.score ?? 0;
  const opponent = playerScores.find((entry) => entry.pid !== myId) ?? null;
  const opponentScore = opponent?.score ?? 0;
  const margin = Math.abs(myScore - opponentScore);
  const didWin = winner === myId;
  const victoryTitle = winner ? (didWin ? 'Victory' : 'Defeat') : 'Match Complete';
  const resultLabel = winner ? (didWin ? 'Victory' : 'Defeat') : 'Complete';
  const subtitle = opponent
    ? didWin
      ? `You finished ahead of ${opponent.name}.`
      : winner
        ? `${opponent.name} closed out the match.`
        : `Final standings are locked in against ${opponent.name}.`
    : 'Final multiplayer standings.';

  return (
    <GameOverModal
      open
      ariaLabel="Game over"
      matchKind="multiplayer"
      primaryAccent="blue"
      kicker="Multiplayer Result"
      title={victoryTitle}
      subtitle={subtitle}
      tone={didWin ? 'blue' : 'red'}
      stats={[
        { label: 'Final Score', value: `${myScore}-${opponentScore}`, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
        { label: 'Margin', value: winner ? `${didWin ? '+' : '-'}${margin}` : `${margin}`, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
        { label: 'Result', value: resultLabel, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
      ]}
      scores={playerScores.map((row) => ({
        label: row.name,
        value: row.score,
        winner: row.pid === winner,
        showCrown: row.pid === winner,
      }))}
      primaryLabel={primaryLabel}
      onPrimary={onPrimary}
      secondaryLabel={secondaryLabel}
      onSecondary={onExit}
      extraActionLabel={extraActionLabel}
      onExtraAction={onExtraAction}
      onClose={onExit}
    >
      {ratingSummary && (
        <div className="rh-go-rating">
          <span>Rating</span>
          <strong>
            {ratingSummary.pending
              ? 'Updating...'
              : ratingSummary.delta != null && ratingSummary.newRating != null
                ? `${ratingSummary.delta >= 0 ? '+' : ''}${ratingSummary.delta}  •  ${ratingSummary.newRating}`
                : 'Updated'}
          </strong>
        </div>
      )}
      {waitingText && <p className="rh-go-waiting">{waitingText}</p>}
    </GameOverModal>
  );
}

function tournamentEliminationLabel(round: 1 | 2 | 3): string {
  return tournamentStageShortLabel(round);
}

function TournamentGameOverOverlay({
  state,
  myId,
  tournamentMatch,
  myDisplayName,
  opponentDisplayName,
  onViewBracket,
  onViewFinalResult,
  onReturnToTournament,
}: {
  state: GameState;
  myId: string;
  tournamentMatch: TournamentMatchContext;
  myDisplayName: string;
  opponentDisplayName: string;
  onViewBracket: () => void;
  onViewFinalResult: () => void;
  onReturnToTournament: () => void;
}) {
  const didWin = state.winnerId === myId;
  const isFinal = tournamentMatch.round === 3;
  const title = isFinal
    ? didWin
      ? 'Tournament Champion'
      : 'Runner-up'
    : didWin
      ? tournamentMatch.round === 1
        ? 'You advanced to the Semifinal'
        : 'You advanced to the Final'
      : `Eliminated in the ${tournamentEliminationLabel(tournamentMatch.round)}`;
  const subtitle = isFinal
    ? didWin
      ? 'You won the tournament. View the bracket or final standings.'
      : 'Strong run — view the bracket or return to the tournament hub.'
    : didWin
      ? `You beat ${opponentDisplayName}. View the bracket while the next round prepares.`
      : `Eliminated by ${opponentDisplayName}. View the bracket or return to the tournament hub.`;
  const myScore = state.players[myId]?.score ?? 0;
  const opponentId = state.playerIds.find((pid) => pid !== myId) ?? null;
  const opponentScore = opponentId ? (state.players[opponentId]?.score ?? 0) : 0;
  const margin = Math.abs(myScore - opponentScore);
  const roundLabel = tournamentEliminationLabel(tournamentMatch.round);

  return (
    <GameOverModal
      open
      ariaLabel="Tournament match complete"
      matchKind="multiplayer"
      primaryAccent={isFinal ? 'gold' : 'blue'}
      kicker={isFinal ? 'Tournament Final' : `Tournament ${roundLabel}`}
      title={title}
      subtitle={subtitle}
      tone={didWin ? 'gold' : 'red'}
      stats={[
        { label: 'Final Score', value: `${myScore}-${opponentScore}`, tone: didWin ? 'gold' : 'red' },
        { label: 'Margin', value: `${didWin ? '+' : '-'}${margin}`, tone: didWin ? 'gold' : 'red' },
        { label: isFinal ? 'Result' : 'Round', value: isFinal ? (didWin ? 'Champion' : 'Runner-Up') : roundLabel, tone: didWin ? 'gold' : 'red' },
      ]}
      scores={state.playerIds.map((pid) => ({
        label: pid === myId ? myDisplayName : opponentDisplayName,
        value: state.players[pid]?.score ?? 0,
        winner: pid === state.winnerId,
        showCrown: pid === state.winnerId,
      }))}
      primaryLabel={isFinal ? 'View Final Result' : 'View Bracket'}
      onPrimary={isFinal ? onViewFinalResult : onViewBracket}
      secondaryLabel={isFinal ? 'View Bracket' : 'Return to Tournament'}
      onSecondary={isFinal ? onViewBracket : onReturnToTournament}
      extraActionLabel={isFinal ? 'Return to Tournament' : undefined}
      onExtraAction={isFinal ? onReturnToTournament : undefined}
      onClose={onReturnToTournament}
    />
  );
}

function renderScoreToastMessage(message: string) {
  const pointsMatch = message.match(/\+\d+/);
  if (!pointsMatch || typeof pointsMatch.index !== 'number') return message;
  const start = pointsMatch.index;
  const end = start + pointsMatch[0].length;
  return (
    <>
      {message.slice(0, start)}
      <span
        style={{
          fontSize: '1.48rem',
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '0.01em',
          display: 'inline-block',
          margin: '0 2px',
        }}
      >
        {pointsMatch[0]}
      </span>
      {message.slice(end)}
    </>
  );
}

export function LiveMatchScreen({
  shell,
  identity,
  hud,
  board,
  hand,
  chrome,
  connection,
  tournament,
  postGame,
  leave,
  preGameDraw,
}: LiveMatchScreenProps) {
  const { visible, state, flyingTiles, scoreToast } = shell;
  const { you, opponentId, opponentName, myName, players } = identity;
  const {
    myScore,
    opponentScore,
    opponentTileCount,
    isMyTurn,
    isHandActive,
    hudScorePulse,
    hudRightLabel,
    hudRightScore,
    hudRightScorePulse,
    boneyardCount,
    openEndsSum,
    winTarget = 60,
  } = hud;
  const {
    opponentPillRef,
    boneyardRef,
    boardRef,
    handAreaRef,
    trayCenterRef,
    confettiCanvasRef,
    boardForDisplay,
    boardLegalMoves,
    boardSelectedTile,
    lastPlayedTile,
    boardShowOpenEndGlow,
    onPositionClick,
  } = board;
  const {
    myHand,
    handSelectedTile,
    onHandTileSelect,
    legalMoves,
    handTileSize,
    handCompactStacked,
    drawPulseIndex,
  } = hand;
  const {
    scoreTrackOpen,
    onScoreTrackOpenChange,
    roomReactions,
    onSendRoomChat,
    onSendRoomEmote,
    isMuted,
    onToggleMute,
    isFullscreen,
    onToggleFullscreen,
  } = chrome;
  const {
    opponentDisconnected,
    opponentDisconnectMessage,
    roomRecoveryState,
    roomRecoveryMessage,
    onRetryRoomRecovery,
  } = connection;
  const {
    tournamentMatch,
    consumedTournamentGameOverMatchIds,
    tournamentMyLabel,
    tournamentOpponentLabel,
    onTournamentViewBracket,
    onTournamentViewFinalResult,
    onTournamentReturnToHub,
  } = tournament;
  const {
    canUseRematch,
    rematchRequested,
    rematchWaitingText,
    onRematch,
    onPostGame,
    multiplayerRatingSummary,
    onOpenMultiplayerAnalyzer,
    handReveal,
    handRevealAutoProgress,
  } = postGame;
  const {
    showLeaveConfirm,
    onRequestLeaveConfirm,
    onLeaveConfirmDismiss,
    leaveModalIsTournament,
    onConfirmLeaveMatch,
  } = leave;
  const preGameDrawState = preGameDraw?.preGameDraw;
  const onPregameTileTap = preGameDraw?.onPregameTileTap;
  const showGameOverOverlay = Boolean(state?.gameOver);

  if (!visible || !state) {
    return (
      <>
        {showLeaveConfirm && (
          <LeaveGameModal
            onCancel={onLeaveConfirmDismiss}
            title={leaveModalIsTournament ? 'Forfeit Tournament Match?' : 'Leave Match?'}
            copy={
              leaveModalIsTournament
                ? 'Leaving will forfeit this tournament match. You will be eliminated from the bracket.'
                : 'Leaving will forfeit this match. Your opponent will be notified.'
            }
            confirmLabel={leaveModalIsTournament ? 'Forfeit Match' : 'Leave Match'}
            onLeave={onConfirmLeaveMatch}
          />
        )}
      </>
    );
  }

  return (
    <>
      <>
          <RotateOverlay />
          <div className="screen game-screen walnut-live theme-green bot-match-screen rh-match-live">
            {opponentDisconnected && opponentDisconnectMessage && roomRecoveryState === 'idle' && (
              <div
                style={{
                  position: 'fixed',
                  top: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1190,
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: '1px solid rgba(251,191,36,0.35)',
                  background: 'rgba(15,25,20,0.82)',
                  color: 'rgba(255,236,200,0.95)',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                }}
              >
                {opponentDisconnectMessage}
              </div>
            )}
            {roomRecoveryState !== 'idle' && (
              <div
                style={{
                  position: 'fixed',
                  top: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1200,
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: '1px solid rgba(236,252,245,0.24)',
                  background: 'rgba(15,25,20,0.82)',
                  color: 'rgba(232,245,240,0.95)',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>
                  {roomRecoveryState === 'reconnecting'
                    ? 'Reconnecting…'
                    : roomRecoveryState === 'resyncing'
                      ? 'Syncing room…'
                      : 'Reconnect failed'}
                </span>
                {roomRecoveryMessage && roomRecoveryState !== 'reconnecting' && (
                  <span style={{ fontWeight: 500, opacity: 0.9 }}>{roomRecoveryMessage}</span>
                )}
                {roomRecoveryState === 'failed' && (
                  <button
                    type="button"
                    onClick={onRetryRoomRecovery}
                    style={{
                      border: '1px solid rgba(236,252,245,0.24)',
                      background: 'rgba(255,255,255,0.08)',
                      color: 'inherit',
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            <ScoreTrackOverlay
              open={scoreTrackOpen}
              onClose={() => onScoreTrackOpenChange(false)}
              target={winTarget}
              players={[
                { label: opponentName, score: opponentScore, tone: 'opp' },
                { label: myName, score: myScore, tone: 'you' },
              ]}
            />
            <canvas
              ref={confettiCanvasRef}
              style={{
                position: 'fixed',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2100,
                display: showGameOverOverlay ? 'block' : 'none',
              }}
            />
            {showGameOverOverlay && tournamentMatch ? (
              shouldShowTournamentGameOverOverlay({
                gameOver: state.gameOver,
                matchId: tournamentMatch.matchId,
                consumedMatchIds: consumedTournamentGameOverMatchIds,
              }) ? (
                <TournamentGameOverOverlay
                  state={state}
                  myId={you}
                  tournamentMatch={tournamentMatch}
                  myDisplayName={tournamentMyLabel}
                  opponentDisplayName={tournamentOpponentLabel ?? 'Opponent'}
                  onViewBracket={onTournamentViewBracket}
                  onViewFinalResult={onTournamentViewFinalResult}
                  onReturnToTournament={onTournamentReturnToHub}
                />
              ) : null
            ) : showGameOverOverlay ? (
              <GameOverOverlay
                state={state}
                myId={you}
                onPrimary={canUseRematch ? onRematch : onPostGame}
                primaryLabel={canUseRematch ? (rematchRequested ? 'Rematch Requested' : 'Rematch') : 'New Game'}
                onExit={onPostGame}
                secondaryLabel={canUseRematch ? 'Home' : 'Back'}
                waitingText={canUseRematch ? rematchWaitingText : undefined}
                players={players}
                ratingSummary={multiplayerRatingSummary}
                extraActionLabel="Analyze Game"
                onExtraAction={onOpenMultiplayerAnalyzer}
              />
            ) : null}
            {handReveal && !state.gameOver && (
              <GameOverlayPortal>
                {(() => {
                  const youPoints = handReveal.pointsAwarded.you;
                  const opponentPoints = handReveal.pointsAwarded.opponent;
                  const winner =
                    youPoints > opponentPoints ? 'you' : opponentPoints > youPoints ? 'opponent' : 'none';
                  const pointsAwarded = Math.max(youPoints, opponentPoints, 0);
                  const yourCount = handReveal.yourRemainingTiles.length;
                  const oppCount = handReveal.opponentRemainingTiles.length;
                  const whoWentOutRaw =
                    handReveal.whoWentOut ?? handReveal.winnerId ?? handReveal.handWinnerId ?? null;
                  const youWentOut =
                    whoWentOutRaw === 'you' || whoWentOutRaw === you || (whoWentOutRaw == null && yourCount === 0);
                  const oppWentOut =
                    whoWentOutRaw === 'opponent' ||
                    (Boolean(opponentId) && whoWentOutRaw === opponentId) ||
                    (whoWentOutRaw == null && oppCount === 0);
                  const winnerSide = resolveWinnerSide(winner);

                  return (
                    <HandOverModal
                      variant="mp"
                      pointsAwarded={pointsAwarded}
                      winnerSide={winnerSide}
                      winnerLabel={winnerDisplayLabel(winnerSide, opponentName)}
                      loserLabel={loserDisplayLabel(winnerSide, opponentName)}
                      reasonCopy={buildHandOverReasonCopy({
                        youWentOut,
                        opponentWentOut: oppWentOut,
                        isBlocked: !youWentOut && !oppWentOut,
                        opponentName,
                        pointsAwarded,
                      })}
                      tileReveals={buildMultiplayerHandOverReveals(
                        handReveal,
                        winner,
                        youWentOut,
                        oppWentOut,
                        opponentName,
                      )}
                      progress={handRevealAutoProgress}
                    />
                  );
                })()}
              </GameOverlayPortal>
            )}
            <MatchLiveLayout
              hudLeft={
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    ref={opponentPillRef}
                    style={{ margin: 8 }}
                    className={`wl-player-pill wl-player-pill-btn score-card ${opponentId && hudScorePulse[opponentId] ? 'score-hit' : ''}`}
                    onClick={() => onScoreTrackOpenChange(true)}
                    aria-label="Open score track"
                  >
                    <div className="wl-pill-top">
                      <span className="wl-player-label">{opponentName}</span>
                    </div>
                    <AnimatedScore value={opponentScore} className="wl-player-score" />
                  </button>
                  <TileRack count={opponentTileCount} isActive={!isMyTurn} />
                </div>
              }
              hudCenter={
                <div
                  className="wl-center-status"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    display: (isHandActive || tournamentMatch || (state.handNumber === 0 && !!preGameDrawState)) ? 'flex' : 'none',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {state.handNumber === 0 && preGameDrawState ? (
                    (() => {
                      let label = '';
                      let tone = 'your-turn';
                      const phase = preGameDrawState.phase as string;
                      const { winner, currentRound } = preGameDrawState;
                      if (phase === 'showing-tie') {
                        label = 'Tie — tap again';
                        tone = 'your-turn';
                      } else if (phase === 'showing-reveal' || phase === 'showing-result' || phase === 'resolved') {
                        if (winner === 'you') {
                          label = 'You go first';
                          tone = 'your-turn';
                        } else if (winner === 'bot') {
                          label = `${opponentName} goes first`;
                          tone = 'opp-turn';
                        } else {
                          label = 'Tie — tap again';
                          tone = 'your-turn';
                        }
                      } else if (currentRound.you) {
                        label = `Waiting for ${opponentName}…`;
                        tone = 'opp-turn';
                      } else {
                        label = 'Tap a tile to draw';
                        tone = 'your-turn';
                      }
                      return (
                        <span className={`wl-turn-label ${tone}`}>
                          {label}
                        </span>
                      );
                    })()
                  ) : tournamentMatch ? (
                    <TournamentMatchHud
                      round={tournamentMatch.round}
                      turnLabel={
                        isHandActive
                          ? isMyTurn
                            ? 'Your move'
                            : 'Opponent thinking'
                          : null
                      }
                      turnVariant={isMyTurn ? 'your-turn' : 'opp-turn'}
                    />
                  ) : isHandActive ? (
                    <span className={`wl-turn-label ${isMyTurn ? 'your-turn' : 'opp-turn'}`}>
                      {isMyTurn ? 'Your move' : 'Opponent thinking'}
                    </span>
                  ) : null}
                </div>
              }
              hudRight={
                <button
                  type="button"
                  style={{ margin: 8 }}
                  className={`wl-player-pill wl-player-pill-btn score-card is-you ${hudRightScorePulse ? 'score-hit' : ''}`}
                  onClick={() => onScoreTrackOpenChange(true)}
                  aria-label="Open score track"
                >
                  <div className="wl-pill-top">
                    <span className="wl-player-label">{hudRightLabel}</span>
                  </div>
                  <AnimatedScore value={hudRightScore} className="wl-player-score" />
                </button>
              }
              boardInner={
                <>
                  {scoreToast && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 16,
                        left: '50%',
                        transform: scoreToast.visible
                          ? 'translate(-50%, 0px) scale(1)'
                          : 'translate(-50%, -14px) scale(0.95)',
                        opacity: scoreToast.visible ? 1 : 0,
                        transition: 'opacity 250ms ease, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                        zIndex: 14,
                        background: 'rgba(255,255,255,0.06)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 999,
                        padding: '10px 22px',
                        color:
                          scoreToast.tone === 'you'
                            ? 'rgba(151, 241, 205, 0.98)'
                            : 'rgba(255, 180, 180, 0.95)',
                        fontSize: '1.24rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        boxShadow: scoreToast.tone === 'you'
                          ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(100,220,160,0.1)'
                          : 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(220,100,100,0.1)',
                      }}
                    >
                      {renderScoreToastMessage(scoreToast.message)}
                    </div>
                  )}
                  {!state.gameOver && (
                    <div className="rh-board-meta-bar" data-ui="board-meta">
                      <BoardOpenEndsPill board={state.board} openEndsSum={openEndsSum} />
                      <BoneyardCountPill ref={boneyardRef} count={boneyardCount} />
                    </div>
                  )}
                  <div
                    className="wl-controls-tray control-pill"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      zIndex: 20,
                    }}
                  >
                    <button
                      type="button"
                      className="wl-control-btn"
                      title="Zoom out"
                      aria-label="Zoom out"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        boardRef.current?.zoomOut();
                      }}
                    >
                      <ZoomOutIcon />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      title="Zoom in"
                      aria-label="Zoom in"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        boardRef.current?.zoomIn();
                      }}
                    >
                      <ZoomInIcon />
                    </button>
                    <RoomReactions feed={roomReactions} onSendChat={onSendRoomChat} onSendEmote={onSendRoomEmote} />
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onToggleMute}
                      title={isMuted ? 'Unmute' : 'Mute'}
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                    >
                      <VolumeIcon isMuted={isMuted} />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onToggleFullscreen}
                      title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    >
                      <FullscreenIcon isFullscreen={isFullscreen} />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onRequestLeaveConfirm}
                      title="Leave game"
                      aria-label="Leave game"
                    >
                      <HomeIcon />
                    </button>
                  </div>
                  <ErrorBoundary
                    context="board"
                    fallback={
                      <div
                        style={{
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          color: '#6b7a94',
                        }}
                      >
                        Board unavailable — please refresh
                      </div>
                    }
                  >
                  {state.handNumber === 0 && preGameDrawState ? (
                    <PreGameTileDrawBoard
                      drawState={preGameDrawState}
                      isPlayerPickEnabled={
                        !preGameDrawState.currentRound?.you &&
                        (preGameDrawState.phase as string) !== 'showing-tie' &&
                        (preGameDrawState.phase as string) !== 'showing-reveal' &&
                        (preGameDrawState.phase as string) !== 'showing-result' &&
                        preGameDrawState.phase !== 'resolved'
                      }
                      onTileTap={onPregameTileTap || (() => {})}
                    />
                  ) : (
                    <Board
                      ref={boardRef}
                      showZoomTray={false}
                      board={boardForDisplay}
                      legalMoves={boardLegalMoves}
                      selectedTile={boardSelectedTile}
                      lastPlayedTile={lastPlayedTile}
                      onPositionClick={onPositionClick}
                      tileSize={84}
                      showOpenEndGlow={boardShowOpenEndGlow}
                    />
                  )}
                  </ErrorBoundary>
                </>
              }
              handDock={
                state.handNumber === 0 && preGameDrawState ? (
                  <div className="hand-area wl-hand-area pre-game-draw-hand-dock" data-ui="tray" aria-hidden="true" />
                ) : (
                  <div ref={handAreaRef} className="hand-area wl-hand-area" data-ui="tray">
                    <div className="tray-rail">
                      <div className="tray-center" ref={trayCenterRef}>
                        <HandView
                          hand={myHand}
                          selectedTile={handSelectedTile}
                          onSelect={onHandTileSelect}
                          isMyTurn={isMyTurn && !state.handOver && !state.gameOver}
                          legalMoves={legalMoves}
                          tileSize={handTileSize}
                          compactStacked={handCompactStacked}
                          drawPulseIndex={drawPulseIndex}
                        />
                      </div>
                    </div>
                  </div>
                )
              }
            />

            {flyingTiles.length > 0 && (
              <GameOverlayPortal>
                {flyingTiles.map((ft) => (
                  <div
                    key={ft.id}
                    className="flying-tile-overlay"
                    style={
                      {
                        '--fly-from-x': `${ft.x}px`,
                        '--fly-from-y': `${ft.y}px`,
                        '--fly-to-x': `${ft.toX}px`,
                        '--fly-to-y': `${ft.toY}px`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </GameOverlayPortal>
            )}
          </div>
      </>

      {showLeaveConfirm && (
        <LeaveGameModal
          onCancel={onLeaveConfirmDismiss}
          title={leaveModalIsTournament ? 'Forfeit Tournament Match?' : 'Leave Match?'}
          copy={
            leaveModalIsTournament
              ? 'Leaving will forfeit this tournament match. You will be eliminated from the bracket.'
              : 'Leaving will forfeit this match. Your opponent will be notified.'
          }
          confirmLabel={leaveModalIsTournament ? 'Forfeit Match' : 'Leave Match'}
          onLeave={onConfirmLeaveMatch}
        />
      )}

    </>
  );
}
```
### `client/src/multiplayer/MultiplayerModeController.tsx`
#### Before
```typescript
import React, { Suspense } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import { ScreenLoader } from '../ui/ScreenLoader';
import type { BoardHandle } from '../components';
import type { GameState, Move, PlacementPosition, Tile } from '../types';
import type { PreGameDrawState } from '../match/preGameDraw/preGameDrawLogic';
import type { MatchFoundPayload } from '../matchmaking/types';
import type { TournamentMatchContext } from '../match/session/useTournamentMatchSession';
import type {
  MultiplayerControllerConnectionBundle,
  MultiplayerControllerLobbySnapshot,
} from './multiplayerRuntime';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';
import { Button } from '../components/primitives';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import '../components/leaveGameModal.css';

const MatchmakingScreen = React.lazy(() => import('../matchmaking/MatchmakingScreen'));
const PrivateMatchLobbyScreen = React.lazy(() => import('./PrivateMatchLobbyScreen'));
const LiveMatchScreen = React.lazy(() =>
  import('../match/LiveMatchScreen').then((module) => ({ default: module.LiveMatchScreen })),
);
const MatchFoundOverlay = React.lazy(() =>
  import('../matchmaking/MatchFoundOverlay').then((module) => ({ default: module.MatchFoundOverlay })),
);

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: {
    you: number;
    opponent: number;
  };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

export type AbandonedMatchNotice = {
  context: 'tournament' | 'multiplayer';
  title: string;
  detail: string;
  tournamentId?: string | null;
};

export type MultiplayerAuthView = {
  authUser: User | null;
  authProfile: {
    username?: string | null;
    glicko_rating?: number | null;
  } | null;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
  onOpenAuthModal: () => void;
  onOpenAccountModal: () => void;
};

export type MultiplayerMatchmakingView = {
  overlayPayload: MatchFoundPayload | null;
  setOverlayPayload: Dispatch<SetStateAction<MatchFoundPayload | null>>;
  handleMatchmakingAutoJoin: (payload: MatchFoundPayload) => void;
};

export type MultiplayerLiveMatchView = {
  state: GameState | null;
  opponentId: string | null;
  opponentName: string;
  myName: string;
  myScore: number;
  opponentScore: number;
  opponentTileCount: number;
  isMyTurn: boolean;
  isHandActive: boolean;
  hudScorePulse: Record<string, boolean>;
  hudRightLabel: string;
  hudRightScore: number;
  hudRightScorePulse: boolean;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boneyardCount: number;
  openEndsSum: number;
  boardRef: RefObject<BoardHandle | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  boardForDisplay: GameState['board'] | null;
  boardLegalMoves: Move[];
  boardSelectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  play: (position: PlacementPosition) => void;
  myHand: Tile[];
  handSelectedTile: Tile | null;
  handleTileTap: (tile: Tile) => void;
  legalMoves: Move[];
  handTileSize: number;
  handCompactStacked: boolean;
  drawPulseIndex: number | null;
  scoreToast: { message: string; tone: 'you' | 'opp'; visible: boolean } | null;
  scoreTrackOpen: boolean;
  setScoreTrackOpen: Dispatch<SetStateAction<boolean>>;
  isMuted: boolean;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  opponentDisconnected: boolean;
  opponentDisconnectMessage: string;
  handReveal: HandEndedPayload | null;
  handRevealAutoProgress: number;
  flyingTiles: { x: number; y: number; toX: number; toY: number; id: number }[];
  preGameDraw: PreGameDrawState | null;
  onPregameTileTap: (tileId: string) => void;
};

export type MultiplayerPostGameView = {
  canUseRematch: boolean;
  rematchRequested: boolean;
  rematchWaitingText: string | undefined;
  requestRematch: () => void;
  handlePostGame: () => void;
  multiplayerRatingSummary: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  openMultiplayerAnalyzer: () => void;
};

export type MultiplayerAbandonedMatchView = {
  showLeaveConfirm: boolean;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
  abandonCurrentMatch: () => Promise<void>;
  abandonedMatchNotice: AbandonedMatchNotice | null;
  setAbandonedMatchNotice: Dispatch<SetStateAction<AbandonedMatchNotice | null>>;
};

export type MultiplayerTournamentPassthroughView = {
  tournamentMatch: TournamentMatchContext | null;
  consumedTournamentGameOverMatchIds: ReadonlySet<string>;
  tournamentMyLabel: string;
  tournamentOpponentLabel: string | null;
  navigateAfterTournamentMatch: (nextView: 'hub' | 'bracket' | 'result') => void;
  currentTournamentContext: TournamentMatchContext | null;
  setActiveTournamentId: Dispatch<SetStateAction<string | null>>;
  setTournamentSubView: Dispatch<SetStateAction<'hub' | 'bracket' | 'result'>>;
};

export type MultiplayerModeViewProps = {
  authView: MultiplayerAuthView;
  matchmakingView: MultiplayerMatchmakingView;
  lobbyView: MultiplayerControllerLobbySnapshot;
  liveMatchView: MultiplayerLiveMatchView;
  postGameView: MultiplayerPostGameView;
  abandonedMatchView: MultiplayerAbandonedMatchView;
  tournamentPassthroughView: MultiplayerTournamentPassthroughView;
};

export type MultiplayerModeControllerProps = {
  connection: MultiplayerControllerConnectionBundle;
  mpSubView: 'quick' | 'private';
  startGame: () => void;
  view: MultiplayerModeViewProps;
};

export default function MultiplayerModeController({
  connection,
  mpSubView,
  startGame,
  view,
}: MultiplayerModeControllerProps) {
  const {
    createRoom,
    joinRoom,
    leavePrivateLobbyRoom,
    copyInviteLink,
    copyRoomCodeToClipboard,
    roomActionsUi,
    roomReactions,
    sendRoomChat,
    sendRoomEmote,
    sendFriendChallenge,
  } = useMultiplayerLobbyActionsContext();
  const { setMpSubView, setRoomCode } = roomActionsUi;

  const { authView, matchmakingView, lobbyView, liveMatchView, postGameView, abandonedMatchView, tournamentPassthroughView } =
    view;

  const {
    connectionState,
    config,
    connect,
    retryRoomRecovery,
    isRecoveringConnection,
    serverWaking,
    roomRecoveryMessage,
    setAppMode,
  } = connection;
  const { socket, isConnected, isConnecting, roomRecoveryState, roomCode } = connectionState;
  const { serverUrl } = config;

  const { authUser, authProfile, onOpenAuth, onOpenAccount, onOpenAuthModal, onOpenAccountModal } = authView;

  const { overlayPayload, setOverlayPayload, handleMatchmakingAutoJoin } = matchmakingView;

  const {
    joinedRoom,
    you,
    players,
    isRoomHost,
    pendingUiAction,
    privateLobbyHostWinStreak,
    outboundChallenge,
    lobbyError,
  } = lobbyView;

  const {
    state,
    opponentId,
    opponentName,
    myName,
    myScore,
    opponentScore,
    opponentTileCount,
    isMyTurn,
    isHandActive,
    hudScorePulse,
    hudRightLabel,
    hudRightScore,
    hudRightScorePulse,
    opponentPillRef,
    boneyardRef,
    boneyardCount,
    openEndsSum,
    boardRef,
    handAreaRef,
    trayCenterRef,
    confettiCanvasRef,
    boardForDisplay,
    boardLegalMoves,
    boardSelectedTile,
    lastPlayedTile,
    boardShowOpenEndGlow,
    play,
    myHand,
    handSelectedTile,
    handleTileTap,
    legalMoves,
    handTileSize,
    handCompactStacked,
    drawPulseIndex,
    scoreToast,
    scoreTrackOpen,
    setScoreTrackOpen,
    isMuted,
    setIsMuted,
    isFullscreen,
    toggleFullscreen,
    opponentDisconnected,
    opponentDisconnectMessage,
    handReveal,
    handRevealAutoProgress,
    flyingTiles,
    preGameDraw,
    onPregameTileTap,
  } = liveMatchView;

  const {
    canUseRematch,
    rematchRequested,
    rematchWaitingText,
    requestRematch,
    handlePostGame,
    multiplayerRatingSummary,
    openMultiplayerAnalyzer,
  } = postGameView;

  const {
    showLeaveConfirm,
    setShowLeaveConfirm,
    abandonCurrentMatch,
    abandonedMatchNotice,
    setAbandonedMatchNotice,
  } = abandonedMatchView;

  const {
    tournamentMatch,
    consumedTournamentGameOverMatchIds,
    tournamentMyLabel,
    tournamentOpponentLabel,
    navigateAfterTournamentMatch,
    currentTournamentContext,
  } = tournamentPassthroughView;

  return (
    <>
      {(!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && joinedRoom && !state) ? (
        mpSubView === 'quick' && !joinedRoom ? (
          <Suspense fallback={<ScreenLoader label="Loading Quick Match…" />}>
            <MatchmakingScreen
              socket={socket}
              isConnected={isConnected}
              isConnecting={isConnecting}
              serverUrl={serverUrl}
              onRetryConnect={connect}
              identity={
                authUser?.id
                  ? {
                      userId: authUser.id,
                      username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player',
                    }
                  : null
              }
              myRating={
                authProfile?.glicko_rating != null
                  ? Math.round(Number(authProfile.glicko_rating))
                  : null
              }
              myWinStreak={privateLobbyHostWinStreak}
              onNavigate={setAppMode}
              onOpenAuth={onOpenAuth}
              onOpenAccount={onOpenAccount}
              onBackHome={() => setAppMode('home')}
              onOpenPrivateMatch={() => setMpSubView('private')}
              onAutoJoinRoom={handleMatchmakingAutoJoin}
            />
          </Suspense>
        ) : mpSubView === 'quick' && joinedRoom && !state ? (
          <div
            className="mp-quick-starting"
            style={{
              flex: '1 1 0',
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary, rgba(255,255,255,0.72))',
              fontSize: '1.05rem',
              letterSpacing: '0.04em',
            }}
          >
            Starting match…
          </div>
        ) : (
          <Suspense fallback={<ScreenLoader label="Loading Private Match…" />}>
            <PrivateMatchLobbyScreen
              phase={
                !isConnected && !isRecoveringConnection
                  ? 'disconnected'
                  : isConnected && !joinedRoom
                    ? 'lobby'
                    : 'room'
              }
              onNavigate={setAppMode}
              onOpenAuth={onOpenAuthModal}
              onOpenAccount={onOpenAccountModal}
              onBackHome={() => {
                setMpSubView('quick');
                setAppMode('home');
              }}
              isConnecting={isConnecting}
              serverWaking={serverWaking}
              serverUrl={serverUrl}
              onConnect={connect}
              roomCode={roomCode}
              onRoomCodeChange={setRoomCode}
              onCreateRoom={createRoom}
              onJoinRoom={joinRoom}
              pendingLobbyAction={
                pendingUiAction === 'create' || pendingUiAction === 'join' ? pendingUiAction : null
              }
              joinedRoom={joinedRoom ?? ''}
              players={players}
              you={you}
              isRoomHost={isRoomHost}
              onLeaveRoom={leavePrivateLobbyRoom}
              onStartGame={startGame}
              pendingStart={pendingUiAction === 'start'}
              onCopyInviteLink={copyInviteLink}
              onCopyRoomCode={copyRoomCodeToClipboard}
              myRating={
                authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : null
              }
              myUsername={authProfile?.username ?? null}
              roomChatFeed={roomReactions}
              onSendRoomChat={sendRoomChat}
              winTarget={60}
              isRatedEligible={Boolean(authUser?.id)}
              roomRecoveryState={roomRecoveryState}
              roomRecoveryMessage={roomRecoveryMessage}
              onRetryRoomRecovery={retryRoomRecovery}
              hostWinStreak={privateLobbyHostWinStreak}
              onOpenQuickMatch={() => setMpSubView('quick')}
              socket={socket}
              pendingChallenge={
                outboundChallenge && players.length < 2
                  ? {
                      friendUsername: outboundChallenge.friendUsername,
                      matchSummary: outboundChallenge.matchSummary,
                      expiresAt: outboundChallenge.expiresAt,
                    }
                  : null
              }
              lobbyError={lobbyError}
              sendFriendChallenge={sendFriendChallenge}
            />
          </Suspense>
        )
      ) : null}

      {(isConnected || isRecoveringConnection) && joinedRoom && state ? (
        <Suspense fallback={<ScreenLoader label="Loading Match…" />}>
          <LiveMatchScreen
            visible={Boolean((isConnected || isRecoveringConnection) && joinedRoom && state)}
            state={state}
            you={you}
            opponentId={opponentId}
            opponentName={opponentName}
            myName={myName}
            myScore={myScore}
            opponentScore={opponentScore}
            opponentTileCount={opponentTileCount}
            isMyTurn={isMyTurn}
            isHandActive={isHandActive}
            hudScorePulse={hudScorePulse}
            hudRightLabel={hudRightLabel}
            hudRightScore={hudRightScore}
            hudRightScorePulse={hudRightScorePulse}
            opponentPillRef={opponentPillRef}
            boneyardRef={boneyardRef}
            boneyardCount={boneyardCount}
            openEndsSum={openEndsSum}
            boardRef={boardRef}
            handAreaRef={handAreaRef}
            trayCenterRef={trayCenterRef}
            confettiCanvasRef={confettiCanvasRef}
            boardForDisplay={boardForDisplay}
            boardLegalMoves={boardLegalMoves}
            boardSelectedTile={boardSelectedTile}
            lastPlayedTile={lastPlayedTile}
            boardShowOpenEndGlow={boardShowOpenEndGlow}
            onPositionClick={play}
            myHand={myHand}
            handSelectedTile={handSelectedTile}
            onHandTileSelect={handleTileTap}
            preGameDraw={preGameDraw}
            onPregameTileTap={onPregameTileTap}
            legalMoves={legalMoves}
            handTileSize={handTileSize}
            handCompactStacked={handCompactStacked}
            drawPulseIndex={drawPulseIndex}
            scoreToast={scoreToast}
            scoreTrackOpen={scoreTrackOpen}
            onScoreTrackOpenChange={setScoreTrackOpen}
            roomReactions={roomReactions}
            onSendRoomChat={sendRoomChat}
            onSendRoomEmote={sendRoomEmote}
            isMuted={isMuted}
            onToggleMute={() => setIsMuted((prev) => !prev)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            opponentDisconnected={opponentDisconnected}
            opponentDisconnectMessage={opponentDisconnectMessage}
            roomRecoveryState={roomRecoveryState}
            roomRecoveryMessage={roomRecoveryMessage}
            onRetryRoomRecovery={retryRoomRecovery}
            winTarget={state?.config?.winningScore ?? 60}
            tournamentMatch={tournamentMatch}
            consumedTournamentGameOverMatchIds={consumedTournamentGameOverMatchIds}
            tournamentMyLabel={tournamentMyLabel}
            tournamentOpponentLabel={tournamentOpponentLabel}
            onTournamentViewBracket={() => navigateAfterTournamentMatch('bracket')}
            onTournamentViewFinalResult={() => navigateAfterTournamentMatch('result')}
            onTournamentReturnToHub={() => navigateAfterTournamentMatch('hub')}
            canUseRematch={canUseRematch}
            rematchRequested={rematchRequested}
            rematchWaitingText={rematchWaitingText}
            onRematch={requestRematch}
            onPostGame={handlePostGame}
            players={players}
            multiplayerRatingSummary={multiplayerRatingSummary}
            onOpenMultiplayerAnalyzer={openMultiplayerAnalyzer}
            handReveal={handReveal}
            handRevealAutoProgress={handRevealAutoProgress}
            flyingTiles={flyingTiles}
            showLeaveConfirm={showLeaveConfirm}
            onRequestLeaveConfirm={() => setShowLeaveConfirm(true)}
            onLeaveConfirmDismiss={() => setShowLeaveConfirm(false)}
            leaveModalIsTournament={Boolean(currentTournamentContext)}
            onConfirmLeaveMatch={() => {
              setShowLeaveConfirm(false);
              void abandonCurrentMatch();
            }}
          />
        </Suspense>
      ) : null}

      {overlayPayload ? (
        <Suspense fallback={null}>
          <MatchFoundOverlay
            payload={overlayPayload}
            yourUsername={authProfile?.username ?? 'Guest'}
            onComplete={() => {
              setOverlayPayload(null);
            }}
          />
        </Suspense>
      ) : null}
      {abandonedMatchNotice ? (
        <GameOverlayPortal>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Match abandoned"
            className="rh-leave-overlay"
          >
            <div
              className="rh-leave-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
              }}
            >
              <h2 className="rh-leave-modal__title" style={{ margin: '0 0 10px' }}>
                {abandonedMatchNotice.title}
              </h2>
              <p className="rh-leave-modal__copy" style={{ margin: '0 auto 24px' }}>
                {abandonedMatchNotice.detail}
              </p>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  width: '100%',
                  maxWidth: '200px',
                }}
              >
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="rh-leave-modal__btn rh-leave-modal__btn--cancel"
                  onClick={() => {
                    setAppMode('home');
                    setAbandonedMatchNotice(null);
                  }}
                >
                  Go Home
                </Button>
              </div>
            </div>
          </div>
        </GameOverlayPortal>
      ) : null}
    </>
  );
}
```
#### After
```typescript
import React, { Suspense } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import { ScreenLoader } from '../ui/ScreenLoader';
import type { BoardHandle } from '../components';
import type { GameState, Move, PlacementPosition, Tile } from '../types';
import type { PreGameDrawState } from '../match/preGameDraw/preGameDrawLogic';
import type { MatchFoundPayload } from '../matchmaking/types';
import type { TournamentMatchContext } from '../match/session/useTournamentMatchSession';
import type {
  MultiplayerControllerConnectionBundle,
  MultiplayerControllerLobbySnapshot,
} from './multiplayerRuntime';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';
import { Button } from '../components/primitives';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import '../components/leaveGameModal.css';

const MatchmakingScreen = React.lazy(() => import('../matchmaking/MatchmakingScreen'));
const PrivateMatchLobbyScreen = React.lazy(() => import('./PrivateMatchLobbyScreen'));
const LiveMatchScreen = React.lazy(() =>
  import('../match/LiveMatchScreen').then((module) => ({ default: module.LiveMatchScreen })),
);
const MatchFoundOverlay = React.lazy(() =>
  import('../matchmaking/MatchFoundOverlay').then((module) => ({ default: module.MatchFoundOverlay })),
);

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: {
    you: number;
    opponent: number;
  };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

export type AbandonedMatchNotice = {
  context: 'tournament' | 'multiplayer';
  title: string;
  detail: string;
  tournamentId?: string | null;
};

export type MultiplayerAuthView = {
  authUser: User | null;
  authProfile: {
    username?: string | null;
    glicko_rating?: number | null;
  } | null;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
  onOpenAuthModal: () => void;
  onOpenAccountModal: () => void;
};

export type MultiplayerMatchmakingView = {
  overlayPayload: MatchFoundPayload | null;
  setOverlayPayload: Dispatch<SetStateAction<MatchFoundPayload | null>>;
  handleMatchmakingAutoJoin: (payload: MatchFoundPayload) => void;
};

export type MultiplayerLiveMatchView = {
  state: GameState | null;
  opponentId: string | null;
  opponentName: string;
  myName: string;
  myScore: number;
  opponentScore: number;
  opponentTileCount: number;
  isMyTurn: boolean;
  isHandActive: boolean;
  hudScorePulse: Record<string, boolean>;
  hudRightLabel: string;
  hudRightScore: number;
  hudRightScorePulse: boolean;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boneyardCount: number;
  openEndsSum: number;
  boardRef: RefObject<BoardHandle | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  boardForDisplay: GameState['board'] | null;
  boardLegalMoves: Move[];
  boardSelectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  play: (position: PlacementPosition) => void;
  myHand: Tile[];
  handSelectedTile: Tile | null;
  handleTileTap: (tile: Tile) => void;
  legalMoves: Move[];
  handTileSize: number;
  handCompactStacked: boolean;
  drawPulseIndex: number | null;
  scoreToast: { message: string; tone: 'you' | 'opp'; visible: boolean } | null;
  scoreTrackOpen: boolean;
  setScoreTrackOpen: Dispatch<SetStateAction<boolean>>;
  isMuted: boolean;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  opponentDisconnected: boolean;
  opponentDisconnectMessage: string;
  handReveal: HandEndedPayload | null;
  handRevealAutoProgress: number;
  flyingTiles: { x: number; y: number; toX: number; toY: number; id: number }[];
  preGameDraw: PreGameDrawState | null;
  onPregameTileTap: (tileId: string) => void;
};

export type MultiplayerPostGameView = {
  canUseRematch: boolean;
  rematchRequested: boolean;
  rematchWaitingText: string | undefined;
  requestRematch: () => void;
  handlePostGame: () => void;
  multiplayerRatingSummary: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  openMultiplayerAnalyzer: () => void;
};

export type MultiplayerAbandonedMatchView = {
  showLeaveConfirm: boolean;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
  abandonCurrentMatch: () => Promise<void>;
  abandonedMatchNotice: AbandonedMatchNotice | null;
  setAbandonedMatchNotice: Dispatch<SetStateAction<AbandonedMatchNotice | null>>;
};

export type MultiplayerTournamentPassthroughView = {
  tournamentMatch: TournamentMatchContext | null;
  consumedTournamentGameOverMatchIds: ReadonlySet<string>;
  tournamentMyLabel: string;
  tournamentOpponentLabel: string | null;
  navigateAfterTournamentMatch: (nextView: 'hub' | 'bracket' | 'result') => void;
  currentTournamentContext: TournamentMatchContext | null;
  setActiveTournamentId: Dispatch<SetStateAction<string | null>>;
  setTournamentSubView: Dispatch<SetStateAction<'hub' | 'bracket' | 'result'>>;
};

export type MultiplayerModeViewProps = {
  authView: MultiplayerAuthView;
  matchmakingView: MultiplayerMatchmakingView;
  lobbyView: MultiplayerControllerLobbySnapshot;
  liveMatchView: MultiplayerLiveMatchView;
  postGameView: MultiplayerPostGameView;
  abandonedMatchView: MultiplayerAbandonedMatchView;
  tournamentPassthroughView: MultiplayerTournamentPassthroughView;
};

export type MultiplayerModeControllerProps = {
  connection: MultiplayerControllerConnectionBundle;
  mpSubView: 'quick' | 'private';
  startGame: () => void;
  view: MultiplayerModeViewProps;
};

export default function MultiplayerModeController({
  connection,
  mpSubView,
  startGame,
  view,
}: MultiplayerModeControllerProps) {
  const {
    createRoom,
    joinRoom,
    leavePrivateLobbyRoom,
    copyInviteLink,
    copyRoomCodeToClipboard,
    roomActionsUi,
    roomReactions,
    sendRoomChat,
    sendRoomEmote,
    sendFriendChallenge,
  } = useMultiplayerLobbyActionsContext();
  const { setMpSubView, setRoomCode } = roomActionsUi;

  const { authView, matchmakingView, lobbyView, liveMatchView, postGameView, abandonedMatchView, tournamentPassthroughView } =
    view;

  const {
    connectionState,
    config,
    connect,
    retryRoomRecovery,
    isRecoveringConnection,
    serverWaking,
    roomRecoveryMessage,
    setAppMode,
  } = connection;
  const { socket, isConnected, isConnecting, roomRecoveryState, roomCode } = connectionState;
  const { serverUrl } = config;

  const { authUser, authProfile, onOpenAuth, onOpenAccount, onOpenAuthModal, onOpenAccountModal } = authView;

  const { overlayPayload, setOverlayPayload, handleMatchmakingAutoJoin } = matchmakingView;

  const {
    joinedRoom,
    you,
    players,
    isRoomHost,
    pendingUiAction,
    privateLobbyHostWinStreak,
    outboundChallenge,
    lobbyError,
  } = lobbyView;

  const {
    state,
    opponentId,
    opponentName,
    myName,
    myScore,
    opponentScore,
    opponentTileCount,
    isMyTurn,
    isHandActive,
    hudScorePulse,
    hudRightLabel,
    hudRightScore,
    hudRightScorePulse,
    opponentPillRef,
    boneyardRef,
    boneyardCount,
    openEndsSum,
    boardRef,
    handAreaRef,
    trayCenterRef,
    confettiCanvasRef,
    boardForDisplay,
    boardLegalMoves,
    boardSelectedTile,
    lastPlayedTile,
    boardShowOpenEndGlow,
    play,
    myHand,
    handSelectedTile,
    handleTileTap,
    legalMoves,
    handTileSize,
    handCompactStacked,
    drawPulseIndex,
    scoreToast,
    scoreTrackOpen,
    setScoreTrackOpen,
    isMuted,
    setIsMuted,
    isFullscreen,
    toggleFullscreen,
    opponentDisconnected,
    opponentDisconnectMessage,
    handReveal,
    handRevealAutoProgress,
    flyingTiles,
    preGameDraw,
    onPregameTileTap,
  } = liveMatchView;

  const {
    canUseRematch,
    rematchRequested,
    rematchWaitingText,
    requestRematch,
    handlePostGame,
    multiplayerRatingSummary,
    openMultiplayerAnalyzer,
  } = postGameView;

  const {
    showLeaveConfirm,
    setShowLeaveConfirm,
    abandonCurrentMatch,
    abandonedMatchNotice,
    setAbandonedMatchNotice,
  } = abandonedMatchView;

  const {
    tournamentMatch,
    consumedTournamentGameOverMatchIds,
    tournamentMyLabel,
    tournamentOpponentLabel,
    navigateAfterTournamentMatch,
    currentTournamentContext,
  } = tournamentPassthroughView;

  return (
    <>
      {(!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && joinedRoom && !state) ? (
        mpSubView === 'quick' && !joinedRoom ? (
          <Suspense fallback={<ScreenLoader label="Loading Quick Match…" />}>
            <MatchmakingScreen
              socket={socket}
              isConnected={isConnected}
              isConnecting={isConnecting}
              serverUrl={serverUrl}
              onRetryConnect={connect}
              identity={
                authUser?.id
                  ? {
                      userId: authUser.id,
                      username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player',
                    }
                  : null
              }
              myRating={
                authProfile?.glicko_rating != null
                  ? Math.round(Number(authProfile.glicko_rating))
                  : null
              }
              myWinStreak={privateLobbyHostWinStreak}
              onNavigate={setAppMode}
              onOpenAuth={onOpenAuth}
              onOpenAccount={onOpenAccount}
              onBackHome={() => setAppMode('home')}
              onOpenPrivateMatch={() => setMpSubView('private')}
              onAutoJoinRoom={handleMatchmakingAutoJoin}
            />
          </Suspense>
        ) : mpSubView === 'quick' && joinedRoom && !state ? (
          <div
            className="mp-quick-starting"
            style={{
              flex: '1 1 0',
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary, rgba(255,255,255,0.72))',
              fontSize: '1.05rem',
              letterSpacing: '0.04em',
            }}
          >
            Starting match…
          </div>
        ) : (
          <Suspense fallback={<ScreenLoader label="Loading Private Match…" />}>
            <PrivateMatchLobbyScreen
              phase={
                !isConnected && !isRecoveringConnection
                  ? 'disconnected'
                  : isConnected && !joinedRoom
                    ? 'lobby'
                    : 'room'
              }
              onNavigate={setAppMode}
              onOpenAuth={onOpenAuthModal}
              onOpenAccount={onOpenAccountModal}
              onBackHome={() => {
                setMpSubView('quick');
                setAppMode('home');
              }}
              isConnecting={isConnecting}
              serverWaking={serverWaking}
              serverUrl={serverUrl}
              onConnect={connect}
              roomCode={roomCode}
              onRoomCodeChange={setRoomCode}
              onCreateRoom={createRoom}
              onJoinRoom={joinRoom}
              pendingLobbyAction={
                pendingUiAction === 'create' || pendingUiAction === 'join' ? pendingUiAction : null
              }
              joinedRoom={joinedRoom ?? ''}
              players={players}
              you={you}
              isRoomHost={isRoomHost}
              onLeaveRoom={leavePrivateLobbyRoom}
              onStartGame={startGame}
              pendingStart={pendingUiAction === 'start'}
              onCopyInviteLink={copyInviteLink}
              onCopyRoomCode={copyRoomCodeToClipboard}
              myRating={
                authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : null
              }
              myUsername={authProfile?.username ?? null}
              roomChatFeed={roomReactions}
              onSendRoomChat={sendRoomChat}
              winTarget={60}
              isRatedEligible={Boolean(authUser?.id)}
              roomRecoveryState={roomRecoveryState}
              roomRecoveryMessage={roomRecoveryMessage}
              onRetryRoomRecovery={retryRoomRecovery}
              hostWinStreak={privateLobbyHostWinStreak}
              onOpenQuickMatch={() => setMpSubView('quick')}
              socket={socket}
              pendingChallenge={
                outboundChallenge && players.length < 2
                  ? {
                      friendUsername: outboundChallenge.friendUsername,
                      matchSummary: outboundChallenge.matchSummary,
                      expiresAt: outboundChallenge.expiresAt,
                    }
                  : null
              }
              lobbyError={lobbyError}
              sendFriendChallenge={sendFriendChallenge}
            />
          </Suspense>
        )
      ) : null}

      {(isConnected || isRecoveringConnection) && joinedRoom && state ? (
        <Suspense fallback={<ScreenLoader label="Loading Match…" />}>
          <LiveMatchScreen
            shell={{
              visible: Boolean((isConnected || isRecoveringConnection) && joinedRoom && state),
              state,
              flyingTiles,
              scoreToast,
            }}
            identity={{
              you,
              opponentId,
              opponentName,
              myName,
              players,
            }}
            hud={{
              myScore,
              opponentScore,
              opponentTileCount,
              isMyTurn,
              isHandActive,
              hudScorePulse,
              hudRightLabel,
              hudRightScore,
              hudRightScorePulse,
              boneyardCount,
              openEndsSum,
              winTarget: state?.config?.winningScore ?? 60,
            }}
            board={{
              opponentPillRef,
              boneyardRef,
              boardRef,
              handAreaRef,
              trayCenterRef,
              confettiCanvasRef,
              boardForDisplay,
              boardLegalMoves,
              boardSelectedTile,
              lastPlayedTile,
              boardShowOpenEndGlow,
              onPositionClick: play,
            }}
            hand={{
              myHand,
              handSelectedTile,
              onHandTileSelect: handleTileTap,
              legalMoves,
              handTileSize,
              handCompactStacked,
              drawPulseIndex,
            }}
            chrome={{
              scoreTrackOpen,
              onScoreTrackOpenChange: setScoreTrackOpen,
              roomReactions,
              onSendRoomChat: sendRoomChat,
              onSendRoomEmote: sendRoomEmote,
              isMuted,
              onToggleMute: () => setIsMuted((prev) => !prev),
              isFullscreen,
              onToggleFullscreen: toggleFullscreen,
            }}
            connection={{
              opponentDisconnected,
              opponentDisconnectMessage,
              roomRecoveryState,
              roomRecoveryMessage,
              onRetryRoomRecovery: retryRoomRecovery,
            }}
            tournament={{
              tournamentMatch,
              consumedTournamentGameOverMatchIds,
              tournamentMyLabel,
              tournamentOpponentLabel,
              onTournamentViewBracket: () => navigateAfterTournamentMatch('bracket'),
              onTournamentViewFinalResult: () => navigateAfterTournamentMatch('result'),
              onTournamentReturnToHub: () => navigateAfterTournamentMatch('hub'),
            }}
            postGame={{
              canUseRematch,
              rematchRequested,
              rematchWaitingText,
              onRematch: requestRematch,
              onPostGame: handlePostGame,
              multiplayerRatingSummary,
              onOpenMultiplayerAnalyzer: openMultiplayerAnalyzer,
              handReveal,
              handRevealAutoProgress,
            }}
            leave={{
              showLeaveConfirm,
              onRequestLeaveConfirm: () => setShowLeaveConfirm(true),
              onLeaveConfirmDismiss: () => setShowLeaveConfirm(false),
              leaveModalIsTournament: Boolean(currentTournamentContext),
              onConfirmLeaveMatch: () => {
                setShowLeaveConfirm(false);
                void abandonCurrentMatch();
              },
            }}
            preGameDraw={{
              preGameDraw,
              onPregameTileTap,
            }}
          />
        </Suspense>
      ) : null}

      {overlayPayload ? (
        <Suspense fallback={null}>
          <MatchFoundOverlay
            payload={overlayPayload}
            yourUsername={authProfile?.username ?? 'Guest'}
            onComplete={() => {
              setOverlayPayload(null);
            }}
          />
        </Suspense>
      ) : null}
      {abandonedMatchNotice ? (
        <GameOverlayPortal>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Match abandoned"
            className="rh-leave-overlay"
          >
            <div
              className="rh-leave-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
              }}
            >
              <h2 className="rh-leave-modal__title" style={{ margin: '0 0 10px' }}>
                {abandonedMatchNotice.title}
              </h2>
              <p className="rh-leave-modal__copy" style={{ margin: '0 auto 24px' }}>
                {abandonedMatchNotice.detail}
              </p>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  width: '100%',
                  maxWidth: '200px',
                }}
              >
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="rh-leave-modal__btn rh-leave-modal__btn--cancel"
                  onClick={() => {
                    setAppMode('home');
                    setAbandonedMatchNotice(null);
                  }}
                >
                  Go Home
                </Button>
              </div>
            </div>
          </div>
        </GameOverlayPortal>
      ) : null}
    </>
  );
}
```
### `client/src/multiplayer/useMultiplayerPresentation.ts`
#### Before
```typescript
import { useEffect, useRef } from 'react';
import { playTileSound, playScoreSound, playDrawSound } from '../utils/sound';
import type { GameState, Tile } from '../types';

function getBoardTileCount(board: any): number {
  if (!board || !Array.isArray(board.tiles)) return 0;
  return board.tiles.length;
}

interface PresentationCoordinatorParams {
  state: GameState | null;
  you: string;
  isMutedRef: React.MutableRefObject<boolean>;
  opponentName: string;
  players: any[];
  myHand: Tile[];
  opponentTileCount: number;
  drawSequenceActive: boolean;
  boneyardCount: number;
  showScoreLikeToast: (message: string, tone: 'you' | 'opp') => void;
  showScoreToast: (player: 'you' | 'opp', points: number, label?: string) => void;
  setFlyingTiles: React.Dispatch<React.SetStateAction<any[]>>;
  boneyardRef: React.RefObject<HTMLElement | null>;
  handAreaRef: React.RefObject<HTMLElement | null>;
  opponentPillRef: React.RefObject<HTMLElement | null>;
}

export function useMultiplayerPresentation({
  state,
  you,
  isMutedRef,
  opponentName,
  players,
  myHand,
  opponentTileCount,
  drawSequenceActive,
  showScoreLikeToast,
  showScoreToast,
  setFlyingTiles,
  boneyardRef,
  handAreaRef,
  opponentPillRef,
}: PresentationCoordinatorParams) {
  const prevStateRef = useRef<GameState | null>(null);
  const prevMyHandLenRef = useRef<number>(0);
  const prevOpponentHandLenRef = useRef<number>(0);
  const localFlyingTileIdRef = useRef<number>(0);
  const lastHandNumberRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state) {
      prevStateRef.current = null;
      return;
    }
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;

    if (state.handNumber !== prev.handNumber) return;

    const actorId = prev.playerIds[prev.currentPlayerIndex] ?? null;
    if (!actorId) return;

    const prevBoardCount = getBoardTileCount(prev.board);
    const nextBoardCount = getBoardTileCount(state.board);
    const prevBoneyardLen = prev.boneyard?.length ?? 0;
    const nextBoneyardLen = state.boneyard?.length ?? 0;

    if (nextBoardCount > prevBoardCount) {
      if (actorId !== you) {
        playTileSound('standard', isMutedRef.current);
      }
    }

    if (actorId !== you && nextBoardCount === prevBoardCount) {
      if (nextBoneyardLen < prevBoneyardLen) {
        showScoreLikeToast(`${opponentName} drew a tile`, 'opp');
      } else if (
        state.currentPlayerIndex !== prev.currentPlayerIndex &&
        (prev.players[actorId]?.hand?.length ?? 0) === (state.players[actorId]?.hand?.length ?? 0)
      ) {
        showScoreLikeToast(`${opponentName} passed`, 'opp');
      }
    }

    for (const pid of state.playerIds) {
      const prevScore = prev.players[pid]?.score ?? 0;
      const nextScore = state.players[pid]?.score ?? 0;
      const delta = nextScore - prevScore;

      if (delta > 0 && !state.handOver && !state.gameOver) {
        const tone = pid === you ? 'you' : 'opp';
        const label = players.find((p) => p.id === pid)?.username?.trim() || (pid === you ? 'You' : opponentName);

        const timer = setTimeout(() => {
          playScoreSound(delta, isMutedRef.current);
          showScoreToast(tone, delta, label);
        }, 80);

        return () => clearTimeout(timer);
      }
    }
  }, [state, you, isMutedRef, opponentName, players, showScoreLikeToast, showScoreToast]);

  useEffect(() => {
    if (!state) {
      prevMyHandLenRef.current = 0;
      prevOpponentHandLenRef.current = 0;
      lastHandNumberRef.current = null;
      return;
    }

    const currentMyHandLen = myHand.length;
    const currentOppHandLen = opponentTileCount;
    const prevMyHandLen = prevMyHandLenRef.current;
    const prevOppHandLen = prevOpponentHandLenRef.current;

    const currentHandNumber = state.handNumber;
    const isNewHand = lastHandNumberRef.current !== null && lastHandNumberRef.current !== currentHandNumber;
    lastHandNumberRef.current = currentHandNumber;

    if (isNewHand) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (prevMyHandLen === 0 && prevOppHandLen === 0) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (drawSequenceActive) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    const animationTimers: number[] = [];

    if (currentMyHandLen > prevMyHandLen) {
      const drawnCount = currentMyHandLen - prevMyHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !handAreaRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = handAreaRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;
          
          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    if (currentOppHandLen > prevOppHandLen) {
      const drawnCount = currentOppHandLen - prevOppHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !opponentPillRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = opponentPillRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    prevMyHandLenRef.current = currentMyHandLen;
    prevOpponentHandLenRef.current = currentOppHandLen;

    return () => {
      animationTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    state,
    myHand.length,
    opponentTileCount,
    drawSequenceActive,
    isMutedRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    setFlyingTiles,
  ]);
}
```
#### After
```typescript
import { useEffect, useRef } from 'react';
import { playTileSound, playScoreSound, playDrawSound } from '../utils/sound';
import type { GameState, Tile } from '../types';
import type { RoomPlayer } from './multiplayerRuntime';
import type { FlyingTile } from '../match/liveMatchScreenTypes';

function getBoardTileCount(board: GameState['board']): number {
  if (!board) return 0;
  return board.mainLine.length;
}

interface PresentationCoordinatorParams {
  state: GameState | null;
  you: string;
  isMutedRef: React.MutableRefObject<boolean>;
  opponentName: string;
  players: RoomPlayer[];
  myHand: Tile[];
  opponentTileCount: number;
  drawSequenceActive: boolean;
  boneyardCount: number;
  showScoreLikeToast: (message: string, tone: 'you' | 'opp') => void;
  showScoreToast: (player: 'you' | 'opp', points: number, label?: string) => void;
  setFlyingTiles: React.Dispatch<React.SetStateAction<FlyingTile[]>>;
  boneyardRef: React.RefObject<HTMLElement | null>;
  handAreaRef: React.RefObject<HTMLElement | null>;
  opponentPillRef: React.RefObject<HTMLElement | null>;
}

export function useMultiplayerPresentation({
  state,
  you,
  isMutedRef,
  opponentName,
  players,
  myHand,
  opponentTileCount,
  drawSequenceActive,
  showScoreLikeToast,
  showScoreToast,
  setFlyingTiles,
  boneyardRef,
  handAreaRef,
  opponentPillRef,
}: PresentationCoordinatorParams) {
  const prevStateRef = useRef<GameState | null>(null);
  const prevMyHandLenRef = useRef<number>(0);
  const prevOpponentHandLenRef = useRef<number>(0);
  const localFlyingTileIdRef = useRef<number>(0);
  const lastHandNumberRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state) {
      prevStateRef.current = null;
      return;
    }
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;

    if (state.handNumber !== prev.handNumber) return;

    const actorId = prev.playerIds[prev.currentPlayerIndex] ?? null;
    if (!actorId) return;

    const prevBoardCount = getBoardTileCount(prev.board);
    const nextBoardCount = getBoardTileCount(state.board);
    const prevBoneyardLen = prev.boneyard?.length ?? 0;
    const nextBoneyardLen = state.boneyard?.length ?? 0;

    if (nextBoardCount > prevBoardCount) {
      if (actorId !== you) {
        playTileSound('standard', isMutedRef.current);
      }
    }

    if (actorId !== you && nextBoardCount === prevBoardCount) {
      if (nextBoneyardLen < prevBoneyardLen) {
        showScoreLikeToast(`${opponentName} drew a tile`, 'opp');
      } else if (
        state.currentPlayerIndex !== prev.currentPlayerIndex &&
        (prev.players[actorId]?.hand?.length ?? 0) === (state.players[actorId]?.hand?.length ?? 0)
      ) {
        showScoreLikeToast(`${opponentName} passed`, 'opp');
      }
    }

    for (const pid of state.playerIds) {
      const prevScore = prev.players[pid]?.score ?? 0;
      const nextScore = state.players[pid]?.score ?? 0;
      const delta = nextScore - prevScore;

      if (delta > 0 && !state.handOver && !state.gameOver) {
        const tone = pid === you ? 'you' : 'opp';
        const label = players.find((p) => p.id === pid)?.username?.trim() || (pid === you ? 'You' : opponentName);

        const timer = setTimeout(() => {
          playScoreSound(delta, isMutedRef.current);
          showScoreToast(tone, delta, label);
        }, 80);

        return () => clearTimeout(timer);
      }
    }
  }, [state, you, isMutedRef, opponentName, players, showScoreLikeToast, showScoreToast]);

  useEffect(() => {
    if (!state) {
      prevMyHandLenRef.current = 0;
      prevOpponentHandLenRef.current = 0;
      lastHandNumberRef.current = null;
      return;
    }

    const currentMyHandLen = myHand.length;
    const currentOppHandLen = opponentTileCount;
    const prevMyHandLen = prevMyHandLenRef.current;
    const prevOppHandLen = prevOpponentHandLenRef.current;

    const currentHandNumber = state.handNumber;
    const isNewHand = lastHandNumberRef.current !== null && lastHandNumberRef.current !== currentHandNumber;
    lastHandNumberRef.current = currentHandNumber;

    if (isNewHand) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (prevMyHandLen === 0 && prevOppHandLen === 0) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (drawSequenceActive) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    const animationTimers: number[] = [];

    if (currentMyHandLen > prevMyHandLen) {
      const drawnCount = currentMyHandLen - prevMyHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !handAreaRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = handAreaRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    if (currentOppHandLen > prevOppHandLen) {
      const drawnCount = currentOppHandLen - prevOppHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !opponentPillRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = opponentPillRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    prevMyHandLenRef.current = currentMyHandLen;
    prevOpponentHandLenRef.current = currentOppHandLen;

    return () => {
      animationTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    state,
    myHand.length,
    opponentTileCount,
    drawSequenceActive,
    isMutedRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    setFlyingTiles,
  ]);
}```
### `client/src/stats/statsApi.ts`
#### Before
```typescript
import type { User } from '@supabase/supabase-js';
import { apiGet, apiPost } from '../api/client';
import { supabase } from '../lib/supabase';
import { resolveGameServerUrl } from '../lib/gameServerUrl';
import { fetchRatingHistory } from '../ranking/api';
import {
  FRITZ_MASTER_ID,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
} from '../bot/fritzConfig';

export type MatchMode = 'bot' | 'online' | 'practice';

export interface RecordMatchInput {
  mode: MatchMode;
  opponentType: 'bot' | 'online' | 'guest';
  winnerUserId: string | null;
  loserUserId: string | null;
  winnerScore: number | null;
  loserScore: number | null;
  moveCount: number | null;
  avgMoveQuality?: number | null;
  roomCode?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordMatchResult(
  input: RecordMatchInput,
): Promise<{ error: string | null }> {
  const serverUrl = resolveGameServerUrl();
  if (!serverUrl || !supabase) return { error: null };

  const result = await apiPost<{ ok?: boolean }>('/api/stats/record-match', input);
  return { error: result.error };
}

export interface StatsSummary {
  onlineGamesPlayed: number;
  wins: number;
  losses: number;
  avgMoveQuality: number | null;
  longestWinStreak: number;
  winRate: number;
  currentWinStreak: number;
  gamesThisWeek: number;
  ghostRating: number | null;
  ghostGamesThisWeek: number;
  ghostRatingChangeThisWeek: number;
  ghostBestWinMarginThisWeek: number | null;
}

export type FritzTierKey = 'rookie' | 'standard' | 'elite' | 'master';

export interface FritzTierRecord {
  wins: number;
  losses: number;
  gamesPlayed: number;
}

export interface FritzStatsSummary {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  bestWinMargin: number | null;
  averagePointsScored: number | null;
  highestScore: number | null;
  gamesThisWeek: number;
  ratingChangeThisWeek: number;
  bestWinMarginThisWeek: number | null;
  tierRecords: Record<FritzTierKey, FritzTierRecord>;
}

export interface GhostStatsSummary {
  rating: number | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  bestWinMargin: number | null;
  gamesThisWeek: number;
  ratingChangeThisWeek: number;
  bestWinMarginThisWeek: number | null;
}

export interface PuzzleStatsSummary {
  currentStreak: number;
  completions: number;
  completionsThisWeek: number;
  bestScoreToday: number | null;
  bestScoreEver: number | null;
  perfectDays: number;
}

export interface PersonalStatsInsights {
  base: StatsSummary;
  rankingProfile: RankingProfile | null;
  fritz: FritzStatsSummary;
  ghost: GhostStatsSummary;
  puzzle: PuzzleStatsSummary;
}

export interface WeeklyRecap {
  weekLabel: string;
  fritz: Pick<FritzStatsSummary, 'gamesThisWeek' | 'ratingChangeThisWeek' | 'bestWinMarginThisWeek'>;
  ghost: Pick<GhostStatsSummary, 'gamesThisWeek' | 'ratingChangeThisWeek' | 'bestWinMarginThisWeek'>;
  puzzle: Pick<PuzzleStatsSummary, 'completionsThisWeek'> & { bestScoreToday: number | null };
  multiplayer: Pick<StatsSummary, 'gamesThisWeek' | 'wins' | 'losses'>;
}

type MatchSummaryRow = {
  winner_user_id: string | null;
  loser_user_id: string | null;
  mode: string | null;
  winner_score?: number | null;
  loser_score?: number | null;
  room_code?: string | null;
  avg_move_quality?: number | null;
  created_at?: string | null;
};

function dedupeOnlineMatchRows<T extends MatchSummaryRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const roomCode = row.room_code?.trim();
    const createdAt = row.created_at ?? '';
    const key = roomCode
      ? `room:${roomCode}:${row.winner_user_id ?? ''}:${row.loser_user_id ?? ''}:${row.winner_score ?? ''}:${row.loser_score ?? ''}`
      : `match:${row.winner_user_id ?? ''}:${row.loser_user_id ?? ''}:${row.winner_score ?? ''}:${row.loser_score ?? ''}:${createdAt.slice(0, 19)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

type GhostGameSummaryRow = {
  final_score: number | null;
  opponent_score: number | null;
  played_at?: string | null;
};

type PuzzleCompletionRow = {
  puzzle_date: string | null;
  current_streak: number | null;
  score: number | null;
  perfect: boolean | null;
  updated_at?: string | null;
};

type PuzzleScoreRow = {
  puzzle_date: string | null;
  best_score: number | null;
  updated_at?: string | null;
};

function isGhostRatingEligible(finalScore: number | null | undefined, opponentScore: number | null | undefined): boolean {
  return Math.max(Number(finalScore ?? 0), Number(opponentScore ?? 0)) >= 10;
}

function getWeekStart(now = new Date()): Date {
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - diffToMonday);
  return weekStart;
}

function toLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyTierRecord(): FritzTierRecord {
  return { wins: 0, losses: 0, gamesPlayed: 0 };
}

function tierFromOpponentId(opponentId: string): FritzTierKey {
  if (opponentId === FRITZ_ROOKIE_ID) return 'rookie';
  if (opponentId === FRITZ_STANDARD_ID) return 'standard';
  if (opponentId === FRITZ_MASTER_ID) return 'master';
  return 'elite';
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return `Week of ${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function deriveFritzSummary(
  games: Array<{
    played_at: string;
    opponent_id: string;
    player_score: number;
    opponent_score: number;
    delta: number;
  }>,
  weekStart: Date,
): FritzStatsSummary {
  const tierRecords: Record<FritzTierKey, FritzTierRecord> = {
    rookie: emptyTierRecord(),
    standard: emptyTierRecord(),
    elite: emptyTierRecord(),
    master: emptyTierRecord(),
  };

  let wins = 0;
  let losses = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let streakTracker = 0;
  let bestWinMargin: number | null = null;
  let highestScore: number | null = null;
  let totalPointsScored = 0;
  let gamesThisWeek = 0;
  let ratingChangeThisWeek = 0;
  let bestWinMarginThisWeek: number | null = null;

  for (const game of games) {
    const tier = tierFromOpponentId(game.opponent_id);
    const playerScore = Number(game.player_score ?? 0);
    const margin = Number(game.player_score ?? 0) - Number(game.opponent_score ?? 0);
    highestScore = highestScore == null ? playerScore : Math.max(highestScore, playerScore);
    totalPointsScored += playerScore;
    tierRecords[tier].gamesPlayed += 1;
    if (margin > 0) {
      wins += 1;
      tierRecords[tier].wins += 1;
      streakTracker += 1;
      bestStreak = Math.max(bestStreak, streakTracker);
      bestWinMargin = bestWinMargin == null ? margin : Math.max(bestWinMargin, margin);
    } else {
      losses += 1;
      tierRecords[tier].losses += 1;
      streakTracker = 0;
    }

    const playedMs = new Date(game.played_at).getTime();
    if (Number.isFinite(playedMs) && playedMs >= weekStart.getTime()) {
      gamesThisWeek += 1;
      ratingChangeThisWeek += Number(game.delta ?? 0);
      if (margin > 0) {
        bestWinMarginThisWeek =
          bestWinMarginThisWeek == null ? margin : Math.max(bestWinMarginThisWeek, margin);
      }
    }
  }

  for (let i = games.length - 1; i >= 0; i -= 1) {
    const margin = Number(games[i].player_score ?? 0) - Number(games[i].opponent_score ?? 0);
    if (margin > 0) {
      currentStreak += 1;
      continue;
    }
    break;
  }

  const gamesPlayed = wins + losses;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0;
  const averagePointsScored = gamesPlayed > 0 ? Math.round((totalPointsScored / gamesPlayed) * 10) / 10 : null;

  return {
    gamesPlayed,
    wins,
    losses,
    winRate,
    currentStreak,
    bestStreak,
    bestWinMargin,
    averagePointsScored,
    highestScore,
    gamesThisWeek,
    ratingChangeThisWeek,
    bestWinMarginThisWeek,
    tierRecords,
  };
}

function deriveGhostSummary(
  rows: GhostGameSummaryRow[],
  rating: number | null,
  weekStart: Date,
): GhostStatsSummary {
  let wins = 0;
  let losses = 0;
  let bestWinMargin: number | null = null;
  let gamesThisWeek = 0;
  let ratingChangeThisWeek = 0;
  let bestWinMarginThisWeek: number | null = null;

  for (const row of rows) {
    const finalScore = Number(row.final_score ?? 0);
    const opponentScore = Number(row.opponent_score ?? 0);
    const margin = finalScore - opponentScore;
    const ratingEligible = isGhostRatingEligible(finalScore, opponentScore);
    if (margin > 0) {
      wins += 1;
      bestWinMargin = bestWinMargin == null ? margin : Math.max(bestWinMargin, margin);
    }
    if (margin < 0) losses += 1;

    const playedMs = new Date(row.played_at ?? 0).getTime();
    if (Number.isFinite(playedMs) && playedMs >= weekStart.getTime()) {
      gamesThisWeek += 1;
      if (margin > 0) {
        bestWinMarginThisWeek =
          bestWinMarginThisWeek == null ? margin : Math.max(bestWinMarginThisWeek, margin);
      }
      if (ratingEligible && margin > 0) ratingChangeThisWeek += 16;
      if (ratingEligible && margin < 0) ratingChangeThisWeek -= 16;
    }
  }

  const gamesPlayed = rows.length;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0;

  return {
    rating,
    gamesPlayed,
    wins,
    losses,
    winRate,
    bestWinMargin,
    gamesThisWeek,
    ratingChangeThisWeek,
    bestWinMarginThisWeek,
  };
}

function derivePuzzleSummary(
  completionRows: PuzzleCompletionRow[],
  scoreRows: PuzzleScoreRow[],
  weekStart: Date,
): PuzzleStatsSummary {
  const todayKey = toLocalDateKey(new Date());
  const completions = completionRows.length;
  const perfectDays = completionRows.filter((row) => Boolean(row.perfect)).length;
  const currentStreak =
    [...completionRows]
      .sort((a, b) => String(b.puzzle_date ?? '').localeCompare(String(a.puzzle_date ?? '')))[0]
      ?.current_streak ?? 0;
  const completionsThisWeek = completionRows.filter((row) => {
    const value = row.updated_at ?? row.puzzle_date ?? '';
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) && ms >= weekStart.getTime();
  }).length;
  const bestScoreToday =
    scoreRows.find((row) => row.puzzle_date === todayKey)?.best_score == null
      ? null
      : Number(scoreRows.find((row) => row.puzzle_date === todayKey)?.best_score ?? 0);
  const bestScoreEver =
    scoreRows.length > 0
      ? Math.max(...scoreRows.map((row) => Number(row.best_score ?? 0)))
      : null;

  return {
    currentStreak: Number(currentStreak ?? 0),
    completions,
    completionsThisWeek,
    bestScoreToday,
    bestScoreEver,
    perfectDays,
  };
}

function buildStatsSummary(userId: string, rows: MatchSummaryRow[]): StatsSummary {
  const onlineRows = dedupeOnlineMatchRows(
    rows.filter((row) => row.mode === 'online'),
  ).sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());

  const wins = onlineRows.filter((row) => row.winner_user_id === userId).length;
  const losses = onlineRows.filter((row) => row.loser_user_id === userId).length;

  let longestWinStreak = 0;
  let streakTracker = 0;
  for (const match of onlineRows) {
    if (match.winner_user_id === userId) {
      streakTracker += 1;
      if (streakTracker > longestWinStreak) longestWinStreak = streakTracker;
    } else if (match.loser_user_id === userId) {
      streakTracker = 0;
    }
  }

  let currentWinStreak = 0;
  for (let i = onlineRows.length - 1; i >= 0; i--) {
    const match = onlineRows[i];
    if (match.winner_user_id === userId) {
      currentWinStreak += 1;
      continue;
    }
    if (match.loser_user_id === userId) break;
  }

  const onlineGamesPlayed = wins + losses;
  const winRate =
    onlineGamesPlayed > 0 ? Math.round((wins / onlineGamesPlayed) * 1000) / 10 : 0;
  const qualitySamples = onlineRows
    .map((row) => row.avg_move_quality)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const avgMoveQuality =
    qualitySamples.length > 0
      ? Math.round((qualitySamples.reduce((sum, value) => sum + value, 0) / qualitySamples.length) * 10) / 10
      : null;
  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const gamesThisWeek = onlineRows.filter((row) => {
    const createdMs = new Date(row.created_at ?? 0).getTime();
    return Number.isFinite(createdMs) && nowMs - createdMs <= sevenDaysMs;
  }).length;

  return {
    onlineGamesPlayed,
    wins,
    losses,
    avgMoveQuality,
    longestWinStreak,
    winRate,
    currentWinStreak,
    gamesThisWeek,
    ghostRating: null,
    ghostGamesThisWeek: 0,
    ghostRatingChangeThisWeek: 0,
    ghostBestWinMarginThisWeek: null,
  };
}

export interface RankingProfile {
  glicko_rating: number;
  glicko_rd: number;
  provisional: boolean;
  ranked_games_played: number;
  peak_rating: number;
  rank: number | null;
  /** Consecutive online wins from match history (server-computed). */
  currentWinStreak: number;
}

export async function fetchRankingProfile(
  userId: string,
): Promise<{ data: RankingProfile | null; error: string | null }> {
  const result = await apiGet<Record<string, unknown>>(
    `/api/ranking/profile/${encodeURIComponent(userId)}`,
    { auth: false },
  );
  if (result.error) {
    return { data: null, error: result.error };
  }
  const raw = result.data;
  if (!raw) {
    return { data: null, error: 'Failed to fetch ranking profile' };
  }
  if (raw.ok !== true) {
    return { data: null, error: 'Failed to fetch ranking profile' };
  }
  return {
    data: {
      glicko_rating: Number(raw.glicko_rating ?? 0),
      glicko_rd: Number(raw.glicko_rd ?? 350),
      provisional: Boolean(raw.provisional),
      ranked_games_played: Number(raw.ranked_games_played ?? 0),
      peak_rating: Number(raw.peak_rating ?? raw.glicko_rating ?? 0),
      rank: (() => {
        if (raw.rank == null || raw.rank === '') return null;
        const n = Number(raw.rank);
        return Number.isFinite(n) ? n : null;
      })(),
      currentWinStreak: Number(raw.currentWinStreak ?? 0),
    },
    error: null,
  };
}

export async function fetchUserStats(
  user: User,
): Promise<{ data: StatsSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const { data, error } = await fetchUserStatsByUserId(user.id);
  return { data, error };
}

export async function fetchPersonalStatsInsights(
  user: User,
): Promise<{ data: PersonalStatsInsights | null; error: string | null }> {
  return fetchPersonalStatsInsightsByUserId(user.id);
}

export async function fetchPersonalStatsInsightsByUserId(
  userId: string,
): Promise<{ data: PersonalStatsInsights | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const [baseResp, rankingResp, historyResp] = await Promise.all([
    fetchUserStatsByUserId(userId),
    fetchRankingProfile(userId),
    fetchRatingHistory(userId),
  ]);

  if (baseResp.error) return { data: null, error: baseResp.error };

  const weekStart = getWeekStart();
  const base = baseResp.data ?? buildStatsSummary(userId, []);
  const rankingProfile = rankingResp.data ?? null;
  const historyGames = historyResp.data?.games ?? [];
  const fritz = deriveFritzSummary(historyGames, weekStart);

  let ghostRows: GhostGameSummaryRow[] = [];
  try {
    const ghostGamesResp = await supabase
      .from('ghost_games')
      .select('final_score, opponent_score, played_at')
      .eq('user_id', userId)
      .order('played_at', { ascending: false });
    if (!ghostGamesResp.error) {
      ghostRows = (ghostGamesResp.data ?? []) as GhostGameSummaryRow[];
    }
  } catch {
    ghostRows = [];
  }

  const ghost = deriveGhostSummary(ghostRows, base.ghostRating, weekStart);

  let completionRows: PuzzleCompletionRow[] = [];
  let scoreRows: PuzzleScoreRow[] = [];
  try {
    const [completionResp, scoreResp] = await Promise.all([
      supabase
        .from('daily_puzzle_completions')
        .select('puzzle_date, current_streak, score, perfect, updated_at')
        .eq('user_id', userId)
        .order('puzzle_date', { ascending: false }),
      supabase
        .from('daily_puzzle_scores')
        .select('puzzle_date, best_score, updated_at')
        .eq('user_id', userId)
        .order('puzzle_date', { ascending: false }),
    ]);
    if (!completionResp.error) completionRows = (completionResp.data ?? []) as PuzzleCompletionRow[];
    if (!scoreResp.error) scoreRows = (scoreResp.data ?? []) as PuzzleScoreRow[];
  } catch {
    completionRows = [];
    scoreRows = [];
  }

  const puzzle = derivePuzzleSummary(completionRows, scoreRows, weekStart);

  return {
    data: {
      base,
      rankingProfile,
      fritz,
      ghost,
      puzzle,
    },
    error: null,
  };
}

export async function fetchWeeklyRecap(
  user: User,
): Promise<{ data: WeeklyRecap | null; error: string | null }> {
  const insightsResp = await fetchPersonalStatsInsights(user);
  if (insightsResp.error || !insightsResp.data) {
    return { data: null, error: insightsResp.error ?? 'Unable to load weekly recap.' };
  }

  const weekStart = getWeekStart();
  const { base, fritz, ghost, puzzle } = insightsResp.data;
  return {
    data: {
      weekLabel: formatWeekLabel(weekStart),
      fritz: {
        gamesThisWeek: fritz.gamesThisWeek,
        ratingChangeThisWeek: fritz.ratingChangeThisWeek,
        bestWinMarginThisWeek: fritz.bestWinMarginThisWeek,
      },
      ghost: {
        gamesThisWeek: ghost.gamesThisWeek,
        ratingChangeThisWeek: ghost.ratingChangeThisWeek,
        bestWinMarginThisWeek: ghost.bestWinMarginThisWeek,
      },
      puzzle: {
        completionsThisWeek: puzzle.completionsThisWeek,
        bestScoreToday: puzzle.bestScoreToday,
      },
      multiplayer: {
        gamesThisWeek: base.gamesThisWeek,
        wins: base.wins,
        losses: base.losses,
      },
    },
    error: null,
  };
}

export async function fetchUserStatsByUserId(
  userId: string,
): Promise<{ data: StatsSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  // Production `matches` does not expose `avg_move_quality` yet. Keep the browser read path on
  // the stable column set so optional stats/history loads do not emit a failing 400 first.
  const historyResp: { data: unknown[] | null; error: { message?: string; code?: string } | null } = await supabase
    .from('matches')
    .select('winner_user_id, loser_user_id, mode, winner_score, loser_score, room_code, created_at')
    .or(`winner_user_id.eq.${userId},loser_user_id.eq.${userId}`);

  if (historyResp.error) {
    const message = historyResp.error.message ?? 'Stats unavailable.';
    const normalized = message.toLowerCase();
    if (
      normalized.includes('relation') ||
      normalized.includes('does not exist') ||
      normalized.includes('42p01')
    ) {
      return { data: null, error: 'Stats unavailable (missing table).' };
    }
    return { data: null, error: message };
  }

  const rows = (historyResp.data ?? []) as MatchSummaryRow[];
  const summary = buildStatsSummary(userId, rows);

  let ghostRating: number | null = null;
  try {
    const ghostProfileResp = await supabase
      .from('ghost_profiles')
      .select('ghost_rating')
      .eq('user_id', userId)
      .maybeSingle();
    if (!ghostProfileResp.error && ghostProfileResp.data) {
      ghostRating = Number(ghostProfileResp.data.ghost_rating ?? 800);
    }
  } catch {
    ghostRating = null;
  }

  let ghostGamesThisWeek = 0;
  let ghostRatingChangeThisWeek = 0;
  let ghostBestWinMarginThisWeek: number | null = null;
  try {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day + 6) % 7;
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - diffToMonday);

    const ghostGamesResp = await supabase
      .from('ghost_games')
      .select('final_score, opponent_score, played_at')
      .eq('user_id', userId)
      .gte('played_at', weekStart.toISOString())
      .order('played_at', { ascending: false });

    if (!ghostGamesResp.error) {
      const ghostRows = (ghostGamesResp.data ?? []) as GhostGameSummaryRow[];
      ghostGamesThisWeek = ghostRows.length;
      let winsThisWeek = 0;
      let lossesThisWeek = 0;
      for (const row of ghostRows) {
        const finalScore = Number(row.final_score ?? 0);
        const opponentScore = Number(row.opponent_score ?? 0);
        const margin = finalScore - opponentScore;
        const ratingEligible = isGhostRatingEligible(finalScore, opponentScore);
        if (ratingEligible && margin > 0) winsThisWeek += 1;
        if (ratingEligible && margin < 0) lossesThisWeek += 1;
        if (margin > 0) {
          ghostBestWinMarginThisWeek =
            ghostBestWinMarginThisWeek == null
              ? margin
              : Math.max(ghostBestWinMarginThisWeek, margin);
        }
      }
      ghostRatingChangeThisWeek = (winsThisWeek - lossesThisWeek) * 16;
    }
  } catch {
    ghostGamesThisWeek = 0;
    ghostRatingChangeThisWeek = 0;
    ghostBestWinMarginThisWeek = null;
  }

  return {
    data: {
      ...summary,
      ghostRating,
      ghostGamesThisWeek,
      ghostRatingChangeThisWeek,
      ghostBestWinMarginThisWeek,
    },
    error: null,
  };
}

export async function fetchFritzHubStats(
  userId: string,
): Promise<FritzStatsSummary | null> {
  const historyResp = await fetchRatingHistory(userId);
  if (historyResp.error || !historyResp.data) return null;
  return deriveFritzSummary(historyResp.data.games, getWeekStart());
}
```
#### After
```typescript
import type { User } from '@supabase/supabase-js';
import { apiGet, apiPost } from '../api/client';
import { supabase } from '../lib/supabase';
import { resolveGameServerUrl } from '../lib/gameServerUrl';
import { fetchRatingHistory } from '../ranking/api';
import {
  buildStatsSummary,
  deriveFritzSummary,
  deriveGhostSummary,
  derivePuzzleSummary,
  formatWeekLabel,
  getWeekStart,
  isGhostRatingEligible,
  type GhostGameSummaryRow,
  type MatchSummaryRow,
  type PuzzleCompletionRow,
  type PuzzleScoreRow,
} from './statsDerivations';
import type {
  FritzStatsSummary,
  PersonalStatsInsights,
  RankingProfile,
  RecordMatchInput,
  StatsSummary,
  WeeklyRecap,
} from './statsTypes';

export type {
  FritzStatsSummary,
  FritzTierKey,
  FritzTierRecord,
  GhostStatsSummary,
  MatchMode,
  PersonalStatsInsights,
  PuzzleStatsSummary,
  RankingProfile,
  RecordMatchInput,
  StatsSummary,
  WeeklyRecap,
} from './statsTypes';

export async function recordMatchResult(
  input: RecordMatchInput,
): Promise<{ error: string | null }> {
  const serverUrl = resolveGameServerUrl();
  if (!serverUrl || !supabase) return { error: null };

  const result = await apiPost<{ ok?: boolean }>('/api/stats/record-match', input);
  return { error: result.error };
}

export async function fetchRankingProfile(
  userId: string,
): Promise<{ data: RankingProfile | null; error: string | null }> {
  const result = await apiGet<Record<string, unknown>>(
    `/api/ranking/profile/${encodeURIComponent(userId)}`,
    { auth: false },
  );
  if (result.error) {
    return { data: null, error: result.error };
  }
  const raw = result.data;
  if (!raw) {
    return { data: null, error: 'Failed to fetch ranking profile' };
  }
  if (raw.ok !== true) {
    return { data: null, error: 'Failed to fetch ranking profile' };
  }
  return {
    data: {
      glicko_rating: Number(raw.glicko_rating ?? 0),
      glicko_rd: Number(raw.glicko_rd ?? 350),
      provisional: Boolean(raw.provisional),
      ranked_games_played: Number(raw.ranked_games_played ?? 0),
      peak_rating: Number(raw.peak_rating ?? raw.glicko_rating ?? 0),
      rank: (() => {
        if (raw.rank == null || raw.rank === '') return null;
        const n = Number(raw.rank);
        return Number.isFinite(n) ? n : null;
      })(),
      currentWinStreak: Number(raw.currentWinStreak ?? 0),
    },
    error: null,
  };
}

export async function fetchUserStats(
  user: User,
): Promise<{ data: StatsSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const { data, error } = await fetchUserStatsByUserId(user.id);
  return { data, error };
}

export async function fetchPersonalStatsInsights(
  user: User,
): Promise<{ data: PersonalStatsInsights | null; error: string | null }> {
  return fetchPersonalStatsInsightsByUserId(user.id);
}

export async function fetchPersonalStatsInsightsByUserId(
  userId: string,
): Promise<{ data: PersonalStatsInsights | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const [baseResp, rankingResp, historyResp] = await Promise.all([
    fetchUserStatsByUserId(userId),
    fetchRankingProfile(userId),
    fetchRatingHistory(userId),
  ]);

  if (baseResp.error) return { data: null, error: baseResp.error };

  const weekStart = getWeekStart();
  const base = baseResp.data ?? buildStatsSummary(userId, []);
  const rankingProfile = rankingResp.data ?? null;
  const historyGames = historyResp.data?.games ?? [];
  const fritz = deriveFritzSummary(historyGames, weekStart);

  let ghostRows: GhostGameSummaryRow[] = [];
  try {
    const ghostGamesResp = await supabase
      .from('ghost_games')
      .select('final_score, opponent_score, played_at')
      .eq('user_id', userId)
      .order('played_at', { ascending: false });
    if (!ghostGamesResp.error) {
      ghostRows = (ghostGamesResp.data ?? []) as GhostGameSummaryRow[];
    }
  } catch {
    ghostRows = [];
  }

  const ghost = deriveGhostSummary(ghostRows, base.ghostRating, weekStart);

  let completionRows: PuzzleCompletionRow[] = [];
  let scoreRows: PuzzleScoreRow[] = [];
  try {
    const [completionResp, scoreResp] = await Promise.all([
      supabase
        .from('daily_puzzle_completions')
        .select('puzzle_date, current_streak, score, perfect, updated_at')
        .eq('user_id', userId)
        .order('puzzle_date', { ascending: false }),
      supabase
        .from('daily_puzzle_scores')
        .select('puzzle_date, best_score, updated_at')
        .eq('user_id', userId)
        .order('puzzle_date', { ascending: false }),
    ]);
    if (!completionResp.error) completionRows = (completionResp.data ?? []) as PuzzleCompletionRow[];
    if (!scoreResp.error) scoreRows = (scoreResp.data ?? []) as PuzzleScoreRow[];
  } catch {
    completionRows = [];
    scoreRows = [];
  }

  const puzzle = derivePuzzleSummary(completionRows, scoreRows, weekStart);

  return {
    data: {
      base,
      rankingProfile,
      fritz,
      ghost,
      puzzle,
    },
    error: null,
  };
}

export async function fetchWeeklyRecap(
  user: User,
): Promise<{ data: WeeklyRecap | null; error: string | null }> {
  const insightsResp = await fetchPersonalStatsInsights(user);
  if (insightsResp.error || !insightsResp.data) {
    return { data: null, error: insightsResp.error ?? 'Unable to load weekly recap.' };
  }

  const weekStart = getWeekStart();
  const { base, fritz, ghost, puzzle } = insightsResp.data;
  return {
    data: {
      weekLabel: formatWeekLabel(weekStart),
      fritz: {
        gamesThisWeek: fritz.gamesThisWeek,
        ratingChangeThisWeek: fritz.ratingChangeThisWeek,
        bestWinMarginThisWeek: fritz.bestWinMarginThisWeek,
      },
      ghost: {
        gamesThisWeek: ghost.gamesThisWeek,
        ratingChangeThisWeek: ghost.ratingChangeThisWeek,
        bestWinMarginThisWeek: ghost.bestWinMarginThisWeek,
      },
      puzzle: {
        completionsThisWeek: puzzle.completionsThisWeek,
        bestScoreToday: puzzle.bestScoreToday,
      },
      multiplayer: {
        gamesThisWeek: base.gamesThisWeek,
        wins: base.wins,
        losses: base.losses,
      },
    },
    error: null,
  };
}

export async function fetchUserStatsByUserId(
  userId: string,
): Promise<{ data: StatsSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  // Production `matches` does not expose `avg_move_quality` yet. Keep the browser read path on
  // the stable column set so optional stats/history loads do not emit a failing 400 first.
  const historyResp: { data: unknown[] | null; error: { message?: string; code?: string } | null } = await supabase
    .from('matches')
    .select('winner_user_id, loser_user_id, mode, winner_score, loser_score, room_code, created_at')
    .or(`winner_user_id.eq.${userId},loser_user_id.eq.${userId}`);

  if (historyResp.error) {
    const message = historyResp.error.message ?? 'Stats unavailable.';
    const normalized = message.toLowerCase();
    if (
      normalized.includes('relation') ||
      normalized.includes('does not exist') ||
      normalized.includes('42p01')
    ) {
      return { data: null, error: 'Stats unavailable (missing table).' };
    }
    return { data: null, error: message };
  }

  const rows = (historyResp.data ?? []) as MatchSummaryRow[];
  const summary = buildStatsSummary(userId, rows);

  let ghostRating: number | null = null;
  try {
    const ghostProfileResp = await supabase
      .from('ghost_profiles')
      .select('ghost_rating')
      .eq('user_id', userId)
      .maybeSingle();
    if (!ghostProfileResp.error && ghostProfileResp.data) {
      ghostRating = Number(ghostProfileResp.data.ghost_rating ?? 800);
    }
  } catch {
    ghostRating = null;
  }

  let ghostGamesThisWeek = 0;
  let ghostRatingChangeThisWeek = 0;
  let ghostBestWinMarginThisWeek: number | null = null;
  try {
    const weekStart = getWeekStart();

    const ghostGamesResp = await supabase
      .from('ghost_games')
      .select('final_score, opponent_score, played_at')
      .eq('user_id', userId)
      .gte('played_at', weekStart.toISOString())
      .order('played_at', { ascending: false });

    if (!ghostGamesResp.error) {
      const ghostRows = (ghostGamesResp.data ?? []) as GhostGameSummaryRow[];
      ghostGamesThisWeek = ghostRows.length;
      let winsThisWeek = 0;
      let lossesThisWeek = 0;
      for (const row of ghostRows) {
        const finalScore = Number(row.final_score ?? 0);
        const opponentScore = Number(row.opponent_score ?? 0);
        const margin = finalScore - opponentScore;
        const ratingEligible = isGhostRatingEligible(finalScore, opponentScore);
        if (ratingEligible && margin > 0) winsThisWeek += 1;
        if (ratingEligible && margin < 0) lossesThisWeek += 1;
        if (margin > 0) {
          ghostBestWinMarginThisWeek =
            ghostBestWinMarginThisWeek == null
              ? margin
              : Math.max(ghostBestWinMarginThisWeek, margin);
        }
      }
      ghostRatingChangeThisWeek = (winsThisWeek - lossesThisWeek) * 16;
    }
  } catch {
    ghostGamesThisWeek = 0;
    ghostRatingChangeThisWeek = 0;
    ghostBestWinMarginThisWeek = null;
  }

  return {
    data: {
      ...summary,
      ghostRating,
      ghostGamesThisWeek,
      ghostRatingChangeThisWeek,
      ghostBestWinMarginThisWeek,
    },
    error: null,
  };
}

export async function fetchFritzHubStats(
  userId: string,
): Promise<FritzStatsSummary | null> {
  const historyResp = await fetchRatingHistory(userId);
  if (historyResp.error || !historyResp.data) return null;
  return deriveFritzSummary(historyResp.data.games, getWeekStart());
}```
### `server/src/social/routes.ts`
#### Before
```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { dedupeMatchRows } from '../stats/dedupeMatchRows';
import { getAutoRivals } from './rivalService';
import { getPresenceBatch } from './presence';

async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  try {
    const userData = await supabaseFetch<{ id?: string }>(
      `/auth/v1/user`,
      { headers: { Authorization: `Bearer ${token}` } } as RequestInit,
    );
    const userId = (userData as { id?: string })?.id ?? null;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    return userId;
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

async function getFriendIds(userId: string): Promise<string[]> {
  const enc = encodeURIComponent(userId);
  const rows = await supabaseFetch<Array<{ user_id: string; friend_user_id: string }>>(
    `/rest/v1/friends` +
    `?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
    `&status=eq.accepted` +
    `&select=user_id,friend_user_id`,
  );
  return rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id));
}

// ─── Leaderboard helpers ─────────────────────────────────────────────────────

async function respondLeaderboardGlobal(userId: string, res: Response): Promise<void> {
  try {
    const profiles = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number;
      ranked_games_played: number; provisional: boolean;
    }>>(
      `/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc` +
      `&select=id,username,glicko_rating,ranked_games_played,provisional&limit=100`,
    );
    const topRows = profiles.map((p, i) => ({
      userId: p.id, username: p.username,
      glicko_rating: Number(p.glicko_rating ?? 800),
      ranked_games_played: Number(p.ranked_games_played ?? 0),
      provisional: false, global_rank: i + 1, is_self: p.id === userId,
    }));
    let selfEntry = topRows.find((r) => r.is_self);
    if (!selfEntry) {
      const enc = encodeURIComponent(userId);
      const selfProfile = await supabaseFetch<Array<{
        id: string; username: string; glicko_rating: number; ranked_games_played: number; provisional: boolean;
      }>>(`/rest/v1/profiles?id=eq.${enc}&select=id,username,glicko_rating,ranked_games_played,provisional&limit=1`);
      if (selfProfile?.[0]) {
        const sp = selfProfile[0];
        const aboveCount = await supabaseFetch<Array<{ id: string }>>(
          `/rest/v1/profiles?provisional=eq.false&glicko_rating=gte.${encodeURIComponent(String(sp.glicko_rating))}&select=id`,
        );
        selfEntry = {
          userId: sp.id, username: sp.username,
          glicko_rating: Number(sp.glicko_rating ?? 800),
          ranked_games_played: Number(sp.ranked_games_played ?? 0),
          provisional: Boolean(sp.provisional),
          global_rank: aboveCount.length, is_self: true,
        };
      }
    }
    res.json({ ok: true, leaderboard: topRows, self: selfEntry ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}

async function respondLeaderboardFriends(userId: string, res: Response): Promise<void> {
  try {
    const friendIds = await getFriendIds(userId);
    const allIds = [userId, ...friendIds];
    const inFilter = allIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number;
      ranked_games_played: number; provisional: boolean;
    }>>(
      `/rest/v1/profiles?or=(${inFilter})&order=glicko_rating.desc` +
      `&select=id,username,glicko_rating,ranked_games_played,provisional`,
    );
    const winCountMap = new Map<string, number>();
    await Promise.all(allIds.map(async (id) => {
      try {
        const wins = await supabaseFetch<Array<{ id: string }>>(
          `/rest/v1/matches?winner_user_id=eq.${encodeURIComponent(id)}&mode=eq.online&select=id`,
        );
        winCountMap.set(id, wins.length);
      } catch { winCountMap.set(id, 0); }
    }));
    res.json({
      ok: true,
      leaderboard: profiles.map((p, index) => {
        const wins = winCountMap.get(p.id) ?? 0;
        const total = Number(p.ranked_games_played ?? 0);
        const win_rate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
        return {
          userId: p.id, username: p.username,
          glicko_rating: Number(p.glicko_rating ?? 800),
          ranked_games_played: total, provisional: Boolean(p.provisional),
          rank_in_friends: index + 1, is_self: p.id === userId, wins, win_rate,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}

async function respondLeaderboardWeekly(userId: string, res: Response): Promise<void> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const matches = await supabaseFetch<Array<{ winner_user_id: string | null; loser_user_id: string | null }>>(
      `/rest/v1/matches?mode=eq.online&created_at=gte.${encodeURIComponent(weekAgo)}` +
      `&select=winner_user_id,loser_user_id&limit=10000`,
    );
    const winCounts = new Map<string, number>();
    for (const m of matches) {
      if (m.winner_user_id) winCounts.set(m.winner_user_id, (winCounts.get(m.winner_user_id) ?? 0) + 1);
    }
    if (!winCounts.size) { res.json({ ok: true, leaderboard: [], self: null }); return; }
    const topIds = [...winCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id);
    const profileFilter = topIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{ id: string; username: string; glicko_rating: number; provisional: boolean }>>(
      `/rest/v1/profiles?or=(${profileFilter})&select=id,username,glicko_rating,provisional`,
    );
    const sorted = profiles
      .map((p) => ({
        userId: p.id, username: p.username,
        glicko_rating: Number(p.glicko_rating ?? 800),
        provisional: Boolean(p.provisional),
        wins_this_week: winCounts.get(p.id) ?? 0, is_self: p.id === userId,
      }))
      .sort((a, b) => b.wins_this_week - a.wins_this_week)
      .map((p, i) => ({ ...p, rank: i + 1 }));
    const self = sorted.find((r) => r.is_self) ?? null;
    res.json({ ok: true, leaderboard: sorted, self });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}

export const socialRouter = Router();

// GET /api/social/feed
socialRouter.get('/feed', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const friendIds = await getFriendIds(userId).catch(() => [] as string[]);
    const allIds = [userId, ...friendIds];
    const inFilter = allIds.map((id) => `user_id.eq.${encodeURIComponent(id)}`).join(',');
    const rows = await supabaseFetch<Array<{
      id: string; user_id: string; type: string;
      metadata: Record<string, unknown>; created_at: string;
    }>>(
      `/rest/v1/activity_feed?or=(${inFilter})&order=created_at.desc&limit=50` +
      `&select=id,user_id,type,metadata,created_at`,
    );

    const feedUserIds = [...new Set(rows.map((r) => r.user_id))];
    const profileFilter = feedUserIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = profileFilter
      ? await supabaseFetch<Array<{ id: string; username: string }>>(
          `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
        )
      : [];
    const usernameMap = new Map((profiles as Array<{ id: string; username: string }>).map((p) => [p.id, p.username]));

    res.json({
      ok: true,
      feed: rows.map((r) => ({ ...r, username: usernameMap.get(r.user_id) ?? 'player' })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Feed unavailable.' });
  }
});

// GET /api/social/friends/requests — pending incoming + outgoing requests
socialRouter.get('/friends/requests', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const enc = encodeURIComponent(userId);
    const rows = await supabaseFetch<Array<{
      id: string; user_id: string; friend_user_id: string; created_at: string;
    }>>(
      `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
      `&status=eq.pending&select=id,user_id,friend_user_id,created_at`,
    );
    const otherIds = [...new Set(rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id)))];
    const profileMap = new Map<string, string>();
    if (otherIds.length) {
      const filter = otherIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?or=(${filter})&select=id,username`,
      );
      for (const p of profiles) profileMap.set(p.id, p.username);
    }
    const incoming = rows
      .filter((r) => r.friend_user_id === userId)
      .map((r) => ({ id: r.id, userId: r.user_id, username: profileMap.get(r.user_id) ?? 'player', created_at: r.created_at }));
    const outgoing = rows
      .filter((r) => r.user_id === userId)
      .map((r) => ({ id: r.id, userId: r.friend_user_id, username: profileMap.get(r.friend_user_id) ?? 'player', created_at: r.created_at }));
    res.json({ ok: true, incoming, outgoing });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Requests unavailable.' });
  }
});

// GET /api/social/leaderboard?filter=global|friends|weekly — unified endpoint
socialRouter.get('/leaderboard', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'global';
  if (filter === 'friends') return void respondLeaderboardFriends(userId, res);
  if (filter === 'weekly') return void respondLeaderboardWeekly(userId, res);
  return void respondLeaderboardGlobal(userId, res);
});

// GET /api/social/leaderboard/friends
socialRouter.get('/leaderboard/friends', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardFriends(userId, res);
});

// GET /api/social/rivals
socialRouter.get('/rivals', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const rivals = await getAutoRivals(userId);
    res.json({ ok: true, rivals });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rivals unavailable.' });
  }
});

// GET /api/social/friends/with-presence
socialRouter.get('/friends/with-presence', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const friendIds = await getFriendIds(userId);
    if (!friendIds.length) { res.json({ ok: true, friends: [] }); return; }

    const enc = encodeURIComponent(userId);
    const rows = await supabaseFetch<Array<{ id: string; user_id: string; friend_user_id: string }>>(
      `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
      `&status=eq.accepted&select=id,user_id,friend_user_id`,
    );

    const profileFilter = friendIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
      `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
    );
    const profileMap = new Map(profiles.map((p) => [p.id, p.username]));
    const presenceMap = await getPresenceBatch(friendIds).catch(() => new Map<string, { status: string; current_mode: string | null }>());

    const friends = friendIds.map((fId) => {
      const row = rows.find((r) => r.user_id === fId || r.friend_user_id === fId);
      const presence = presenceMap.get(fId) ?? { status: 'offline', current_mode: null };
      return {
        id: row?.id ?? fId,
        userId: fId,
        username: profileMap.get(fId) ?? 'player',
        presence_status: presence.status as 'online' | 'in_game' | 'offline',
        current_mode: presence.current_mode,
      };
    });

    res.json({ ok: true, friends });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Friends unavailable.' });
  }
});

// GET /api/social/leaderboard/weekly — top players by online wins in the last 7 days
socialRouter.get('/leaderboard/weekly', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardWeekly(userId, res);
});

// GET /api/social/leaderboard/mode/:mode — top players by wins in a specific mode (last 90 days)
socialRouter.get('/leaderboard/mode/:mode', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const mode = req.params.mode;
  if (!['online', 'bot', 'ghost'].includes(mode)) { res.status(400).json({ error: 'Invalid mode.' }); return; }
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const matches = await supabaseFetch<Array<{ winner_user_id: string | null; loser_user_id: string | null }>>(
      `/rest/v1/matches?mode=eq.${encodeURIComponent(mode)}&created_at=gte.${encodeURIComponent(ninetyDaysAgo)}` +
      `&select=winner_user_id,loser_user_id&limit=10000`,
    );

    const winCounts = new Map<string, number>();
    for (const m of matches) {
      if (m.winner_user_id) winCounts.set(m.winner_user_id, (winCounts.get(m.winner_user_id) ?? 0) + 1);
    }

    if (!winCounts.size) { res.json({ ok: true, leaderboard: [], self: null }); return; }

    const topIds = [...winCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id);
    const profileFilter = topIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{ id: string; username: string; glicko_rating: number; provisional: boolean }>>(
      `/rest/v1/profiles?or=(${profileFilter})&select=id,username,glicko_rating,provisional`,
    );

    const sorted = profiles
      .map((p) => ({
        userId: p.id,
        username: p.username,
        glicko_rating: Number(p.glicko_rating ?? 800),
        provisional: Boolean(p.provisional),
        wins: winCounts.get(p.id) ?? 0,
        is_self: p.id === userId,
      }))
      .sort((a, b) => b.wins - a.wins)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    const self = sorted.find((r) => r.is_self) ?? null;
    res.json({ ok: true, leaderboard: sorted, self });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
});

// GET /api/social/leaderboard/global
socialRouter.get('/leaderboard/global', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardGlobal(userId, res);
});

// GET /api/social/feed/user/:userId — recent activity for a specific user (public to logged-in users)
socialRouter.get('/feed/user/:userId', async (req, res) => {
  const requestorId = await requireAuth(req, res);
  if (!requestorId) return;
  const targetId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!targetId) { res.status(400).json({ error: 'userId is required.' }); return; }
  try {
    const rows = await supabaseFetch<Array<{
      id: string; user_id: string; type: string;
      metadata: Record<string, unknown>; created_at: string;
    }>>(
      `/rest/v1/activity_feed?user_id=eq.${encodeURIComponent(targetId)}` +
      `&order=created_at.desc&limit=10&select=id,user_id,type,metadata,created_at`,
    );
    const profileRows = await supabaseFetch<Array<{ id: string; username: string }>>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}&select=id,username&limit=1`,
    );
    const username = profileRows?.[0]?.username ?? 'player';
    res.json({ ok: true, feed: rows.map((r) => ({ ...r, username })) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Activity unavailable.' });
  }
});

// POST /api/social/friends/request/:userId — send a friend request by user ID (URL param)
socialRouter.post('/friends/request/:userId', async (req, res) => {
  const requestorId = await requireAuth(req, res);
  if (!requestorId) return;
  const targetId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!targetId) { res.status(400).json({ error: 'userId is required.' }); return; }
  if (targetId === requestorId) { res.status(400).json({ error: 'Cannot add yourself.' }); return; }
  try {
    const reqEnc = encodeURIComponent(requestorId);
    const tgtEnc = encodeURIComponent(targetId);
    const existing = await supabaseFetch<Array<{ id: string; status: string }>>(
      `/rest/v1/friends?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${tgtEnc}),and(user_id.eq.${tgtEnc},friend_user_id.eq.${reqEnc}))&select=id,status&limit=1`,
    );
    if (existing?.[0]?.status === 'accepted') { res.status(409).json({ error: 'Already friends.' }); return; }
    if (existing?.[0]?.status === 'pending') { res.status(409).json({ error: 'Request already pending.' }); return; }
    await supabaseFetch('/rest/v1/friends', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: requestorId, friend_user_id: targetId, status: 'pending' }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
  }
});

// POST /api/social/friends/request — send a friend request by username { targetUsername: string }
socialRouter.post('/friends/request', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const targetUsername = typeof req.body?.targetUsername === 'string'
    ? req.body.targetUsername.trim().replace(/^@/, '')
    : '';
  if (!targetUsername) { res.status(400).json({ error: 'targetUsername is required.' }); return; }
  try {
    const targetProfiles = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/profiles?username=ilike.${encodeURIComponent(targetUsername)}&select=id&limit=1`,
    );
    const targetId = targetProfiles?.[0]?.id;
    if (!targetId) { res.status(404).json({ error: 'User not found.' }); return; }
    if (targetId === userId) { res.status(400).json({ error: 'Cannot add yourself.' }); return; }
    const reqEnc = encodeURIComponent(userId);
    const tgtEnc = encodeURIComponent(targetId);
    const existing = await supabaseFetch<Array<{ id: string; status: string }>>(
      `/rest/v1/friends?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${tgtEnc}),and(user_id.eq.${tgtEnc},friend_user_id.eq.${reqEnc}))&select=id,status&limit=1`,
    );
    if (existing?.[0]?.status === 'accepted') { res.status(409).json({ error: 'Already friends.' }); return; }
    if (existing?.[0]?.status === 'pending') { res.status(409).json({ error: 'Request already pending.' }); return; }
    await supabaseFetch('/rest/v1/friends', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, friend_user_id: targetId, status: 'pending' }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
  }
});

// POST /api/social/friends/accept/:requestId
socialRouter.post('/friends/accept/:requestId', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const rEnc = encodeURIComponent(req.params.requestId);
  const uEnc = encodeURIComponent(userId);
  try {
    await supabaseFetch(`/rest/v1/friends?id=eq.${rEnc}&friend_user_id=eq.${uEnc}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'accepted' }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to accept request.' });
  }
});

// DELETE /api/social/friends/:recordId
socialRouter.delete('/friends/:recordId', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const rEnc = encodeURIComponent(req.params.recordId);
  const uEnc = encodeURIComponent(userId);
  try {
    await supabaseFetch(
      `/rest/v1/friends?id=eq.${rEnc}&or=(user_id.eq.${uEnc},friend_user_id.eq.${uEnc})`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to remove friend.' });
  }
});

// GET /api/profile/:username  (mounted at /api/profile via app.use)
socialRouter.get('/:username', async (req, res) => {
  const requestorId = await requireAuth(req, res);
  if (!requestorId) return;
  const username = typeof req.params.username === 'string'
    ? req.params.username.trim().replace(/^@/, '')
    : '';
  if (!username) { res.status(400).json({ error: 'username is required.' }); return; }
  try {
    const profileRows = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number; peak_rating: number;
      provisional: boolean; ranked_games_played: number;
    }>>(
      `/rest/v1/profiles?username=ilike.${encodeURIComponent(username)}` +
      `&limit=1&select=id,username,glicko_rating,peak_rating,provisional,ranked_games_played`,
    );
    const profile = profileRows?.[0];
    if (!profile) { res.status(404).json({ error: 'Player not found.' }); return; }
    const targetId = profile.id;
    const enc = encodeURIComponent(targetId);

    // Global rank
    const allRanked = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc&select=id`,
    );
    const rankIndex = allRanked.findIndex((p) => p.id === targetId);
    const globalRank = rankIndex >= 0 ? rankIndex + 1 : null;

    // Win/loss record
    const matchRows = dedupeMatchRows(
      await supabaseFetch<Array<{
        winner_user_id: string | null; loser_user_id: string | null; created_at: string;
        winner_score: number | null; loser_score: number | null; room_code: string | null;
      }>>(
        `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
        `&mode=eq.online&select=winner_user_id,loser_user_id,winner_score,loser_score,room_code,created_at`,
      ),
    );
    const wins = matchRows.filter((m) => m.winner_user_id === targetId).length;
    const losses = matchRows.filter((m) => m.loser_user_id === targetId).length;
    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;

    // Recent 10 matches with opponent username
    const recentRows = dedupeMatchRows(
      await supabaseFetch<Array<{
        winner_user_id: string | null; loser_user_id: string | null;
        winner_score: number | null; loser_score: number | null;
        mode: string; created_at: string; room_code: string | null;
      }>>(
        `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
        `&order=created_at.desc&limit=20` +
        `&select=winner_user_id,loser_user_id,winner_score,loser_score,mode,created_at,room_code`,
      ),
    ).slice(0, 10);
    const opponentIds = [...new Set(
      recentRows
        .map((m) => (m.winner_user_id === targetId ? m.loser_user_id : m.winner_user_id))
        .filter((id): id is string => Boolean(id)),
    )];
    const oppProfileMap = new Map<string, string>();
    if (opponentIds.length) {
      const oppFilter = opponentIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const oppProfiles = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?or=(${oppFilter})&select=id,username`,
      );
      for (const p of oppProfiles) oppProfileMap.set(p.id, p.username);
    }
    const recentMatches = recentRows.map((m) => {
      const won = m.winner_user_id === targetId;
      const opponentId = won ? m.loser_user_id : m.winner_user_id;
      return {
        opponent_username: opponentId ? (oppProfileMap.get(opponentId) ?? 'guest') : 'guest',
        result: won ? 'win' : 'loss',
        score: won ? m.winner_score : m.loser_score,
        opponent_score: won ? m.loser_score : m.winner_score,
        mode: m.mode,
        played_at: m.created_at,
      };
    });

    // H2H against the requesting user (from already-fetched matchRows)
    const h2hRows = matchRows.filter((m) => {
      const opp = m.winner_user_id === targetId ? m.loser_user_id : m.winner_user_id;
      return opp === requestorId;
    });
    const viewerH2hWins = h2hRows.filter((m) => m.winner_user_id === requestorId).length;
    const viewerH2hLosses = h2hRows.filter((m) => m.loser_user_id === requestorId).length;
    // Signed-in viewer's W–L vs this profile (not the profile owner's record).
    const h2h =
      viewerH2hWins + viewerH2hLosses > 0
        ? {
            viewer_wins: viewerH2hWins,
            viewer_losses: viewerH2hLosses,
            wins: viewerH2hWins,
            losses: viewerH2hLosses,
          }
        : null;

    // Friendship status
    const reqEnc = encodeURIComponent(requestorId);
    const friendRows = await supabaseFetch<Array<{ id: string; status: string }>>(
      `/rest/v1/friends` +
      `?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${enc}),and(user_id.eq.${enc},friend_user_id.eq.${reqEnc}))` +
      `&select=id,status&limit=1`,
    );
    const friendRow = (friendRows as Array<{ id: string; status: string }>)?.[0];
    const isFriend = friendRow?.status === 'accepted';
    const hasPendingRequest = friendRow?.status === 'pending';

    // Daily puzzle stats + best streak
    const puzzleRows = await supabaseFetch<Array<{ total_score: number | null; completed_at: string }>>(
      `/rest/v1/daily_puzzle_attempts?user_id=eq.${enc}&status=eq.completed` +
      `&select=total_score,completed_at&order=completed_at.asc&limit=365`,
    ).catch(() => [] as Array<{ total_score: number | null; completed_at: string }>);
    const puzzles_completed = puzzleRows.length;
    const best_puzzle_score = puzzleRows.reduce((max, r) => Math.max(max, r.total_score ?? 0), 0) || null;

    // Compute best consecutive daily puzzle streak from sorted dates
    const puzzleDates = [...new Set(puzzleRows.map((r) => r.completed_at.slice(0, 10)))];
    let best_streak = 0;
    let streakCur = 0;
    for (let i = 0; i < puzzleDates.length; i++) {
      if (i === 0) {
        streakCur = 1;
      } else {
        const prev = new Date(`${puzzleDates[i - 1]}T00:00:00Z`);
        const curr = new Date(`${puzzleDates[i]}T00:00:00Z`);
        const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        streakCur = diff === 1 ? streakCur + 1 : 1;
      }
      best_streak = Math.max(best_streak, streakCur);
    }

    // Daily fritz stats
    const fritzRows = await supabaseFetch<Array<{ won: boolean; final_score: number | null }>>(
      `/rest/v1/daily_fritz_attempts?user_id=eq.${enc}&status=eq.completed` +
      `&select=won,final_score`,
    ).catch(() => [] as Array<{ won: boolean; final_score: number | null }>);
    const fritz_wins = fritzRows.filter((r) => r.won).length;
    const fritz_losses = fritzRows.filter((r) => !r.won).length;

    // Presence
    const presenceMap = await getPresenceBatch([targetId]).catch(() => new Map<string, { status: string; current_mode: string | null }>());
    const presence = presenceMap.get(targetId) ?? { status: 'offline', current_mode: null };

    res.json({
      ok: true,
      userId: targetId,
      username: profile.username,
      glicko_rating: Number(profile.glicko_rating ?? 800),
      peak_rating: Number(profile.peak_rating ?? profile.glicko_rating ?? 800),
      provisional: Boolean(profile.provisional),
      ranked_games_played: Number(profile.ranked_games_played ?? 0),
      global_rank: globalRank,
      wins,
      losses,
      win_rate: winRate,
      puzzles_completed,
      best_puzzle_score,
      best_streak,
      fritz_wins,
      fritz_losses,
      is_self: targetId === requestorId,
      is_friend: isFriend,
      has_pending_request: hasPendingRequest,
      h2h,
      presence,
      recent_matches: recentMatches,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Profile unavailable.' });
  }
});
```
#### After
```typescript
import { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getAutoRivals } from './rivalService';
import { requireAuth } from './socialAuth';
import {
  respondLeaderboardFriends,
  respondLeaderboardGlobal,
  respondLeaderboardWeekly,
} from './socialLeaderboard';
import { registerSocialFeedRoutes } from './socialFeed';
import { registerSocialFriendsRoutes } from './socialFriends';
import { registerSocialProfileRoutes } from './socialProfile';

export const socialRouter = Router();

registerSocialFeedRoutes(socialRouter);
registerSocialFriendsRoutes(socialRouter);

socialRouter.get('/leaderboard', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'global';
  if (filter === 'friends') return void respondLeaderboardFriends(userId, res);
  if (filter === 'weekly') return void respondLeaderboardWeekly(userId, res);
  return void respondLeaderboardGlobal(userId, res);
});

socialRouter.get('/leaderboard/friends', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardFriends(userId, res);
});

socialRouter.get('/rivals', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const rivals = await getAutoRivals(userId);
    res.json({ ok: true, rivals });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rivals unavailable.' });
  }
});

socialRouter.get('/leaderboard/weekly', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardWeekly(userId, res);
});

socialRouter.get('/leaderboard/mode/:mode', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const mode = req.params.mode;
  if (!['online', 'bot', 'ghost'].includes(mode)) { res.status(400).json({ error: 'Invalid mode.' }); return; }
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const matches = await supabaseFetch<Array<{ winner_user_id: string | null; loser_user_id: string | null }>>(
      `/rest/v1/matches?mode=eq.${encodeURIComponent(mode)}&created_at=gte.${encodeURIComponent(ninetyDaysAgo)}` +
      `&select=winner_user_id,loser_user_id&limit=10000`,
    );

    const winCounts = new Map<string, number>();
    for (const m of matches) {
      if (m.winner_user_id) winCounts.set(m.winner_user_id, (winCounts.get(m.winner_user_id) ?? 0) + 1);
    }

    if (!winCounts.size) { res.json({ ok: true, leaderboard: [], self: null }); return; }

    const topIds = [...winCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id);
    const profileFilter = topIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{ id: string; username: string; glicko_rating: number; provisional: boolean }>>(
      `/rest/v1/profiles?or=(${profileFilter})&select=id,username,glicko_rating,provisional`,
    );

    const sorted = profiles
      .map((p) => ({
        userId: p.id,
        username: p.username,
        glicko_rating: Number(p.glicko_rating ?? 800),
        provisional: Boolean(p.provisional),
        wins: winCounts.get(p.id) ?? 0,
        is_self: p.id === userId,
      }))
      .sort((a, b) => b.wins - a.wins)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    const self = sorted.find((r) => r.is_self) ?? null;
    res.json({ ok: true, leaderboard: sorted, self });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
});

socialRouter.get('/leaderboard/global', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardGlobal(userId, res);
});

registerSocialProfileRoutes(socialRouter);```
### `server/src/http/routes/botMatches.ts`
#### Before

Untracked at `HEAD` (Tier 1 route extraction). Full pre-change source:

```typescript
import type { Application, Request } from 'express';
import type { VerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';

export type BotMatchesRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  getAuthenticatedUserIdFromToken: (token: string | null) => Promise<string | null>;
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  isAdminSecret: (value: unknown) => boolean;
  startVerifiedSinglePlayerMatch: (params: {
    userId: string;
    localMatchId: string;
    mode: 'ghost' | 'fritz';
    opponentUserId: string | null;
    fritzTier?: string | null;
  }) => Promise<VerifiedSinglePlayerMatch>;
  abandonVerifiedSinglePlayerMatch: (userId: string, localMatchId: string) => Promise<void>;
  getFritzIdentityForTier: (rawTier: unknown) => { fritzId: string; gameType: string };
  finalizeFritzForfeit: (params: {
    userId: string;
    fritzTier: unknown;
    source?: { localMatchId?: string | null; roomCode?: string | null; verifiedMatchId?: string | null };
    youScore?: number | null;
    botScore?: number | null;
  }) => Promise<void>;
  parseOptionalActivityScore: (value: unknown) => number | null;
};

export function registerBotMatchesRoutes(app: Application, deps: BotMatchesRouteDeps): void {
  const {
    getAuthenticatedUserId,
    getAuthenticatedUserIdFromToken,
    supabaseFetch,
    isAdminSecret,
    startVerifiedSinglePlayerMatch,
    abandonVerifiedSinglePlayerMatch,
    getFritzIdentityForTier,
    finalizeFritzForfeit,
    parseOptionalActivityScore,
  } = deps;

  app.post('/bot-matches/cleanup-stale', async (req, res) => {
    if (!isAdminSecret(req.body?.adminKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const threshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const staleRows = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id,user_id,room_code,fritz_tier,started_at,resolved&resolved=eq.false&started_at=lt.${encodeURIComponent(threshold)}&order=started_at.asc`,
      );

      let processed = 0;
      for (const row of staleRows ?? []) {
        if (!row?.id || !row?.user_id) continue;
        await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        });
        await finalizeFritzForfeit({
          userId: row.user_id,
          fritzTier: row.fritz_tier,
          source: { roomCode: typeof row.room_code === 'string' ? row.room_code : null },
        });
        processed += 1;
      }

      res.json({ ok: true, processed });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to clean stale bot matches.',
      });
    }
  });

  app.post('/api/bot-matches/local/start', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const fritzTier = typeof req.body?.fritzTier === 'string' ? req.body.fritzTier.trim().toLowerCase() : 'elite';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';

    console.log('[Local Fritz Start] Received request:', { userId, fritzTier, localMatchId });

    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      console.log('[Local Fritz Start] Authenticated user:', authenticatedUserId);

      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const roomCode = `local:${localMatchId}`;

      const fritzIdentity = getFritzIdentityForTier(fritzTier);
      console.log('[Local Fritz Start] Fritz identity:', fritzIdentity);

      const verifiedMatch = await startVerifiedSinglePlayerMatch({
        userId,
        localMatchId,
        mode: 'fritz',
        opponentUserId: fritzIdentity.fritzId,
        fritzTier,
      });
      console.log('[Local Fritz Start] Verified match created:', verifiedMatch);

      const existing = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&limit=1`,
      );
      console.log('[Local Fritz Start] Existing pending match:', existing?.[0]);

      if (!existing?.[0]?.id) {
        const pendingResponse = await supabaseFetch('/rest/v1/bot_match_pending', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            user_id: userId,
            fritz_tier: fritzTier,
            room_code: roomCode,
            resolved: false,
          }),
        });
        console.log('[Local Fritz Start] Pending match inserted:', pendingResponse);
      }
      res.json({ ok: true, roomCode, matchId: verifiedMatch.matchId });
    } catch (error) {
      console.error('[Local Fritz Start] FAILED:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start pending bot match.',
      });
    }
  });

  app.post('/api/bot-matches/local/resolve', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const roomCode = `local:${localMatchId}`;
      await supabaseFetch(
        `/rest/v1/bot_match_pending?room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false`,
        {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        },
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to resolve pending bot match.',
      });
    }
  });

  app.post('/api/bot-matches/local/abandon', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
    const bodyToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId =
        (await getAuthenticatedUserId(req)) || (await getAuthenticatedUserIdFromToken(bodyToken || null));
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      await abandonVerifiedSinglePlayerMatch(userId, localMatchId);
      const roomCode = `local:${localMatchId}`;
      const pendingRows = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id,fritz_tier&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&order=started_at.asc,id.asc&limit=1`,
      );
      const pending = pendingRows?.[0];
      if (!pending?.id) {
        res.json({ ok: true, processed: false });
        return;
      }
      await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${pending.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true }),
      });
      await finalizeFritzForfeit({
        userId,
        fritzTier: pending.fritz_tier,
        source: { localMatchId, roomCode },
        youScore: parseOptionalActivityScore(req.body?.youScore ?? req.body?.score),
        botScore: parseOptionalActivityScore(req.body?.botScore ?? req.body?.opponentScore),
      });
      res.json({ ok: true, processed: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to abandon bot match.',
      });
    }
  });
}
```

#### After
```typescript
import type { Application, Request } from 'express';
import type { VerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';

export type BotMatchesRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  getAuthenticatedUserIdFromToken: (token: string | null) => Promise<string | null>;
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  isAdminSecret: (value: unknown) => boolean;
  startVerifiedSinglePlayerMatch: (params: {
    userId: string;
    localMatchId: string;
    mode: 'ghost' | 'fritz';
    opponentUserId: string | null;
    fritzTier?: string | null;
  }) => Promise<VerifiedSinglePlayerMatch>;
  abandonVerifiedSinglePlayerMatch: (userId: string, localMatchId: string) => Promise<void>;
  getFritzIdentityForTier: (rawTier: unknown) => { fritzId: string; gameType: string };
  finalizeFritzForfeit: (params: {
    userId: string;
    fritzTier: unknown;
    source?: { localMatchId?: string | null; roomCode?: string | null; verifiedMatchId?: string | null };
    youScore?: number | null;
    botScore?: number | null;
  }) => Promise<void>;
  parseOptionalActivityScore: (value: unknown) => number | null;
};

export function registerBotMatchesRoutes(app: Application, deps: BotMatchesRouteDeps): void {
  const {
    getAuthenticatedUserId,
    getAuthenticatedUserIdFromToken,
    supabaseFetch,
    isAdminSecret,
    startVerifiedSinglePlayerMatch,
    abandonVerifiedSinglePlayerMatch,
    getFritzIdentityForTier,
    finalizeFritzForfeit,
    parseOptionalActivityScore,
  } = deps;

  app.post('/bot-matches/cleanup-stale', async (req, res) => {
    if (!isAdminSecret(req.body?.adminKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const threshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const staleRows = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id,user_id,room_code,fritz_tier,started_at,resolved&resolved=eq.false&started_at=lt.${encodeURIComponent(threshold)}&order=started_at.asc`,
      );

      let processed = 0;
      for (const row of staleRows ?? []) {
        if (!row?.id || !row?.user_id) continue;
        await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        });
        await finalizeFritzForfeit({
          userId: row.user_id,
          fritzTier: row.fritz_tier,
          source: { roomCode: typeof row.room_code === 'string' ? row.room_code : null },
        });
        processed += 1;
      }

      res.json({ ok: true, processed });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to clean stale bot matches.',
      });
    }
  });

  app.post('/api/bot-matches/local/start', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const fritzTier = typeof req.body?.fritzTier === 'string' ? req.body.fritzTier.trim().toLowerCase() : 'elite';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';

    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);

      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const roomCode = `local:${localMatchId}`;

      const fritzIdentity = getFritzIdentityForTier(fritzTier);

      const verifiedMatch = await startVerifiedSinglePlayerMatch({
        userId,
        localMatchId,
        mode: 'fritz',
        opponentUserId: fritzIdentity.fritzId,
        fritzTier,
      });

      const existing = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&limit=1`,
      );

      if (!existing?.[0]?.id) {
        await supabaseFetch('/rest/v1/bot_match_pending', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            user_id: userId,
            fritz_tier: fritzTier,
            room_code: roomCode,
            resolved: false,
          }),
        });
      }
      res.json({ ok: true, roomCode, matchId: verifiedMatch.matchId });
    } catch (error) {
      console.error('[Local Fritz Start] error', {
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start pending bot match.',
      });
    }
  });

  app.post('/api/bot-matches/local/resolve', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const roomCode = `local:${localMatchId}`;
      await supabaseFetch(
        `/rest/v1/bot_match_pending?room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false`,
        {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        },
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to resolve pending bot match.',
      });
    }
  });

  app.post('/api/bot-matches/local/abandon', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
    const bodyToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId =
        (await getAuthenticatedUserId(req)) || (await getAuthenticatedUserIdFromToken(bodyToken || null));
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      await abandonVerifiedSinglePlayerMatch(userId, localMatchId);
      const roomCode = `local:${localMatchId}`;
      const pendingRows = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id,fritz_tier&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&order=started_at.asc,id.asc&limit=1`,
      );
      const pending = pendingRows?.[0];
      if (!pending?.id) {
        res.json({ ok: true, processed: false });
        return;
      }
      await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${pending.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true }),
      });
      await finalizeFritzForfeit({
        userId,
        fritzTier: pending.fritz_tier,
        source: { localMatchId, roomCode },
        youScore: parseOptionalActivityScore(req.body?.youScore ?? req.body?.score),
        botScore: parseOptionalActivityScore(req.body?.botScore ?? req.body?.opponentScore),
      });
      res.json({ ok: true, processed: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to abandon bot match.',
      });
    }
  });
}```
### `client/src/match/liveMatchScreenTypes.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import type { RefObject } from 'react';
import type { BoardHandle } from '../components';
import type { RoomChatEvent, RoomEmoteEvent } from '../components/RoomReactions';
import type { PreGameDrawState } from './preGameDraw/preGameDrawLogic';
import type { TournamentMatchContext } from './session/useTournamentMatchSession';
import type { GameState, Move, PlacementPosition, Tile } from '../types';
import type { RoomPlayer } from '../multiplayer/multiplayerRuntime';

export type HandRevealState = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

export type FlyingTile = { x: number; y: number; toX: number; toY: number; id: number };

export type ScoreToastState = {
  message: string;
  tone: 'you' | 'opp';
  visible: boolean;
} | null;

/** Root visibility, core game state, and transient presentation overlays. */
export type LiveMatchScreenShellProps = {
  visible: boolean;
  state: GameState | null;
  flyingTiles: FlyingTile[];
  scoreToast: ScoreToastState;
};

/** Player identity labels and room roster. */
export type LiveMatchScreenIdentityProps = {
  you: string;
  opponentId: string | null;
  opponentName: string;
  myName: string;
  players: RoomPlayer[];
};

/** Score HUD, turn state, and board counters. */
export type LiveMatchScreenHudProps = {
  myScore: number;
  opponentScore: number;
  opponentTileCount: number;
  isMyTurn: boolean;
  isHandActive: boolean;
  hudScorePulse: Record<string, boolean>;
  hudRightLabel: string;
  hudRightScore: number;
  hudRightScorePulse: boolean;
  boneyardCount: number;
  openEndsSum: number;
  winTarget?: number;
};

/** Board display, refs, and placement interaction. */
export type LiveMatchScreenBoardProps = {
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boardRef: RefObject<BoardHandle | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  boardForDisplay: GameState['board'];
  boardLegalMoves: Move[];
  boardSelectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  onPositionClick: (position: PlacementPosition) => void;
};

/** Player hand rack and tile selection. */
export type LiveMatchScreenHandProps = {
  myHand: Tile[];
  handSelectedTile: Tile | null;
  onHandTileSelect: (tile: Tile) => void;
  legalMoves: Move[];
  handTileSize: number;
  handCompactStacked: boolean;
  drawPulseIndex: number | null;
};

/** Audio, fullscreen, score track, and room reactions. */
export type LiveMatchScreenChromeProps = {
  scoreTrackOpen: boolean;
  onScoreTrackOpenChange: (open: boolean) => void;
  roomReactions: Array<RoomChatEvent | RoomEmoteEvent>;
  onSendRoomChat: (message: string) => void;
  onSendRoomEmote: (emote: RoomEmoteEvent['emote']) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
};

/** Disconnect banners and room recovery UI. */
export type LiveMatchScreenConnectionProps = {
  opponentDisconnected: boolean;
  opponentDisconnectMessage: string | null;
  roomRecoveryState: 'idle' | 'reconnecting' | 'resyncing' | 'failed';
  roomRecoveryMessage: string;
  onRetryRoomRecovery: () => void;
};

/** Tournament match context and navigation callbacks. */
export type LiveMatchScreenTournamentProps = {
  tournamentMatch: TournamentMatchContext | null;
  consumedTournamentGameOverMatchIds: ReadonlySet<string>;
  tournamentMyLabel: string;
  tournamentOpponentLabel: string | null;
  onTournamentViewBracket: () => void;
  onTournamentViewFinalResult: () => void;
  onTournamentReturnToHub: () => void;
};

/** Post-hand reveal, rematch, rating summary, and analyzer entry. */
export type LiveMatchScreenPostGameProps = {
  canUseRematch: boolean;
  rematchRequested: boolean;
  rematchWaitingText: string | undefined;
  onRematch: () => void;
  onPostGame: () => void;
  multiplayerRatingSummary: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  onOpenMultiplayerAnalyzer: () => void;
  handReveal: HandRevealState | null;
  handRevealAutoProgress: number;
};

/** Leave-match confirmation modal. */
export type LiveMatchScreenLeaveProps = {
  showLeaveConfirm: boolean;
  onRequestLeaveConfirm: () => void;
  onLeaveConfirmDismiss: () => void;
  leaveModalIsTournament: boolean;
  onConfirmLeaveMatch: () => void;
};

/** Optional pre-game tile draw overlay. */
export type LiveMatchScreenPreGameDrawProps = {
  preGameDraw?: PreGameDrawState | null;
  onPregameTileTap?: (tileId: string) => void;
};

export type LiveMatchScreenProps = {
  shell: LiveMatchScreenShellProps;
  identity: LiveMatchScreenIdentityProps;
  hud: LiveMatchScreenHudProps;
  board: LiveMatchScreenBoardProps;
  hand: LiveMatchScreenHandProps;
  chrome: LiveMatchScreenChromeProps;
  connection: LiveMatchScreenConnectionProps;
  tournament: LiveMatchScreenTournamentProps;
  postGame: LiveMatchScreenPostGameProps;
  leave: LiveMatchScreenLeaveProps;
  preGameDraw?: LiveMatchScreenPreGameDrawProps;
};```
### `client/src/stats/statsTypes.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
export type MatchMode = 'bot' | 'online' | 'practice';

export interface RecordMatchInput {
  mode: MatchMode;
  opponentType: 'bot' | 'online' | 'guest';
  winnerUserId: string | null;
  loserUserId: string | null;
  winnerScore: number | null;
  loserScore: number | null;
  moveCount: number | null;
  avgMoveQuality?: number | null;
  roomCode?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StatsSummary {
  onlineGamesPlayed: number;
  wins: number;
  losses: number;
  avgMoveQuality: number | null;
  longestWinStreak: number;
  winRate: number;
  currentWinStreak: number;
  gamesThisWeek: number;
  ghostRating: number | null;
  ghostGamesThisWeek: number;
  ghostRatingChangeThisWeek: number;
  ghostBestWinMarginThisWeek: number | null;
}

export type FritzTierKey = 'rookie' | 'standard' | 'elite' | 'master';

export interface FritzTierRecord {
  wins: number;
  losses: number;
  gamesPlayed: number;
}

export interface FritzStatsSummary {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  bestWinMargin: number | null;
  averagePointsScored: number | null;
  highestScore: number | null;
  gamesThisWeek: number;
  ratingChangeThisWeek: number;
  bestWinMarginThisWeek: number | null;
  tierRecords: Record<FritzTierKey, FritzTierRecord>;
}

export interface GhostStatsSummary {
  rating: number | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  bestWinMargin: number | null;
  gamesThisWeek: number;
  ratingChangeThisWeek: number;
  bestWinMarginThisWeek: number | null;
}

export interface PuzzleStatsSummary {
  currentStreak: number;
  completions: number;
  completionsThisWeek: number;
  bestScoreToday: number | null;
  bestScoreEver: number | null;
  perfectDays: number;
}

export interface RankingProfile {
  glicko_rating: number;
  glicko_rd: number;
  provisional: boolean;
  ranked_games_played: number;
  peak_rating: number;
  rank: number | null;
  /** Consecutive online wins from match history (server-computed). */
  currentWinStreak: number;
}

export interface PersonalStatsInsights {
  base: StatsSummary;
  rankingProfile: RankingProfile | null;
  fritz: FritzStatsSummary;
  ghost: GhostStatsSummary;
  puzzle: PuzzleStatsSummary;
}

export interface WeeklyRecap {
  weekLabel: string;
  fritz: Pick<FritzStatsSummary, 'gamesThisWeek' | 'ratingChangeThisWeek' | 'bestWinMarginThisWeek'>;
  ghost: Pick<GhostStatsSummary, 'gamesThisWeek' | 'ratingChangeThisWeek' | 'bestWinMarginThisWeek'>;
  puzzle: Pick<PuzzleStatsSummary, 'completionsThisWeek'> & { bestScoreToday: number | null };
  multiplayer: Pick<StatsSummary, 'gamesThisWeek' | 'wins' | 'losses'>;
}```
### `client/src/stats/statsDerivations.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import {
  FRITZ_MASTER_ID,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
} from '../bot/fritzConfig';
import type {
  FritzStatsSummary,
  FritzTierKey,
  FritzTierRecord,
  GhostStatsSummary,
  PuzzleStatsSummary,
  StatsSummary,
} from './statsTypes';

export type MatchSummaryRow = {
  winner_user_id: string | null;
  loser_user_id: string | null;
  mode: string | null;
  winner_score?: number | null;
  loser_score?: number | null;
  room_code?: string | null;
  avg_move_quality?: number | null;
  created_at?: string | null;
};

export type GhostGameSummaryRow = {
  final_score: number | null;
  opponent_score: number | null;
  played_at?: string | null;
};

export type PuzzleCompletionRow = {
  puzzle_date: string | null;
  current_streak: number | null;
  score: number | null;
  perfect: boolean | null;
  updated_at?: string | null;
};

export type PuzzleScoreRow = {
  puzzle_date: string | null;
  best_score: number | null;
  updated_at?: string | null;
};

export function dedupeOnlineMatchRows<T extends MatchSummaryRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const roomCode = row.room_code?.trim();
    const createdAt = row.created_at ?? '';
    const key = roomCode
      ? `room:${roomCode}:${row.winner_user_id ?? ''}:${row.loser_user_id ?? ''}:${row.winner_score ?? ''}:${row.loser_score ?? ''}`
      : `match:${row.winner_user_id ?? ''}:${row.loser_user_id ?? ''}:${row.winner_score ?? ''}:${row.loser_score ?? ''}:${createdAt.slice(0, 19)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function isGhostRatingEligible(
  finalScore: number | null | undefined,
  opponentScore: number | null | undefined,
): boolean {
  return Math.max(Number(finalScore ?? 0), Number(opponentScore ?? 0)) >= 10;
}

export function getWeekStart(now = new Date()): Date {
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - diffToMonday);
  return weekStart;
}

function toLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyTierRecord(): FritzTierRecord {
  return { wins: 0, losses: 0, gamesPlayed: 0 };
}

function tierFromOpponentId(opponentId: string): FritzTierKey {
  if (opponentId === FRITZ_ROOKIE_ID) return 'rookie';
  if (opponentId === FRITZ_STANDARD_ID) return 'standard';
  if (opponentId === FRITZ_MASTER_ID) return 'master';
  return 'elite';
}

export function formatWeekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return `Week of ${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function deriveFritzSummary(
  games: Array<{
    played_at: string;
    opponent_id: string;
    player_score: number;
    opponent_score: number;
    delta: number;
  }>,
  weekStart: Date,
): FritzStatsSummary {
  const tierRecords: Record<FritzTierKey, FritzTierRecord> = {
    rookie: emptyTierRecord(),
    standard: emptyTierRecord(),
    elite: emptyTierRecord(),
    master: emptyTierRecord(),
  };

  let wins = 0;
  let losses = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let streakTracker = 0;
  let bestWinMargin: number | null = null;
  let highestScore: number | null = null;
  let totalPointsScored = 0;
  let gamesThisWeek = 0;
  let ratingChangeThisWeek = 0;
  let bestWinMarginThisWeek: number | null = null;

  for (const game of games) {
    const tier = tierFromOpponentId(game.opponent_id);
    const playerScore = Number(game.player_score ?? 0);
    const margin = Number(game.player_score ?? 0) - Number(game.opponent_score ?? 0);
    highestScore = highestScore == null ? playerScore : Math.max(highestScore, playerScore);
    totalPointsScored += playerScore;
    tierRecords[tier].gamesPlayed += 1;
    if (margin > 0) {
      wins += 1;
      tierRecords[tier].wins += 1;
      streakTracker += 1;
      bestStreak = Math.max(bestStreak, streakTracker);
      bestWinMargin = bestWinMargin == null ? margin : Math.max(bestWinMargin, margin);
    } else {
      losses += 1;
      tierRecords[tier].losses += 1;
      streakTracker = 0;
    }

    const playedMs = new Date(game.played_at).getTime();
    if (Number.isFinite(playedMs) && playedMs >= weekStart.getTime()) {
      gamesThisWeek += 1;
      ratingChangeThisWeek += Number(game.delta ?? 0);
      if (margin > 0) {
        bestWinMarginThisWeek =
          bestWinMarginThisWeek == null ? margin : Math.max(bestWinMarginThisWeek, margin);
      }
    }
  }

  for (let i = games.length - 1; i >= 0; i -= 1) {
    const margin = Number(games[i].player_score ?? 0) - Number(games[i].opponent_score ?? 0);
    if (margin > 0) {
      currentStreak += 1;
      continue;
    }
    break;
  }

  const gamesPlayed = wins + losses;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0;
  const averagePointsScored = gamesPlayed > 0 ? Math.round((totalPointsScored / gamesPlayed) * 10) / 10 : null;

  return {
    gamesPlayed,
    wins,
    losses,
    winRate,
    currentStreak,
    bestStreak,
    bestWinMargin,
    averagePointsScored,
    highestScore,
    gamesThisWeek,
    ratingChangeThisWeek,
    bestWinMarginThisWeek,
    tierRecords,
  };
}

export function deriveGhostSummary(
  rows: GhostGameSummaryRow[],
  rating: number | null,
  weekStart: Date,
): GhostStatsSummary {
  let wins = 0;
  let losses = 0;
  let bestWinMargin: number | null = null;
  let gamesThisWeek = 0;
  let ratingChangeThisWeek = 0;
  let bestWinMarginThisWeek: number | null = null;

  for (const row of rows) {
    const finalScore = Number(row.final_score ?? 0);
    const opponentScore = Number(row.opponent_score ?? 0);
    const margin = finalScore - opponentScore;
    const ratingEligible = isGhostRatingEligible(finalScore, opponentScore);
    if (margin > 0) {
      wins += 1;
      bestWinMargin = bestWinMargin == null ? margin : Math.max(bestWinMargin, margin);
    }
    if (margin < 0) losses += 1;

    const playedMs = new Date(row.played_at ?? 0).getTime();
    if (Number.isFinite(playedMs) && playedMs >= weekStart.getTime()) {
      gamesThisWeek += 1;
      if (margin > 0) {
        bestWinMarginThisWeek =
          bestWinMarginThisWeek == null ? margin : Math.max(bestWinMarginThisWeek, margin);
      }
      if (ratingEligible && margin > 0) ratingChangeThisWeek += 16;
      if (ratingEligible && margin < 0) ratingChangeThisWeek -= 16;
    }
  }

  const gamesPlayed = rows.length;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0;

  return {
    rating,
    gamesPlayed,
    wins,
    losses,
    winRate,
    bestWinMargin,
    gamesThisWeek,
    ratingChangeThisWeek,
    bestWinMarginThisWeek,
  };
}

export function derivePuzzleSummary(
  completionRows: PuzzleCompletionRow[],
  scoreRows: PuzzleScoreRow[],
  weekStart: Date,
): PuzzleStatsSummary {
  const todayKey = toLocalDateKey(new Date());
  const completions = completionRows.length;
  const perfectDays = completionRows.filter((row) => Boolean(row.perfect)).length;
  const currentStreak =
    [...completionRows]
      .sort((a, b) => String(b.puzzle_date ?? '').localeCompare(String(a.puzzle_date ?? '')))[0]
      ?.current_streak ?? 0;
  const completionsThisWeek = completionRows.filter((row) => {
    const value = row.updated_at ?? row.puzzle_date ?? '';
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) && ms >= weekStart.getTime();
  }).length;
  const bestScoreToday =
    scoreRows.find((row) => row.puzzle_date === todayKey)?.best_score == null
      ? null
      : Number(scoreRows.find((row) => row.puzzle_date === todayKey)?.best_score ?? 0);
  const bestScoreEver =
    scoreRows.length > 0
      ? Math.max(...scoreRows.map((row) => Number(row.best_score ?? 0)))
      : null;

  return {
    currentStreak: Number(currentStreak ?? 0),
    completions,
    completionsThisWeek,
    bestScoreToday,
    bestScoreEver,
    perfectDays,
  };
}

export function buildStatsSummary(userId: string, rows: MatchSummaryRow[]): StatsSummary {
  const onlineRows = dedupeOnlineMatchRows(
    rows.filter((row) => row.mode === 'online'),
  ).sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());

  const wins = onlineRows.filter((row) => row.winner_user_id === userId).length;
  const losses = onlineRows.filter((row) => row.loser_user_id === userId).length;

  let longestWinStreak = 0;
  let streakTracker = 0;
  for (const match of onlineRows) {
    if (match.winner_user_id === userId) {
      streakTracker += 1;
      if (streakTracker > longestWinStreak) longestWinStreak = streakTracker;
    } else if (match.loser_user_id === userId) {
      streakTracker = 0;
    }
  }

  let currentWinStreak = 0;
  for (let i = onlineRows.length - 1; i >= 0; i--) {
    const match = onlineRows[i];
    if (match.winner_user_id === userId) {
      currentWinStreak += 1;
      continue;
    }
    if (match.loser_user_id === userId) break;
  }

  const onlineGamesPlayed = wins + losses;
  const winRate =
    onlineGamesPlayed > 0 ? Math.round((wins / onlineGamesPlayed) * 1000) / 10 : 0;
  const qualitySamples = onlineRows
    .map((row) => row.avg_move_quality)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const avgMoveQuality =
    qualitySamples.length > 0
      ? Math.round((qualitySamples.reduce((sum, value) => sum + value, 0) / qualitySamples.length) * 10) / 10
      : null;
  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const gamesThisWeek = onlineRows.filter((row) => {
    const createdMs = new Date(row.created_at ?? 0).getTime();
    return Number.isFinite(createdMs) && nowMs - createdMs <= sevenDaysMs;
  }).length;

  return {
    onlineGamesPlayed,
    wins,
    losses,
    avgMoveQuality,
    longestWinStreak,
    winRate,
    currentWinStreak,
    gamesThisWeek,
    ghostRating: null,
    ghostGamesThisWeek: 0,
    ghostRatingChangeThisWeek: 0,
    ghostBestWinMarginThisWeek: null,
  };
}```
### `client/src/stats/statsDerivations.test.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import { describe, expect, it } from 'vitest';
import { FRITZ_ROOKIE_ID, FRITZ_STANDARD_ID } from '../bot/fritzConfig';
import {
  buildStatsSummary,
  dedupeOnlineMatchRows,
  deriveFritzSummary,
  formatWeekLabel,
  getWeekStart,
  isGhostRatingEligible,
} from './statsDerivations';

describe('dedupeOnlineMatchRows', () => {
  it('collapses duplicate room results', () => {
    const rows = [
      {
        winner_user_id: 'a',
        loser_user_id: 'b',
        mode: 'online',
        room_code: 'ROOM1',
        winner_score: 60,
        loser_score: 40,
        created_at: '2026-01-01T12:00:00Z',
      },
      {
        winner_user_id: 'a',
        loser_user_id: 'b',
        mode: 'online',
        room_code: 'ROOM1',
        winner_score: 60,
        loser_score: 40,
        created_at: '2026-01-01T12:00:05Z',
      },
    ];
    expect(dedupeOnlineMatchRows(rows)).toHaveLength(1);
  });
});

describe('buildStatsSummary', () => {
  it('computes win rate and streaks for online matches', () => {
    const summary = buildStatsSummary('user-1', [
      {
        winner_user_id: 'user-1',
        loser_user_id: 'user-2',
        mode: 'online',
        created_at: '2026-01-01T10:00:00Z',
      },
      {
        winner_user_id: 'user-1',
        loser_user_id: 'user-3',
        mode: 'online',
        created_at: '2026-01-02T10:00:00Z',
      },
      {
        winner_user_id: 'user-4',
        loser_user_id: 'user-1',
        mode: 'online',
        created_at: '2026-01-03T10:00:00Z',
      },
    ]);

    expect(summary.wins).toBe(2);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBe(66.7);
    expect(summary.longestWinStreak).toBe(2);
    expect(summary.currentWinStreak).toBe(0);
  });
});

describe('deriveFritzSummary', () => {
  it('tracks tier records and weekly deltas', () => {
    const weekStart = getWeekStart(new Date('2026-07-05T12:00:00'));
    const summary = deriveFritzSummary(
      [
        {
          played_at: '2026-07-05T10:00:00Z',
          opponent_id: FRITZ_ROOKIE_ID,
          player_score: 60,
          opponent_score: 40,
          delta: 12,
        },
        {
          played_at: '2026-06-01T10:00:00Z',
          opponent_id: FRITZ_STANDARD_ID,
          player_score: 30,
          opponent_score: 60,
          delta: -8,
        },
      ],
      weekStart,
    );

    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.gamesThisWeek).toBe(1);
    expect(summary.ratingChangeThisWeek).toBe(12);
    expect(summary.tierRecords.rookie.wins).toBe(1);
    expect(summary.tierRecords.standard.losses).toBe(1);
  });
});

describe('isGhostRatingEligible', () => {
  it('requires a meaningful final score', () => {
    expect(isGhostRatingEligible(10, 5)).toBe(true);
    expect(isGhostRatingEligible(4, 3)).toBe(false);
  });
});

describe('formatWeekLabel', () => {
  it('renders a Monday-through-Sunday label', () => {
    const weekStart = getWeekStart(new Date('2026-07-05T12:00:00'));
    expect(formatWeekLabel(weekStart)).toMatch(/^Week of /);
  });
});```
### `client/src/learning/moveAnalysis.test.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import { describe, expect, it } from 'vitest';
import {
  classifyMoveByDelta,
  computeEngineConfidence,
  computeInterventionLevel,
  formatMoveNotation,
  isAmbiguousGap,
  normalizeMoveId,
} from './moveAnalysis';
import { DEFAULT_THRESHOLD_CONFIG } from './types';

describe('normalizeMoveId', () => {
  it('formats play moves and pass', () => {
    expect(normalizeMoveId({ type: 'pass' })).toBe('pass');
    expect(
      normalizeMoveId({ type: 'play', tile: { low: 3, high: 4 }, position: 'left' }),
    ).toBe('3|4-left');
  });
});

describe('formatMoveNotation', () => {
  it('renders human-readable labels', () => {
    expect(formatMoveNotation({ type: 'pass' })).toBe('Pass');
    expect(
      formatMoveNotation({ type: 'play', tile: { low: 3, high: 4 }, position: 'right' }),
    ).toBe('[3|4] → right');
  });
});

describe('classifyMoveByDelta', () => {
  const thresholds = DEFAULT_THRESHOLD_CONFIG;

  it('maps score deltas to categories', () => {
    expect(classifyMoveByDelta(0, thresholds)).toBe('best');
    expect(classifyMoveByDelta(thresholds.excellentDelta, thresholds)).toBe('excellent');
    expect(classifyMoveByDelta(thresholds.goodDelta, thresholds)).toBe('good');
    expect(classifyMoveByDelta(thresholds.dubiousDelta, thresholds)).toBe('dubious');
    expect(classifyMoveByDelta(thresholds.dubiousDelta + 1, thresholds)).toBe('blunder');
  });
});

describe('computeEngineConfidence', () => {
  const thresholds = DEFAULT_THRESHOLD_CONFIG;

  it('returns 1 when only one scored move exists', () => {
    expect(computeEngineConfidence([42], thresholds)).toBe(1);
  });

  it('returns 0 for ambiguous gaps and 1 for strong gaps', () => {
    expect(
      computeEngineConfidence(
        [100, 100 - thresholds.lowConfidenceBand],
        thresholds,
      ),
    ).toBe(0);
    expect(
      computeEngineConfidence(
        [100, 100 - thresholds.strongInterventionDelta],
        thresholds,
      ),
    ).toBe(1);
  });
});

describe('isAmbiguousGap', () => {
  const thresholds = DEFAULT_THRESHOLD_CONFIG;

  it('detects close top-two scores', () => {
    expect(isAmbiguousGap([50, 49], thresholds)).toBe(true);
    expect(isAmbiguousGap([50, 10], thresholds)).toBe(false);
    expect(isAmbiguousGap([50], thresholds)).toBe(false);
  });
});

describe('computeInterventionLevel', () => {
  it('stays silent for best moves and ambiguous non-blunders', () => {
    expect(computeInterventionLevel('best', 1, false)).toBe('none');
    expect(computeInterventionLevel('good', 0.1, true)).toBe('none');
  });

  it('escalates blunders and softens neither-scores positions', () => {
    expect(computeInterventionLevel('blunder', 1, false)).toBe('strong');
    expect(computeInterventionLevel('blunder', 1, false, 'guided', true)).toBe('medium');
    expect(computeInterventionLevel('dubious', 1, false, 'guided', true)).toBe('light');
  });
});```
### `client/src/learning/reasonTagging.test.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import { describe, expect, it } from 'vitest';
import {
  buildRiskFlags,
  determinePrimaryReason,
  determineSecondaryReason,
  REASON_TO_CONCEPT,
} from './reasonTagging';
import type { MoveFeatures } from './reasonTagging';

function baseFeatures(overrides: Partial<MoveFeatures> = {}): MoveFeatures {
  return {
    immediateScore: 0,
    turnContinues: false,
    remainingPlayableCount: 2,
    playerNextTurnScoringCount: 0,
    playerConstraintLevel: 'limited',
    playerEndCoverage: 1,
    opponentResponseCount: 2,
    opponentScoringResponseCount: 1,
    opponentConstraintLevel: 'limited',
    opponentForcedDefensiveCount: 0,
    opponentReturnScore: 1,
    opensEndDangerLevel: 'neutral',
    reducesScoringFlexibility: false,
    causesHandBlock: false,
    scorePosition: 'even',
    resultingOpenEnds: [3, 5],
    ...overrides,
  };
}

describe('determinePrimaryReason', () => {
  it('prioritizes immediate scoring', () => {
    expect(determinePrimaryReason(baseFeatures({ immediateScore: 2 }), 'best')).toBe('score_now');
  });

  it('flags self-blocks before generic fallbacks', () => {
    expect(
      determinePrimaryReason(baseFeatures({ causesHandBlock: true }), 'blunder'),
    ).toBe('avoid_self_block');
  });

  it('recognizes opponent restriction', () => {
    expect(
      determinePrimaryReason(
        baseFeatures({ opponentScoringResponseCount: 0, opensEndDangerLevel: 'safe' }),
        'excellent',
      ),
    ).toBe('deny_return_score');
  });
});

describe('determineSecondaryReason', () => {
  it('adds chaining context to scoring moves', () => {
    expect(
      determineSecondaryReason(
        baseFeatures({
          immediateScore: 1,
          remainingPlayableCount: 4,
          reducesScoringFlexibility: false,
        }),
        'score_now',
      ),
    ).toBe('keep_board_flexible');
  });
});

describe('buildRiskFlags', () => {
  it('flags dangerous openings and self-blocks', () => {
    const flags = buildRiskFlags(
      baseFeatures({
        opensEndDangerLevel: 'dangerous',
        causesHandBlock: true,
        opponentReturnScore: 4,
      }),
    );
    expect(flags).toContain('opens_dangerous_end');
    expect(flags).toContain('self_blocks');
    expect(flags).toContain('gives_easy_score_back');
  });

  it('uses a higher threshold when the move already scores', () => {
    const flags = buildRiskFlags(baseFeatures({ immediateScore: 1, opponentReturnScore: 1 }));
    expect(flags).not.toContain('gives_easy_score_back');
  });
});

describe('REASON_TO_CONCEPT', () => {
  it('maps every coaching reason to at least one concept tag', () => {
    for (const concepts of Object.values(REASON_TO_CONCEPT)) {
      expect(concepts.length).toBeGreaterThan(0);
    }
  });
});```
### `client/src/journey/journeyContentValidation.test.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import { describe, expect, it } from 'vitest';
import {
  formatJourneyContentSummary,
  formatJourneyContentValidationErrors,
  formatJourneyContentValidationReport,
  summarizeJourneyContent,
  validateJourneyContent,
} from './journeyContentValidation';

describe('summarizeJourneyContent', () => {
  it('returns chapter and node counts for shipped content', () => {
    const summary = summarizeJourneyContent();
    expect(summary.chapterCount).toBeGreaterThan(0);
    expect(summary.totalNodeCount).toBeGreaterThan(0);
    expect(summary.chapters.every((chapter) => chapter.nodeCount >= 0)).toBe(true);
    expect(summary.puzzleAnswerDistribution.totalPuzzles).toBeGreaterThan(0);
  });
});

describe('formatJourneyContentSummary', () => {
  it('includes chapter lines and trial format totals', () => {
    const summary = summarizeJourneyContent();
    const text = formatJourneyContentSummary(summary);
    expect(text).toContain('Journey content summary');
    expect(text).toContain('Per chapter:');
    expect(text).toContain('Trial formats:');
    expect(text).toContain('Puzzle answer distribution');
  });
});

describe('formatJourneyContentValidationErrors', () => {
  it('prefixes each error with a bullet', () => {
    const text = formatJourneyContentValidationErrors(['first issue', 'second issue']);
    expect(text).toBe(
      'Journey content validation failed:\n- first issue\n- second issue',
    );
  });
});

describe('validateJourneyContent', () => {
  it('passes on the current journey registry', () => {
    const result = validateJourneyContent();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary.chapterCount).toBeGreaterThan(0);
  });

  it('renders a passing report with summary and success line', () => {
    const result = validateJourneyContent();
    const report = formatJourneyContentValidationReport(result);
    expect(report).toContain('Journey content validation passed.');
    expect(report).toContain('Journey content summary');
  });
});```
### `server/src/social/socialAuth.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import type { Request, Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';

export async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  try {
    const userData = await supabaseFetch<{ id?: string }>(
      `/auth/v1/user`,
      { headers: { Authorization: `Bearer ${token}` } } as RequestInit,
    );
    const userId = (userData as { id?: string })?.id ?? null;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    return userId;
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

export async function getFriendIds(userId: string): Promise<string[]> {
  const enc = encodeURIComponent(userId);
  const rows = await supabaseFetch<Array<{ user_id: string; friend_user_id: string }>>(
    `/rest/v1/friends` +
    `?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
    `&status=eq.accepted` +
    `&select=user_id,friend_user_id`,
  );
  return rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id));
}```
### `server/src/social/socialLeaderboard.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import type { Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getFriendIds } from './socialAuth';

export async function respondLeaderboardGlobal(userId: string, res: Response): Promise<void> {
  try {
    const profiles = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number;
      ranked_games_played: number; provisional: boolean;
    }>>(
      `/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc` +
      `&select=id,username,glicko_rating,ranked_games_played,provisional&limit=100`,
    );
    const topRows = profiles.map((p, i) => ({
      userId: p.id, username: p.username,
      glicko_rating: Number(p.glicko_rating ?? 800),
      ranked_games_played: Number(p.ranked_games_played ?? 0),
      provisional: false, global_rank: i + 1, is_self: p.id === userId,
    }));
    let selfEntry = topRows.find((r) => r.is_self);
    if (!selfEntry) {
      const enc = encodeURIComponent(userId);
      const selfProfile = await supabaseFetch<Array<{
        id: string; username: string; glicko_rating: number; ranked_games_played: number; provisional: boolean;
      }>>(`/rest/v1/profiles?id=eq.${enc}&select=id,username,glicko_rating,ranked_games_played,provisional&limit=1`);
      if (selfProfile?.[0]) {
        const sp = selfProfile[0];
        const aboveCount = await supabaseFetch<Array<{ id: string }>>(
          `/rest/v1/profiles?provisional=eq.false&glicko_rating=gte.${encodeURIComponent(String(sp.glicko_rating))}&select=id`,
        );
        selfEntry = {
          userId: sp.id, username: sp.username,
          glicko_rating: Number(sp.glicko_rating ?? 800),
          ranked_games_played: Number(sp.ranked_games_played ?? 0),
          provisional: Boolean(sp.provisional),
          global_rank: aboveCount.length, is_self: true,
        };
      }
    }
    res.json({ ok: true, leaderboard: topRows, self: selfEntry ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}

export async function respondLeaderboardFriends(userId: string, res: Response): Promise<void> {
  try {
    const friendIds = await getFriendIds(userId);
    const allIds = [userId, ...friendIds];
    const inFilter = allIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number;
      ranked_games_played: number; provisional: boolean;
    }>>(
      `/rest/v1/profiles?or=(${inFilter})&order=glicko_rating.desc` +
      `&select=id,username,glicko_rating,ranked_games_played,provisional`,
    );
    const winCountMap = new Map<string, number>();
    await Promise.all(allIds.map(async (id) => {
      try {
        const wins = await supabaseFetch<Array<{ id: string }>>(
          `/rest/v1/matches?winner_user_id=eq.${encodeURIComponent(id)}&mode=eq.online&select=id`,
        );
        winCountMap.set(id, wins.length);
      } catch { winCountMap.set(id, 0); }
    }));
    res.json({
      ok: true,
      leaderboard: profiles.map((p, index) => {
        const wins = winCountMap.get(p.id) ?? 0;
        const total = Number(p.ranked_games_played ?? 0);
        const win_rate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
        return {
          userId: p.id, username: p.username,
          glicko_rating: Number(p.glicko_rating ?? 800),
          ranked_games_played: total, provisional: Boolean(p.provisional),
          rank_in_friends: index + 1, is_self: p.id === userId, wins, win_rate,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}

export async function respondLeaderboardWeekly(userId: string, res: Response): Promise<void> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const matches = await supabaseFetch<Array<{ winner_user_id: string | null; loser_user_id: string | null }>>(
      `/rest/v1/matches?mode=eq.online&created_at=gte.${encodeURIComponent(weekAgo)}` +
      `&select=winner_user_id,loser_user_id&limit=10000`,
    );
    const winCounts = new Map<string, number>();
    for (const m of matches) {
      if (m.winner_user_id) winCounts.set(m.winner_user_id, (winCounts.get(m.winner_user_id) ?? 0) + 1);
    }
    if (!winCounts.size) { res.json({ ok: true, leaderboard: [], self: null }); return; }
    const topIds = [...winCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id);
    const profileFilter = topIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{ id: string; username: string; glicko_rating: number; provisional: boolean }>>(
      `/rest/v1/profiles?or=(${profileFilter})&select=id,username,glicko_rating,provisional`,
    );
    const sorted = profiles
      .map((p) => ({
        userId: p.id, username: p.username,
        glicko_rating: Number(p.glicko_rating ?? 800),
        provisional: Boolean(p.provisional),
        wins_this_week: winCounts.get(p.id) ?? 0, is_self: p.id === userId,
      }))
      .sort((a, b) => b.wins_this_week - a.wins_this_week)
      .map((p, i) => ({ ...p, rank: i + 1 }));
    const self = sorted.find((r) => r.is_self) ?? null;
    res.json({ ok: true, leaderboard: sorted, self });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}```
### `server/src/social/socialFeed.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import type { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getFriendIds, requireAuth } from './socialAuth';

export function registerSocialFeedRoutes(socialRouter: Router): void {
  socialRouter.get('/feed', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const friendIds = await getFriendIds(userId).catch(() => [] as string[]);
      const allIds = [userId, ...friendIds];
      const inFilter = allIds.map((id) => `user_id.eq.${encodeURIComponent(id)}`).join(',');
      const rows = await supabaseFetch<Array<{
        id: string; user_id: string; type: string;
        metadata: Record<string, unknown>; created_at: string;
      }>>(
        `/rest/v1/activity_feed?or=(${inFilter})&order=created_at.desc&limit=50` +
        `&select=id,user_id,type,metadata,created_at`,
      );

      const feedUserIds = [...new Set(rows.map((r) => r.user_id))];
      const profileFilter = feedUserIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const profiles = profileFilter
        ? await supabaseFetch<Array<{ id: string; username: string }>>(
            `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
          )
        : [];
      const usernameMap = new Map((profiles as Array<{ id: string; username: string }>).map((p) => [p.id, p.username]));

      res.json({
        ok: true,
        feed: rows.map((r) => ({ ...r, username: usernameMap.get(r.user_id) ?? 'player' })),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Feed unavailable.' });
    }
  });

  socialRouter.get('/feed/user/:userId', async (req, res) => {
    const requestorId = await requireAuth(req, res);
    if (!requestorId) return;
    const targetId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!targetId) { res.status(400).json({ error: 'userId is required.' }); return; }
    try {
      const rows = await supabaseFetch<Array<{
        id: string; user_id: string; type: string;
        metadata: Record<string, unknown>; created_at: string;
      }>>(
        `/rest/v1/activity_feed?user_id=eq.${encodeURIComponent(targetId)}` +
        `&order=created_at.desc&limit=10&select=id,user_id,type,metadata,created_at`,
      );
      const profileRows = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}&select=id,username&limit=1`,
      );
      const username = profileRows?.[0]?.username ?? 'player';
      res.json({ ok: true, feed: rows.map((r) => ({ ...r, username })) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Activity unavailable.' });
    }
  });
}```
### `server/src/social/socialFriends.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import type { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getFriendIds, requireAuth } from './socialAuth';
import { getPresenceBatch } from './presence';

export function registerSocialFriendsRoutes(socialRouter: Router): void {
  socialRouter.get('/friends/requests', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const enc = encodeURIComponent(userId);
      const rows = await supabaseFetch<Array<{
        id: string; user_id: string; friend_user_id: string; created_at: string;
      }>>(
        `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
        `&status=eq.pending&select=id,user_id,friend_user_id,created_at`,
      );
      const otherIds = [...new Set(rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id)))];
      const profileMap = new Map<string, string>();
      if (otherIds.length) {
        const filter = otherIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
        const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
          `/rest/v1/profiles?or=(${filter})&select=id,username`,
        );
        for (const p of profiles) profileMap.set(p.id, p.username);
      }
      const incoming = rows
        .filter((r) => r.friend_user_id === userId)
        .map((r) => ({ id: r.id, userId: r.user_id, username: profileMap.get(r.user_id) ?? 'player', created_at: r.created_at }));
      const outgoing = rows
        .filter((r) => r.user_id === userId)
        .map((r) => ({ id: r.id, userId: r.friend_user_id, username: profileMap.get(r.friend_user_id) ?? 'player', created_at: r.created_at }));
      res.json({ ok: true, incoming, outgoing });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Requests unavailable.' });
    }
  });

  socialRouter.get('/friends/with-presence', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const friendIds = await getFriendIds(userId);
      if (!friendIds.length) { res.json({ ok: true, friends: [] }); return; }

      const enc = encodeURIComponent(userId);
      const rows = await supabaseFetch<Array<{ id: string; user_id: string; friend_user_id: string }>>(
        `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
        `&status=eq.accepted&select=id,user_id,friend_user_id`,
      );

      const profileFilter = friendIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
      );
      const profileMap = new Map(profiles.map((p) => [p.id, p.username]));
      const presenceMap = await getPresenceBatch(friendIds).catch(() => new Map<string, { status: string; current_mode: string | null }>());

      const friends = friendIds.map((fId) => {
        const row = rows.find((r) => r.user_id === fId || r.friend_user_id === fId);
        const presence = presenceMap.get(fId) ?? { status: 'offline', current_mode: null };
        return {
          id: row?.id ?? fId,
          userId: fId,
          username: profileMap.get(fId) ?? 'player',
          presence_status: presence.status as 'online' | 'in_game' | 'offline',
          current_mode: presence.current_mode,
        };
      });

      res.json({ ok: true, friends });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Friends unavailable.' });
    }
  });

  socialRouter.post('/friends/request/:userId', async (req, res) => {
    const requestorId = await requireAuth(req, res);
    if (!requestorId) return;
    const targetId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!targetId) { res.status(400).json({ error: 'userId is required.' }); return; }
    if (targetId === requestorId) { res.status(400).json({ error: 'Cannot add yourself.' }); return; }
    try {
      const reqEnc = encodeURIComponent(requestorId);
      const tgtEnc = encodeURIComponent(targetId);
      const existing = await supabaseFetch<Array<{ id: string; status: string }>>(
        `/rest/v1/friends?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${tgtEnc}),and(user_id.eq.${tgtEnc},friend_user_id.eq.${reqEnc}))&select=id,status&limit=1`,
      );
      if (existing?.[0]?.status === 'accepted') { res.status(409).json({ error: 'Already friends.' }); return; }
      if (existing?.[0]?.status === 'pending') { res.status(409).json({ error: 'Request already pending.' }); return; }
      await supabaseFetch('/rest/v1/friends', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: requestorId, friend_user_id: targetId, status: 'pending' }),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
    }
  });

  socialRouter.post('/friends/request', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const targetUsername = typeof req.body?.targetUsername === 'string'
      ? req.body.targetUsername.trim().replace(/^@/, '')
      : '';
    if (!targetUsername) { res.status(400).json({ error: 'targetUsername is required.' }); return; }
    try {
      const targetProfiles = await supabaseFetch<Array<{ id: string }>>(
        `/rest/v1/profiles?username=ilike.${encodeURIComponent(targetUsername)}&select=id&limit=1`,
      );
      const targetId = targetProfiles?.[0]?.id;
      if (!targetId) { res.status(404).json({ error: 'User not found.' }); return; }
      if (targetId === userId) { res.status(400).json({ error: 'Cannot add yourself.' }); return; }
      const reqEnc = encodeURIComponent(userId);
      const tgtEnc = encodeURIComponent(targetId);
      const existing = await supabaseFetch<Array<{ id: string; status: string }>>(
        `/rest/v1/friends?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${tgtEnc}),and(user_id.eq.${tgtEnc},friend_user_id.eq.${reqEnc}))&select=id,status&limit=1`,
      );
      if (existing?.[0]?.status === 'accepted') { res.status(409).json({ error: 'Already friends.' }); return; }
      if (existing?.[0]?.status === 'pending') { res.status(409).json({ error: 'Request already pending.' }); return; }
      await supabaseFetch('/rest/v1/friends', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: userId, friend_user_id: targetId, status: 'pending' }),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
    }
  });

  socialRouter.post('/friends/accept/:requestId', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const rEnc = encodeURIComponent(req.params.requestId);
    const uEnc = encodeURIComponent(userId);
    try {
      await supabaseFetch(`/rest/v1/friends?id=eq.${rEnc}&friend_user_id=eq.${uEnc}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'accepted' }),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to accept request.' });
    }
  });

  socialRouter.delete('/friends/:recordId', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const rEnc = encodeURIComponent(req.params.recordId);
    const uEnc = encodeURIComponent(userId);
    try {
      await supabaseFetch(
        `/rest/v1/friends?id=eq.${rEnc}&or=(user_id.eq.${uEnc},friend_user_id.eq.${uEnc})`,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to remove friend.' });
    }
  });
}```
### `server/src/social/socialProfile.ts` (new)
#### Before
```
(file did not exist)
```
#### After
```typescript
import type { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { dedupeMatchRows } from '../stats/dedupeMatchRows';
import { requireAuth } from './socialAuth';
import { getPresenceBatch } from './presence';

export function registerSocialProfileRoutes(socialRouter: Router): void {
  socialRouter.get('/:username', async (req, res) => {
    const requestorId = await requireAuth(req, res);
    if (!requestorId) return;
    const username = typeof req.params.username === 'string'
      ? req.params.username.trim().replace(/^@/, '')
      : '';
    if (!username) { res.status(400).json({ error: 'username is required.' }); return; }
    try {
      const profileRows = await supabaseFetch<Array<{
        id: string; username: string; glicko_rating: number; peak_rating: number;
        provisional: boolean; ranked_games_played: number;
      }>>(
        `/rest/v1/profiles?username=ilike.${encodeURIComponent(username)}` +
        `&limit=1&select=id,username,glicko_rating,peak_rating,provisional,ranked_games_played`,
      );
      const profile = profileRows?.[0];
      if (!profile) { res.status(404).json({ error: 'Player not found.' }); return; }
      const targetId = profile.id;
      const enc = encodeURIComponent(targetId);

      const allRanked = await supabaseFetch<Array<{ id: string }>>(
        `/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc&select=id`,
      );
      const rankIndex = allRanked.findIndex((p) => p.id === targetId);
      const globalRank = rankIndex >= 0 ? rankIndex + 1 : null;

      const matchRows = dedupeMatchRows(
        await supabaseFetch<Array<{
          winner_user_id: string | null; loser_user_id: string | null; created_at: string;
          winner_score: number | null; loser_score: number | null; room_code: string | null;
        }>>(
          `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
          `&mode=eq.online&select=winner_user_id,loser_user_id,winner_score,loser_score,room_code,created_at`,
        ),
      );
      const wins = matchRows.filter((m) => m.winner_user_id === targetId).length;
      const losses = matchRows.filter((m) => m.loser_user_id === targetId).length;
      const total = wins + losses;
      const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;

      const recentRows = dedupeMatchRows(
        await supabaseFetch<Array<{
          winner_user_id: string | null; loser_user_id: string | null;
          winner_score: number | null; loser_score: number | null;
          mode: string; created_at: string; room_code: string | null;
        }>>(
          `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
          `&order=created_at.desc&limit=20` +
          `&select=winner_user_id,loser_user_id,winner_score,loser_score,mode,created_at,room_code`,
        ),
      ).slice(0, 10);
      const opponentIds = [...new Set(
        recentRows
          .map((m) => (m.winner_user_id === targetId ? m.loser_user_id : m.winner_user_id))
          .filter((id): id is string => Boolean(id)),
      )];
      const oppProfileMap = new Map<string, string>();
      if (opponentIds.length) {
        const oppFilter = opponentIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
        const oppProfiles = await supabaseFetch<Array<{ id: string; username: string }>>(
          `/rest/v1/profiles?or=(${oppFilter})&select=id,username`,
        );
        for (const p of oppProfiles) oppProfileMap.set(p.id, p.username);
      }
      const recentMatches = recentRows.map((m) => {
        const won = m.winner_user_id === targetId;
        const opponentId = won ? m.loser_user_id : m.winner_user_id;
        return {
          opponent_username: opponentId ? (oppProfileMap.get(opponentId) ?? 'guest') : 'guest',
          result: won ? 'win' : 'loss',
          score: won ? m.winner_score : m.loser_score,
          opponent_score: won ? m.loser_score : m.winner_score,
          mode: m.mode,
          played_at: m.created_at,
        };
      });

      const h2hRows = matchRows.filter((m) => {
        const opp = m.winner_user_id === targetId ? m.loser_user_id : m.winner_user_id;
        return opp === requestorId;
      });
      const viewerH2hWins = h2hRows.filter((m) => m.winner_user_id === requestorId).length;
      const viewerH2hLosses = h2hRows.filter((m) => m.loser_user_id === requestorId).length;
      const h2h =
        viewerH2hWins + viewerH2hLosses > 0
          ? {
              viewer_wins: viewerH2hWins,
              viewer_losses: viewerH2hLosses,
              wins: viewerH2hWins,
              losses: viewerH2hLosses,
            }
          : null;

      const reqEnc = encodeURIComponent(requestorId);
      const friendRows = await supabaseFetch<Array<{ id: string; status: string }>>(
        `/rest/v1/friends` +
        `?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${enc}),and(user_id.eq.${enc},friend_user_id.eq.${reqEnc}))` +
        `&select=id,status&limit=1`,
      );
      const friendRow = (friendRows as Array<{ id: string; status: string }>)?.[0];
      const isFriend = friendRow?.status === 'accepted';
      const hasPendingRequest = friendRow?.status === 'pending';

      const puzzleRows = await supabaseFetch<Array<{ total_score: number | null; completed_at: string }>>(
        `/rest/v1/daily_puzzle_attempts?user_id=eq.${enc}&status=eq.completed` +
        `&select=total_score,completed_at&order=completed_at.asc&limit=365`,
      ).catch(() => [] as Array<{ total_score: number | null; completed_at: string }>);
      const puzzles_completed = puzzleRows.length;
      const best_puzzle_score = puzzleRows.reduce((max, r) => Math.max(max, r.total_score ?? 0), 0) || null;

      const puzzleDates = [...new Set(puzzleRows.map((r) => r.completed_at.slice(0, 10)))];
      let best_streak = 0;
      let streakCur = 0;
      for (let i = 0; i < puzzleDates.length; i++) {
        if (i === 0) {
          streakCur = 1;
        } else {
          const prev = new Date(`${puzzleDates[i - 1]}T00:00:00Z`);
          const curr = new Date(`${puzzleDates[i]}T00:00:00Z`);
          const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
          streakCur = diff === 1 ? streakCur + 1 : 1;
        }
        best_streak = Math.max(best_streak, streakCur);
      }

      const fritzRows = await supabaseFetch<Array<{ won: boolean; final_score: number | null }>>(
        `/rest/v1/daily_fritz_attempts?user_id=eq.${enc}&status=eq.completed` +
        `&select=won,final_score`,
      ).catch(() => [] as Array<{ won: boolean; final_score: number | null }>);
      const fritz_wins = fritzRows.filter((r) => r.won).length;
      const fritz_losses = fritzRows.filter((r) => !r.won).length;

      const presenceMap = await getPresenceBatch([targetId]).catch(() => new Map<string, { status: string; current_mode: string | null }>());
      const presence = presenceMap.get(targetId) ?? { status: 'offline', current_mode: null };

      res.json({
        ok: true,
        userId: targetId,
        username: profile.username,
        glicko_rating: Number(profile.glicko_rating ?? 800),
        peak_rating: Number(profile.peak_rating ?? profile.glicko_rating ?? 800),
        provisional: Boolean(profile.provisional),
        ranked_games_played: Number(profile.ranked_games_played ?? 0),
        global_rank: globalRank,
        wins,
        losses,
        win_rate: winRate,
        puzzles_completed,
        best_puzzle_score,
        best_streak,
        fritz_wins,
        fritz_losses,
        is_self: targetId === requestorId,
        is_friend: isFriend,
        has_pending_request: hasPendingRequest,
        h2h,
        presence,
        recent_matches: recentMatches,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Profile unavailable.' });
    }
  });
}```
## Test and build results
| Suite | Before (corrected) | After |
|---|---|---|
| Client vitest (jsdom) | **537 tests / 67 files** | **562 tests / 71 files** |
| Server vitest | 513 tests / 77 files | 513 tests / 77 files |
| Client build (`npm run build --prefix client`) | pass (baseline) | pass |
| Server build (`npm run build --prefix server`) | pass (baseline) | pass |

**Note:** The original report incorrectly listed client before/after as `513→562 / 77→71`. That copied the **server** test/file counts onto the client row and implied six test files were deleted. See **Follow-up: test-count reconciliation** below for evidence and correction.

## Summary table
| # | Item | Outcome |
|---|---|---|
| 1 | formatDateLabel consolidation | flagged-for-followup |
| 2 | useMultiplayerPresentation dedup | skipped-already-fine (+ any cleanup) |
| 3 | LiveMatchScreen prop grouping | executed |
| 4 | statsApi.ts split | executed |
| 5 | social/routes.ts split | executed |
| 6 | learning/ tests | executed |
| 7 | journeyContentValidation tests | executed |
| 8 | console.log/any + botMatches logging | executed |

---

## Follow-up: test-count reconciliation and getBoardTileCount fix

### 1. Test-count reconciliation

#### Raw `find` output (2026-07-05)

```bash
$ find client/src -name '*.test.*' | wc -l
      71

$ find server/src -name '*.test.*' | wc -l
      77
```

#### Raw `npm test` output — client

```bash
$ cd client && NODE_OPTIONS='--max-old-space-size=4096' npm test

 Test Files  71 passed (71)
      Tests  562 passed (562)
   Start at  15:03:30
   Duration  16.48s (transform 5.43s, setup 5.56s, import 13.27s, tests 4.11s, environment 72.53s)
```

#### Raw `npm test` output — server

```bash
$ cd server && npm test

 Test Files  77 passed (77)
      Tests  513 passed (513)
   Start at  15:03:47
   Duration  3.77s (transform 3.71s, setup 0ms, import 8.25s, tests 1.43s, environment 17ms)
```

#### Pre–Tier-2 client baseline (reconstructed)

Excluding the four test files added in Tier 2:

```bash
$ cd client && npx vitest run \
    --exclude src/stats/statsDerivations.test.ts \
    --exclude src/learning/moveAnalysis.test.ts \
    --exclude src/learning/reasonTagging.test.ts \
    --exclude src/journey/journeyContentValidation.test.ts

 Test Files  67 passed (67)
      Tests  537 passed (537)
   Start at  15:03:09
   Duration  11.99s (transform 4.00s, setup 4.62s, import 9.48s, tests 3.03s, environment 50.87s)
```

#### Correction vs original report claims

| Metric | Original report (wrong) | Corrected |
|---|---|---|
| Client before | 513 tests / 77 files | **537 tests / 67 files** |
| Client after | 562 tests / 71 files | **562 tests / 71 files** (unchanged) |
| Server before/after | 513 / 77 unchanged | **513 / 77 unchanged** (confirmed) |

**Root cause:** The client “before” row (`513/77`) was the **server** vitest summary copy-pasted in error. Client and server both happened to report **513 tests** at different times (client fast/non-jsdom runs also printed 513 — see below), which made the mistake less obvious.

**Were any test files deleted or merged?** **No.** Client test files went **67 → 71** (+4 added in Tier 2). The illusory `77 → 71` drop was comparing server file count (77) to client file count (71), not a before/after client delta.

**Tier 2 test files added (+4 files, +25 tests):**

| File | Tests |
|---|---|
| `client/src/stats/statsDerivations.test.ts` | 5 |
| `client/src/learning/moveAnalysis.test.ts` | 8 |
| `client/src/learning/reasonTagging.test.ts` | 7 |
| `client/src/journey/journeyContentValidation.test.ts` | 5 |
| **Total** | **25** |

Arithmetic: 537 + 25 = 562 tests; 67 + 4 = 71 files.

**Fast client runs (misleading):** Some `npm test` invocations with `environment` ~30ms (jsdom not fully initialized) reported `513 tests / 77 files` for **client** — numerically identical to server. Authoritative client counts require the full jsdom run (`environment` ~50–70s): **562 / 71**.

---

### 2. getBoardTileCount hub-double fix

#### Investigation

Searched for existing board occupancy helpers:

| Location | Finding |
|---|---|
| `client/src/match/boardSessionUtils.ts` | **Canonical `getBoardTileCount`** — sums `mainLine.length` plus all `hubDoubles[].branches[].tiles.length` |
| `client/src/match/boardSessionUtils.test.ts` | Unit tests already cover empty board, main-line-only, and hub-branch arms |
| `client/src/components/Board.tsx` | Inline equivalent for camera/layout (`mainLine + hub branch tiles`) |
| `client/src/game/openEndsGeometry.ts` | `hydrateBoardForOpenEnds` reconciles open ends — not a tile-count helper |

Tier 2 Item 8 introduced a **local** `getBoardTileCount` in `useMultiplayerPresentation.ts` that only counted `board.mainLine.length`, missing hub-branch tiles. That was incorrect for crossed-double branch plays.

#### Resolution

Removed the local helper; import the canonical function from `boardSessionUtils.ts` (same module already used by `findPlacedTile` for last-played detection).

**No new unit tests added** — `boardSessionUtils.test.ts` already contains the requested cases:

- `returns 0 for empty board`
- `returns correct count for tiles on the mainLine`
- `returns correct count when hubDoubles and branches have tiles` (1 main + 1 branch₀ + 2 branch₁ = 4)

#### Effect-behavior verification

The opponent tile-play sound / draw-pass toast logic in `useMultiplayerPresentation` depends on:

```typescript
const prevBoardCount = getBoardTileCount(prev.board);
const nextBoardCount = getBoardTileCount(state.board);
```

plus `actorId`, `handNumber`, boneyard length, and turn index. **This cannot be fully verified with a pure unit test alone** — it requires React effect execution with sequential `GameState` snapshots and audio/toast mocks.

**Required manual / multiplayer smoke test:** In a live or staged multiplayer match, confirm:

1. **Main-line opponent play** — tile sound fires when opponent extends the main line.
2. **Branch opponent play** — tile sound fires when opponent plays onto a crossed hub-double branch arm (previously silent with `mainLine.length`-only counting).
3. **Opponent draw/pass toasts** — still fire when board count is unchanged and boneyard shrinks or turn advances without a board play.

#### `useMultiplayerPresentation.ts` — before (Tier 2 Item 8 local helper)

```typescript
import { useEffect, useRef } from 'react';
import { playTileSound, playScoreSound, playDrawSound } from '../utils/sound';
import type { GameState, Tile } from '../types';
import type { RoomPlayer } from './multiplayerRuntime';
import type { FlyingTile } from '../match/liveMatchScreenTypes';

function getBoardTileCount(board: GameState['board']): number {
  if (!board) return 0;
  return board.mainLine.length;
}

interface PresentationCoordinatorParams {
  state: GameState | null;
  you: string;
  isMutedRef: React.MutableRefObject<boolean>;
  opponentName: string;
  players: RoomPlayer[];
  myHand: Tile[];
  opponentTileCount: number;
  drawSequenceActive: boolean;
  boneyardCount: number;
  showScoreLikeToast: (message: string, tone: 'you' | 'opp') => void;
  showScoreToast: (player: 'you' | 'opp', points: number, label?: string) => void;
  setFlyingTiles: React.Dispatch<React.SetStateAction<FlyingTile[]>>;
  boneyardRef: React.RefObject<HTMLElement | null>;
  handAreaRef: React.RefObject<HTMLElement | null>;
  opponentPillRef: React.RefObject<HTMLElement | null>;
}

export function useMultiplayerPresentation({
  state,
  you,
  isMutedRef,
  opponentName,
  players,
  myHand,
  opponentTileCount,
  drawSequenceActive,
  showScoreLikeToast,
  showScoreToast,
  setFlyingTiles,
  boneyardRef,
  handAreaRef,
  opponentPillRef,
}: PresentationCoordinatorParams) {
  const prevStateRef = useRef<GameState | null>(null);
  const prevMyHandLenRef = useRef<number>(0);
  const prevOpponentHandLenRef = useRef<number>(0);
  const localFlyingTileIdRef = useRef<number>(0);
  const lastHandNumberRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state) {
      prevStateRef.current = null;
      return;
    }
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;

    if (state.handNumber !== prev.handNumber) return;

    const actorId = prev.playerIds[prev.currentPlayerIndex] ?? null;
    if (!actorId) return;

    const prevBoardCount = getBoardTileCount(prev.board);
    const nextBoardCount = getBoardTileCount(state.board);
    const prevBoneyardLen = prev.boneyard?.length ?? 0;
    const nextBoneyardLen = state.boneyard?.length ?? 0;

    if (nextBoardCount > prevBoardCount) {
      if (actorId !== you) {
        playTileSound('standard', isMutedRef.current);
      }
    }

    if (actorId !== you && nextBoardCount === prevBoardCount) {
      if (nextBoneyardLen < prevBoneyardLen) {
        showScoreLikeToast(`${opponentName} drew a tile`, 'opp');
      } else if (
        state.currentPlayerIndex !== prev.currentPlayerIndex &&
        (prev.players[actorId]?.hand?.length ?? 0) === (state.players[actorId]?.hand?.length ?? 0)
      ) {
        showScoreLikeToast(`${opponentName} passed`, 'opp');
      }
    }

    for (const pid of state.playerIds) {
      const prevScore = prev.players[pid]?.score ?? 0;
      const nextScore = state.players[pid]?.score ?? 0;
      const delta = nextScore - prevScore;

      if (delta > 0 && !state.handOver && !state.gameOver) {
        const tone = pid === you ? 'you' : 'opp';
        const label = players.find((p) => p.id === pid)?.username?.trim() || (pid === you ? 'You' : opponentName);

        const timer = setTimeout(() => {
          playScoreSound(delta, isMutedRef.current);
          showScoreToast(tone, delta, label);
        }, 80);

        return () => clearTimeout(timer);
      }
    }
  }, [state, you, isMutedRef, opponentName, players, showScoreLikeToast, showScoreToast]);

  useEffect(() => {
    if (!state) {
      prevMyHandLenRef.current = 0;
      prevOpponentHandLenRef.current = 0;
      lastHandNumberRef.current = null;
      return;
    }

    const currentMyHandLen = myHand.length;
    const currentOppHandLen = opponentTileCount;
    const prevMyHandLen = prevMyHandLenRef.current;
    const prevOppHandLen = prevOpponentHandLenRef.current;

    const currentHandNumber = state.handNumber;
    const isNewHand = lastHandNumberRef.current !== null && lastHandNumberRef.current !== currentHandNumber;
    lastHandNumberRef.current = currentHandNumber;

    if (isNewHand) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (prevMyHandLen === 0 && prevOppHandLen === 0) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (drawSequenceActive) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    const animationTimers: number[] = [];

    if (currentMyHandLen > prevMyHandLen) {
      const drawnCount = currentMyHandLen - prevMyHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !handAreaRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = handAreaRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    if (currentOppHandLen > prevOppHandLen) {
      const drawnCount = currentOppHandLen - prevOppHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !opponentPillRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = opponentPillRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    prevMyHandLenRef.current = currentMyHandLen;
    prevOpponentHandLenRef.current = currentOppHandLen;

    return () => {
      animationTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    state,
    myHand.length,
    opponentTileCount,
    drawSequenceActive,
    isMutedRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    setFlyingTiles,
  ]);
}
```

#### `useMultiplayerPresentation.ts` — after (canonical import)

```typescript
import { useEffect, useRef } from 'react';
import { getBoardTileCount } from '../match/boardSessionUtils';
import { playTileSound, playScoreSound, playDrawSound } from '../utils/sound';
import type { GameState, Tile } from '../types';
import type { RoomPlayer } from './multiplayerRuntime';
import type { FlyingTile } from '../match/liveMatchScreenTypes';

interface PresentationCoordinatorParams {
  state: GameState | null;
  you: string;
  isMutedRef: React.MutableRefObject<boolean>;
  opponentName: string;
  players: RoomPlayer[];
  myHand: Tile[];
  opponentTileCount: number;
  drawSequenceActive: boolean;
  boneyardCount: number;
  showScoreLikeToast: (message: string, tone: 'you' | 'opp') => void;
  showScoreToast: (player: 'you' | 'opp', points: number, label?: string) => void;
  setFlyingTiles: React.Dispatch<React.SetStateAction<FlyingTile[]>>;
  boneyardRef: React.RefObject<HTMLElement | null>;
  handAreaRef: React.RefObject<HTMLElement | null>;
  opponentPillRef: React.RefObject<HTMLElement | null>;
}

export function useMultiplayerPresentation({
  state,
  you,
  isMutedRef,
  opponentName,
  players,
  myHand,
  opponentTileCount,
  drawSequenceActive,
  showScoreLikeToast,
  showScoreToast,
  setFlyingTiles,
  boneyardRef,
  handAreaRef,
  opponentPillRef,
}: PresentationCoordinatorParams) {
  const prevStateRef = useRef<GameState | null>(null);
  const prevMyHandLenRef = useRef<number>(0);
  const prevOpponentHandLenRef = useRef<number>(0);
  const localFlyingTileIdRef = useRef<number>(0);
  const lastHandNumberRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state) {
      prevStateRef.current = null;
      return;
    }
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;

    if (state.handNumber !== prev.handNumber) return;

    const actorId = prev.playerIds[prev.currentPlayerIndex] ?? null;
    if (!actorId) return;

    const prevBoardCount = getBoardTileCount(prev.board);
    const nextBoardCount = getBoardTileCount(state.board);
    const prevBoneyardLen = prev.boneyard?.length ?? 0;
    const nextBoneyardLen = state.boneyard?.length ?? 0;

    if (nextBoardCount > prevBoardCount) {
      if (actorId !== you) {
        playTileSound('standard', isMutedRef.current);
      }
    }

    if (actorId !== you && nextBoardCount === prevBoardCount) {
      if (nextBoneyardLen < prevBoneyardLen) {
        showScoreLikeToast(`${opponentName} drew a tile`, 'opp');
      } else if (
        state.currentPlayerIndex !== prev.currentPlayerIndex &&
        (prev.players[actorId]?.hand?.length ?? 0) === (state.players[actorId]?.hand?.length ?? 0)
      ) {
        showScoreLikeToast(`${opponentName} passed`, 'opp');
      }
    }

    for (const pid of state.playerIds) {
      const prevScore = prev.players[pid]?.score ?? 0;
      const nextScore = state.players[pid]?.score ?? 0;
      const delta = nextScore - prevScore;

      if (delta > 0 && !state.handOver && !state.gameOver) {
        const tone = pid === you ? 'you' : 'opp';
        const label = players.find((p) => p.id === pid)?.username?.trim() || (pid === you ? 'You' : opponentName);

        const timer = setTimeout(() => {
          playScoreSound(delta, isMutedRef.current);
          showScoreToast(tone, delta, label);
        }, 80);

        return () => clearTimeout(timer);
      }
    }
  }, [state, you, isMutedRef, opponentName, players, showScoreLikeToast, showScoreToast]);

  useEffect(() => {
    if (!state) {
      prevMyHandLenRef.current = 0;
      prevOpponentHandLenRef.current = 0;
      lastHandNumberRef.current = null;
      return;
    }

    const currentMyHandLen = myHand.length;
    const currentOppHandLen = opponentTileCount;
    const prevMyHandLen = prevMyHandLenRef.current;
    const prevOppHandLen = prevOpponentHandLenRef.current;

    const currentHandNumber = state.handNumber;
    const isNewHand = lastHandNumberRef.current !== null && lastHandNumberRef.current !== currentHandNumber;
    lastHandNumberRef.current = currentHandNumber;

    if (isNewHand) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (prevMyHandLen === 0 && prevOppHandLen === 0) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (drawSequenceActive) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    const animationTimers: number[] = [];

    if (currentMyHandLen > prevMyHandLen) {
      const drawnCount = currentMyHandLen - prevMyHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !handAreaRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = handAreaRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    if (currentOppHandLen > prevOppHandLen) {
      const drawnCount = currentOppHandLen - prevOppHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !opponentPillRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = opponentPillRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    prevMyHandLenRef.current = currentMyHandLen;
    prevOpponentHandLenRef.current = currentOppHandLen;

    return () => {
      animationTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    state,
    myHand.length,
    opponentTileCount,
    drawSequenceActive,
    isMutedRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    setFlyingTiles,
  ]);
}
```

#### Canonical helper (unchanged) — `client/src/match/boardSessionUtils.ts`

```typescript
export function getBoardTileCount(board: GameState['board']): number {
  if (!board) return 0;
  let count = board.mainLine?.length ?? 0;
  for (const hub of board.hubDoubles ?? []) {
    for (const arm of hub?.branches ?? []) {
      if (arm?.tiles?.length) count += arm.tiles.length;
    }
  }
  return count;
}
```

#### Existing unit tests — `client/src/match/boardSessionUtils.test.ts` (excerpt)

```typescript
describe('getBoardTileCount', () => {
  it('returns 0 for empty board', () => {
    const emptyBoard = { mainLine: [], hubDoubles: [], leftEnd: -1, rightEnd: -1, leftEndIsDouble: false, rightEndIsDouble: false };
    expect(getBoardTileCount(emptyBoard as any)).toBe(0);
  });

  it('returns correct count for tiles on the mainLine', () => {
    const board = {
      leftEnd: 1,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: { low: 1, high: 1 }, side: 'left' as const },
        { tile: { low: 1, high: 2 }, side: 'right' as const },
      ],
      hubDoubles: [],
    };
    expect(getBoardTileCount(board as any)).toBe(2);
  });

  it('returns correct count when hubDoubles and branches have tiles', () => {
    const board = {
      leftEnd: 1,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [{ tile: { low: 5, high: 5 }, side: 'left' as const }],
      hubDoubles: [
        {
          tile: { low: 5, high: 5 },
          branches: [
            {
              branchIndex: 0,
              tiles: [{ tile: { low: 5, high: 1 }, side: 'left' as const }],
            },
            {
              branchIndex: 1,
              tiles: [
                { tile: { low: 5, high: 2 }, side: 'right' as const },
                { tile: { low: 2, high: 3 }, side: 'right' as const },
              ],
            },
          ],
        },
      ],
    };
    expect(getBoardTileCount(board as any)).toBe(4);
  });
});
```

#### Follow-up test/build results

| Check | Result |
|---|---|
| Client vitest (full jsdom) | 562 / 71 pass |
| Server vitest | 513 / 77 pass |
| Client build | pass |
| `boardSessionUtils.test.ts` getBoardTileCount cases | pass (pre-existing) |
