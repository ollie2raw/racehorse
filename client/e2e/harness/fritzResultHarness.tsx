/**
 * E2E-only harness. Vite serves it from e2e/harness; it is not part of the app build. It mounts the real Play vs Fritz
 * result card with fixture review states so it can be measured at phone and desktop sizes without playing a match.
 * Views: ?view=preparing|running|ready|unavailable|plain  (&rating=1 adds a confirmed rating line, &lost=1 a defeat).
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
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayVsFritzResultOverlay } from '../../src/bot/PlayVsFritzResultOverlay';
import type { PostGameReviewView } from '../../src/bot/postGameReviewView';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'ready';
const lost = q.get('lost') === '1';

const base: PostGameReviewView = {
  status: 'ready',
  canOpen: true,
  statusText: 'Analysis complete',
  accuracyText: '87.2%',
  gradeText: 'B',
  progress: null,
  note: null,
  canRetry: false,
  retrying: false,
};

const REVIEWS: Record<string, PostGameReviewView | null> = {
  preparing: { ...base, status: 'preparing', canOpen: false, statusText: 'Preparing your review…', accuracyText: null, gradeText: null },
  running: { ...base, status: 'running', statusText: 'Analyzing 12 of 50 moves', accuracyText: null, gradeText: null, progress: { done: 12, total: 50 } },
  ready: base,
  unavailable: {
    ...base,
    status: 'unavailable',
    statusText: 'Analysis could not finish',
    accuracyText: null,
    gradeText: null,
    note: "We couldn't finish analyzing this game. You can run the analysis again.",
    canRetry: true,
  },
  plain: null,
};

const noop = () => undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlayVsFritzResultOverlay
      won={!lost}
      opponentLabel="Fritz"
      youScore={lost ? 47 : 67}
      botScore={lost ? 66 : 23}
      ratingSlot={q.get('rating') === '1' ? 'Rating +12 · 2256' : undefined}
      review={REVIEWS[view] ?? null}
      onReviewGame={noop}
      onRetryReview={noop}
      onRematch={noop}
      onChangeSetup={noop}
      onHome={noop}
      showHome
    />
  </StrictMode>,
);
