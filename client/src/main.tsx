import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
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
import './match/gameLayoutLayers.css';
import './styles/racehorse-background.css';

{installGlobalErrorHandlers();}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
