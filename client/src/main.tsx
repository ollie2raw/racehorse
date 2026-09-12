import * as Sentry from '@sentry/react';
import { createSentryVolumeGuard } from './lib/sentryVolumeGuard';

// One runaway error must not exhaust the 5k/mo event quota and blind us to
// everything else (PRE_LAUNCH_HARDENING.md §3.1).
const sentryVolumeGuard = createSentryVolumeGuard();

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? '',
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD && Boolean(import.meta.env.VITE_SENTRY_DSN),
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  release: import.meta.env.VITE_APP_VERSION ?? 'unknown',
  beforeSend: (event) => (sentryVolumeGuard.shouldForward(event) ? event : null),
});

if (import.meta.env.DEV && !import.meta.env.VITE_SENTRY_DSN) {
  // eslint-disable-next-line no-console
  console.warn(
    '[Racehorse] Sentry DSN not configured.\n' +
    'Errors will NOT be reported in production until you set VITE_SENTRY_DSN.\n' +
    'Add it to client/.env.local for local dev or to your hosting env vars for production.\n' +
    'Example: VITE_SENTRY_DSN=https://your-key@oXXXXXX.ingest.sentry.io/YYYYYYY',
  );
}

import { StrictMode } from 'react';
import { track } from './lib/analytics';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { consumeSupabaseRecoveryHash } from './auth/recoveryHash';
import { AuthProvider } from './auth/useAuth';
import { installGlobalErrorHandlers } from "./debug/globalErrors";
import { markAppLoadSuccessful } from './debug/moduleImportRecovery';
import { reportWebVitals } from './debug/reportWebVitals';
import { migrateLegacyHashRoute } from './routing/legacyHashRoute';
import './styles/tokens.css';
import './styles/rh-mobile-chrome.css';
import './styles/buttons.css';
import './styles/toast.css';
import './styles/lobby.css';
import './styles/screen-loader.css';
import './index.css';
import './premium-theme.css';
import App from './App.tsx';
import './styles/walnut-live.css';
import './styles/rh-glow-underline.css';
import './styles/game-interactions.css';
import './styles/match-hud-polish.css';
import './styles/match-board-architecture.css';
import './styles/match-gameplay.css';
import './styles/match-in-game.css';
import './styles/home-hub.css';
import './styles/match-standard-live-board.css';
import './match/gameLayoutLayers.css';
import './styles/racehorse-background.css';
import './styles/rh-image-surface.css';
import './styles/board/index.css';

{installGlobalErrorHandlers();}

// Web Vitals → Sentry. Its chunk fetch is guarded inside the module: a
// telemetry chunk failing must never surface as an unhandled rejection.
void reportWebVitals();

async function bootstrap() {
  // DEV-ONLY manual test harness for PuzzleSprintModal — see
  // src/journey/devHarness/PuzzleSprintDevHarness.tsx for why this exists.
  // TEMPORARY: delete this branch (and that whole directory) once real
  // content adopts PuzzleSprintModal (docs/scoping/journey-overhaul-2026-09-12.md
  // §1, PR 6). Bypasses auth/router entirely; never reachable in production
  // (import.meta.env.DEV is statically false in prod builds).
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('puzzleSprintDevHarness')) {
    const { PuzzleSprintDevHarness } = await import('./journey/devHarness/PuzzleSprintDevHarness.tsx');
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <PuzzleSprintDevHarness />
      </StrictMode>,
    );
    return;
  }

  // Recovery tokens use a bare URL hash, so consume them before checking for an
  // old HashRouter route. Legacy "#/…" bookmarks are then promoted to real paths.
  await consumeSupabaseRecoveryHash();
  migrateLegacyHashRoute();

  // Outside React on purpose: one page load, one session_start. An effect here
  // would fire twice under StrictMode in development.
  track('session_start');

  // The app is up: release the one-reload-per-tab guard so a stale deploy
  // weeks from now can still be recovered from. Deferred past render so a
  // subtree that fails to mount does not count as a successful load.
  window.setTimeout(markAppLoadSuccessful, 0);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

void bootstrap();
