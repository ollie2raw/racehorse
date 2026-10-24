/**
 * Independent-review harness for the game-feel slice: the real LiveMatchScreen (real HUD, rack, Board, CSS) driven through
 * `window.__gf` so a spec can hydrate a populated board, append exactly one public tile, resize, hide the tab, replace the
 * hand, change scores/counters and flip turn ownership - the events the presentation must (or must not) react to.
 * No server, no persistence; nothing here sends messages.
 *
 * Query: up=<n>&down=<n>&left=<n>&right=<n> initial arm lengths; hand=<n>
 */
import '../../src/styles/tokens.css';
import '../../src/styles/rh-mobile-chrome.css';
import '../../src/styles/buttons.css';
import '../../src/styles/toast.css';
import '../../src/styles/lobby.css';
import '../../src/styles/screen-loader.css';
import '../../src/index.css';
import '../../src/premium-theme.css';
import '../../src/styles/walnut-live.css';
import '../../src/styles/rh-glow-underline.css';
import '../../src/styles/rh-soon-pill.css';
import '../../src/styles/game-interactions.css';
import '../../src/styles/match-hud-polish.css';
import '../../src/styles/match-board-architecture.css';
import '../../src/styles/match-gameplay.css';
import '../../src/styles/match-in-game.css';
import '../../src/styles/home-hub.css';
import '../../src/styles/match-standard-live-board.css';
import '../../src/match/gameLayoutLayers.css';
import '../../src/styles/racehorse-background.css';
import '../../src/styles/rh-image-surface.css';
import '../../src/styles/board/index.css';
import '../../src/styles/native-landscape.css';
import '../../src/App.css';
import '../../src/match/match-live.css';
import '../../src/styles/room-lobby.css';
import '../../src/styles/rotate-overlay.css';
import '../../src/styles/match-hud-corner-pills.css';
import '../../src/styles/large-mode.css';
import '../../src/styles/table-theme-toggle.css';
import '../../src/styles/weekly-awards.css';
import '../../src/styles/responsive.css';

import { createRef, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createInitialState, startNewHand } from '@racehorse/game-core';
import type { GameState, Tile } from '../../src/types';
import { AuthProvider } from '../../src/auth/useAuth';
import { LiveMatchScreen } from '../../src/match/LiveMatchScreen';
import type { LiveMatchScreenProps } from '../../src/match/liveMatchScreenTypes';
import { armPosition, armSteps, crossedSpinner, extend } from '../../src/components/board/boardRoutingFixtures';

type Spec = {
  up: number; down: number; left: number; right: number;
  handNumber: number; myScore: number; oppScore: number; boneyard: number; openEnds: number;
  isMine: boolean; recovery: boolean; history: boolean; hand: Tile[]; drawPulse: number | null; selected: Tile | null;
  pulse: boolean; handOver: boolean; gameOver: boolean;
};

const q = new URLSearchParams(location.search);
const n = (k: string, d: number) => Number(q.get(k) ?? d);
const ME = 'rv-me';
const OPP = 'rv-opp';
const base = startNewHand(createInitialState([ME, OPP], { winningScore: 60 }), undefined, ME);
const noop = () => undefined;
const FULL_HAND: Tile[] = [{ low: 0, high: 6 }, { low: 1, high: 6 }, { low: 2, high: 5 }, { low: 4, high: 4 }, { low: 3, high: 5 }];

let spec: Spec = {
  up: n('up', 3), down: n('down', 3), left: n('left', 0), right: n('right', 0),
  handNumber: n('hand', 1), myScore: n('score', 15), oppScore: 12, boneyard: n('boneyard', 10), openEnds: 12,
  isMine: true, recovery: false, history: false, hand: FULL_HAND, drawPulse: null, selected: null,
  pulse: false, handOver: false, gameOver: false,
};
const listeners = new Set<() => void>();

/** Public tile identities on a board (every {low, high} object), to prove a fixture change is a true +N superset. */
function tileIds(board: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.low === 'number' && typeof o.high === 'number') ids.add(`${Math.min(o.low, o.high)}-${Math.max(o.low, o.high)}`);
    else Object.values(o).forEach(walk);
  };
  walk(board);
  return ids;
}
let delta = { added: 0, removed: 0 };
const set = (patch: Partial<Spec>) => {
  const before = tileIds(boardOf(spec));
  spec = { ...spec, ...patch };
  const after = tileIds(boardOf(spec));
  delta = { added: [...after].filter((t) => !before.has(t)).length, removed: [...before].filter((t) => !after.has(t)).length };
  listeners.forEach((l) => l());
};

function boardOf(s: Spec) {
  let fb = crossedSpinner();
  const hubId = fb.board.hubDoubles[0].hubId as number;
  if (s.up) fb = extend(fb, armPosition(hubId, 0), armSteps(s.up));
  if (s.down) fb = extend(fb, armPosition(hubId, 1), armSteps(s.down));
  if (s.left) fb = extend(fb, 'left', armSteps(s.left));
  if (s.right) fb = extend(fb, 'right', armSteps(s.right));
  return fb.board;
}

function Harness() {
  const [s, setS] = useState(spec);
  useEffect(() => { const l = () => setS(spec); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const board = boardOf(s);
  const state = { ...base, board, handNumber: s.handNumber, currentPlayerIndex: s.isMine ? 0 : 1, handOver: s.handOver || s.gameOver, gameOver: s.gameOver, winnerId: s.gameOver ? ME : null } as unknown as GameState;
  const props: LiveMatchScreenProps = {
    shell: { visible: true, state, flyingTiles: [], scoreToast: null },
    identity: { you: ME, opponentId: OPP, opponentName: 'Fritz', myName: 'You', players: [{ id: ME, username: 'You', userId: null }, { id: OPP, username: 'Fritz', userId: null }] },
    hud: {
      myScore: s.myScore, opponentScore: s.oppScore, opponentTileCount: 5, isMyTurn: s.isMine, isHandActive: !s.handOver && !s.gameOver,
      hudScorePulse: {}, hudRightLabel: 'You', hudRightScore: s.myScore, hudRightScorePulse: s.pulse,
      boneyardCount: s.boneyard, openEndsSum: s.openEnds, winTarget: 60,
    },
    board: {
      opponentPillRef: createRef(), boneyardRef: createRef(), boardRef: createRef(), handAreaRef: createRef(), trayCenterRef: createRef(), confettiCanvasRef: createRef(),
      boardForDisplay: board, boardLegalMoves: [], boardSelectedTile: s.selected, lastPlayedTile: null, boardShowOpenEndGlow: false, onPositionClick: noop, historyScrubberEnabled: false,
    },
    hand: {
      myHand: s.hand, handSelectedTile: s.selected, onHandTileSelect: (t: Tile) => set({ selected: t }),
      legalMoves: s.hand.map((t) => ({ tile: t, position: 'left' as const })),
      handTileSize: 56, handCompactStacked: false, drawPulseIndex: s.drawPulse,
    },
    chrome: { scoreTrackOpen: false, onScoreTrackOpenChange: noop, roomReactions: [], onSendRoomEmote: noop, isMuted: true, onToggleMute: noop, isFullscreen: false, onToggleFullscreen: noop },
    connection: { opponentDisconnected: false, opponentDisconnectMessage: null, roomRecoveryState: s.recovery ? 'resyncing' : 'idle', roomRecoveryMessage: 'Restoring the table…', onRetryRoomRecovery: noop },
    tournament: {
      tournamentMatch: null, consumedTournamentGameOverMatchIds: new Set(), tournamentMyLabel: '', tournamentOpponentLabel: '',
      onTournamentViewBracket: noop, onTournamentViewFinalResult: noop, onTournamentReturnToHub: noop,
    } as unknown as LiveMatchScreenProps['tournament'],
    postGame: {
      canUseRematch: false, rematchRequested: false, rematchWaitingText: undefined, onRematch: noop, onPostGame: noop, multiplayerRatingSummary: null,
      onOpenMultiplayerAnalyzer: noop, handReveal: null, handRevealAutoProgress: 0,
    },
    leave: { showLeaveConfirm: false, onRequestLeaveConfirm: noop, onLeaveConfirmDismiss: noop, leaveModalIsTournament: false, onConfirmLeaveMatch: noop },
  };
  return <AuthProvider><div className="app"><LiveMatchScreen {...props} /></div></AuthProvider>;
}

(window as unknown as { __gf: { set: typeof set; get: () => Spec; delta: () => typeof delta } }).__gf = { set, get: () => spec, delta: () => delta };
createRoot(document.getElementById('root')!).render(<Harness />);
