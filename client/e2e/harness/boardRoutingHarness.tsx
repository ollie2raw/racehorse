/**
 * E2E-only harness for board routing geometry. Mounts the real LiveMatchScreen
 * (real HUD, rack, controls and Board camera) with a fixture board built through
 * game-core's real placement (src/components/board/boardRoutingFixtures.ts), so
 * tile bounds, fit scale and HUD/rack clearance can be measured at laptop and
 * phone sizes without a server.
 *
 * Query: fixture=<name in FIXTURES> | custom=1&up=<n>&down=<n>&upDouble=<i,i>&downDouble=<i,i>
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
import { createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createInitialState, startNewHand } from '@racehorse/game-core';
import type { GameState } from '../../src/types';
import { AuthProvider } from '../../src/auth/useAuth';
import { LiveMatchScreen } from '../../src/match/LiveMatchScreen';
import type { LiveMatchScreenProps } from '../../src/match/liveMatchScreenTypes';
import { FIXTURES, armSteps, spinnerWithArms, type FixtureName } from '../../src/components/board/boardRoutingFixtures';
import { installWebPhoneClass } from '../../src/utils/webPhoneClass';

// What main.tsx does at startup: a phone's browser (a touch-only device, not the installed app) gets the compact in-game layout.
// The installed app is simulated by the specs, which set `rh-native` themselves; the two never apply together.
installWebPhoneClass();

// The screen's mount animation (match-board-enter) scales the board container, and
// the camera fits against its transformed getBoundingClientRect: a fit taken
// mid-animation lands ~1% off. Geometry must not depend on that timing, so motion
// is off before React mounts.
const noMotion = document.createElement('style');
noMotion.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
document.head.appendChild(noMotion);

const q = new URLSearchParams(location.search);
const ME = 'me-seat';
const OPP = 'opp-seat';

const FIXED_HAND = [
  { low: 1, high: 6 },
  { low: 2, high: 5 },
  { low: 0, high: 3 },
  { low: 4, high: 4 },
  { low: 2, high: 3 },
  { low: 1, high: 5 },
  { low: 0, high: 6 },
];

const ints = (v: string | null) => (v ? v.split(',').map(Number).filter((n) => Number.isFinite(n)) : []);

function fixtureBoard() {
  if (q.get('custom') === '1') {
    const up = Number(q.get('up') ?? 0);
    const down = Number(q.get('down') ?? 0);
    return spinnerWithArms({
      up: up ? armSteps(up, ints(q.get('upDouble'))) : undefined,
      down: down ? armSteps(down, ints(q.get('downDouble'))) : undefined,
    });
  }
  const name = (q.get('fixture') ?? 'longUp') as FixtureName;
  return FIXTURES[name]();
}

function Harness() {
  const board = fixtureBoard();
  const base = startNewHand(createInitialState([ME, OPP], { winningScore: 30 } as never), undefined, OPP);
  const state = { ...base, board, currentPlayerIndex: base.playerIds.indexOf(OPP) } as unknown as GameState;
  const noop = () => undefined;
  // hand=<1..7> varies the rack, score=<n> the HUD score: neither may move the routing.
  // The rack is a fixed list (the engine deals randomly): pixel baselines and the
  // container height, hence the fit scale, must not vary between runs.
  const myHand = FIXED_HAND.slice(0, Number(q.get('hand') ?? 7));
  const myScore = Number(q.get('score') ?? 15);
  const props: LiveMatchScreenProps = {
    shell: { visible: true, state, flyingTiles: [], scoreToast: null },
    identity: { you: ME, opponentId: OPP, opponentName: 'Opponent', myName: 'You', players: [{ id: ME, username: 'me', userId: 'u-me' }, { id: OPP, username: 'Opponent', userId: null }] },
    hud: {
      myScore, opponentScore: 20, opponentTileCount: state.players[OPP].hand.length, isMyTurn: false, isHandActive: true,
      hudScorePulse: {}, hudRightLabel: 'You', hudRightScore: myScore, hudRightScorePulse: false, boneyardCount: state.boneyard.length, openEndsSum: 10, winTarget: 30,
    },
    board: {
      opponentPillRef: createRef(), boneyardRef: createRef(), boardRef: createRef(), handAreaRef: createRef(), trayCenterRef: createRef(), confettiCanvasRef: createRef(),
      boardForDisplay: board, boardLegalMoves: [], boardSelectedTile: null, lastPlayedTile: null, boardShowOpenEndGlow: false, onPositionClick: noop, historyScrubberEnabled: false,
    },
    hand: {
      myHand, handSelectedTile: null, onHandTileSelect: noop, legalMoves: [],
      handTileSize: 56, handCompactStacked: false, drawPulseIndex: null,
    },
    chrome: { scoreTrackOpen: false, onScoreTrackOpenChange: noop, roomReactions: [], onSendRoomEmote: noop, isMuted: true, onToggleMute: noop, isFullscreen: false, onToggleFullscreen: noop },
    connection: { opponentDisconnected: false, opponentDisconnectMessage: null, roomRecoveryState: 'idle', roomRecoveryMessage: '', onRetryRoomRecovery: noop },
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
  return (
    <AuthProvider>
      <div className="app">
        <LiveMatchScreen {...props} />
      </div>
    </AuthProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
