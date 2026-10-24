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

import { createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createInitialState, startNewHand } from '@racehorse/game-core';
import type { GameState } from '../../src/types';
import { AuthProvider } from '../../src/auth/useAuth';
import { LiveMatchScreen } from '../../src/match/LiveMatchScreen';
import type { LiveMatchScreenProps } from '../../src/match/liveMatchScreenTypes';
import { startFixture, extend } from '../../src/components/board/boardRoutingFixtures';
import { BotMatchScoreToastOverlay } from '../../src/bot/view/board/BotMatchScoreToastOverlay';
import HandOverModal from '../../src/components/handOver/HandOverModal';

// Frontend-only demo: real match presentation, deterministic public board and actions.
// These buttons set display fixtures; they do not send messages or persist results.
const ME = 'fixture-you';
const OPP = 'fixture-opponent';
const opening = startFixture();
const placed = extend(opening, 'left', ['n']).board;
const hand = [{ low: 0, high: 6 }, { low: 1, high: 6 }, { low: 2, high: 5 }, { low: 4, high: 4 }];
const base = startNewHand(createInitialState([ME, OPP], { winningScore: 60 }), undefined, ME);
const noop = () => undefined;
const steps = ['Your turn', 'Fritz thinking', 'Selected', 'Placement', 'Score', 'Draw', 'Hand end', 'Recovery'] as const;

function Harness() {
  const [step, setStep] = useState<string>('Your turn');
  const [event, setEvent] = useState(0);
  const isMine = step !== 'Fritz thinking';
  const hasPlaced = ['Placement', 'Score', 'Draw'].includes(step);
  const board = hasPlaced ? placed : opening.board;
  const drawn = step === 'Draw';
  const score = ['Score', 'Draw', 'Hand end'].includes(step) ? 17 : 15;
  const selected = step === 'Selected' ? hand[0] : null;
  const tiles = drawn ? [...hand.slice(1), { low: 3, high: 5 }] : hasPlaced ? hand.slice(1) : hand;
  const state = { ...base, board, handNumber: 1, currentPlayerIndex: isMine ? 0 : 1 } as unknown as GameState;
  const props: LiveMatchScreenProps = {
    shell: { visible: true, state, flyingTiles: [], scoreToast: null },
    identity: { you: ME, opponentId: OPP, opponentName: 'Fritz', myName: 'You', players: [{ id: ME, username: 'You', userId: null }, { id: OPP, username: 'Fritz', userId: null }] },
    hud: {
      myScore: score, opponentScore: 12, opponentTileCount: drawn ? 6 : 5, isMyTurn: isMine, isHandActive: true,
      hudScorePulse: {}, hudRightLabel: 'You', hudRightScore: score, hudRightScorePulse: step === 'Score',
      boneyardCount: drawn ? 9 : 10, openEndsSum: 12, winTarget: 60,
    },
    board: {
      opponentPillRef: createRef(), boneyardRef: createRef(), boardRef: createRef(), handAreaRef: createRef(), trayCenterRef: createRef(), confettiCanvasRef: createRef(),
      boardForDisplay: board, boardLegalMoves: selected ? [{ tile: hand[0], position: 'left' }] : [],
      boardSelectedTile: selected, lastPlayedTile: hasPlaced ? hand[0] : null, boardShowOpenEndGlow: false, onPositionClick: noop, historyScrubberEnabled: false,
    },
    hand: {
      myHand: tiles, handSelectedTile: selected, onHandTileSelect: () => setStep('Selected'),
      legalMoves: [{ tile: hand[0], position: 'left' }, { tile: hand[1], position: 'right' }],
      handTileSize: 56, handCompactStacked: false, drawPulseIndex: drawn ? tiles.length - 1 : null,
    },
    chrome: { scoreTrackOpen: false, onScoreTrackOpenChange: noop, roomReactions: [], onSendRoomEmote: noop, isMuted: true, onToggleMute: noop, isFullscreen: false, onToggleFullscreen: noop },
    connection: { opponentDisconnected: false, opponentDisconnectMessage: null, roomRecoveryState: step === 'Recovery' ? 'resyncing' : 'idle', roomRecoveryMessage: 'Restoring the table…', onRetryRoomRecovery: noop },
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
  return <AuthProvider>
    <div className="app"><LiveMatchScreen {...props} /></div>
    <div style={{ position: 'fixed', bottom: 4, left: 8, zIndex: 10000, display: 'flex', flexWrap: 'wrap', gap: 4 }} aria-label="Demo states">
      {steps.map(label => <button style={{ background: '#102033', color: '#f4eee3', border: '1px solid #4c6b8a', borderRadius: 4, padding: '4px 7px', fontSize: 11 }} aria-pressed={step === label} key={label} onClick={() => { setStep(label); setEvent(n => n + 1); }}>{label}</button>)}
    </div>
    {step === 'Score' && <div className="bot-match-screen" style={{ position: 'fixed', top: 124, left: '50%', zIndex: 100 }}>
      <BotMatchScoreToastOverlay scoreToast={{ message: 'You scored +2', points: 2, tone: 'you', kind: 'score', eventId: event, visible: true }} />
    </div>}
    {step === 'Hand end' && <HandOverModal variant="sp" pointsAwarded={2} reasonCopy="You emptied your hand and collected 2 points." winnerLabel="You" loserLabel="Fritz" winnerSide="you" tileReveals={[]} loserPips={8} />}
  </AuthProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
