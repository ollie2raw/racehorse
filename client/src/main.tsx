import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { consumeSupabaseRecoveryHash } from './auth/recoveryHash';
import { installGlobalErrorHandlers } from "./debug/globalErrors";
import './styles/tokens.css';
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
  // Exchange recovery tokens before HashRouter/App replace the hash with "#/".
  await consumeSupabaseRecoveryHash();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );
}

void bootstrap();
