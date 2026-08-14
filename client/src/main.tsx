import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? '',
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD && Boolean(import.meta.env.VITE_SENTRY_DSN),
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  release: import.meta.env.VITE_APP_VERSION ?? 'unknown',
});

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { consumeSupabaseRecoveryHash } from './auth/recoveryHash';
import { installGlobalErrorHandlers } from "./debug/globalErrors";
import { migrateLegacyHashRoute } from './routing/legacyHashRoute';
import './styles/tokens.css';
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
import './styles/match-standard-live-board.css';
import './match/gameLayoutLayers.css';
import './styles/racehorse-background.css';
import './styles/rh-image-surface.css';
import './styles/board/index.css';

{installGlobalErrorHandlers();}

async function bootstrap() {
  // Recovery tokens use a bare URL hash, so consume them before checking for an
  // old HashRouter route. Legacy "#/…" bookmarks are then promoted to real paths.
  await consumeSupabaseRecoveryHash();
  migrateLegacyHashRoute();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

void bootstrap();
