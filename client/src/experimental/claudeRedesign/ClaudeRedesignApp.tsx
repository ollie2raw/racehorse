import { useEffect, useState } from 'react';
import { ClaudeRedesignDailyFritz, ClaudeRedesignDailyPuzzle } from './ClaudeRedesignDaily';
import { ClaudeRedesignLeaderboard } from './ClaudeRedesignLeaderboard';
import { ClaudeRedesignLanding } from './ClaudeRedesignHome';
import { ClaudeRedesignMulti } from './ClaudeRedesignMulti';
import { ClaudeRedesignSingle } from './ClaudeRedesignSingle';
import { ClaudeRedesignSocial } from './ClaudeRedesignSocial';
import {
  PreviewFrame,
  claudePreviewPath,
  type ClaudeRedesignScreen,
} from './ClaudeRedesignShared';
import './claudeRedesign.css';

function pathToScreen(pathname: string): ClaudeRedesignScreen | null {
  if (pathname !== claudePreviewPath) return null;
  return 'home';
}

export default function ClaudeRedesignApp({ onExit }: { onExit: () => void }) {
  const [screen, setScreen] = useState<ClaudeRedesignScreen>('home');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      const previewScreen = pathToScreen(window.location.pathname);
      if (previewScreen) {
        setScreen('home');
        return;
      }
      onExit();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onExit]);

  const navigate = (next: ClaudeRedesignScreen) => {
    setScreen(next);
    if (typeof window === 'undefined') return;
    if (window.location.pathname !== claudePreviewPath) {
      window.history.pushState({ claudeRedesign: true }, '', claudePreviewPath);
    }
  };

  return (
    <PreviewFrame active={screen === 'multiplayerLobby' ? 'multiplayer' : screen} onNavigate={navigate} onExit={onExit}>
      {screen === 'home' ? <ClaudeRedesignLanding onNavigate={navigate} /> : null}
      {screen === 'single' ? <ClaudeRedesignSingle onNavigate={navigate} /> : null}
      {screen === 'dailyPuzzle' ? <ClaudeRedesignDailyPuzzle onNavigate={navigate} /> : null}
      {screen === 'dailyFritz' ? <ClaudeRedesignDailyFritz onNavigate={navigate} /> : null}
      {screen === 'multiplayer' || screen === 'multiplayerLobby' ? (
        <ClaudeRedesignMulti screen={screen} onNavigate={navigate} />
      ) : null}
      {screen === 'social' ? <ClaudeRedesignSocial onNavigate={navigate} /> : null}
      {screen === 'leaderboard' ? <ClaudeRedesignLeaderboard onNavigate={navigate} /> : null}
    </PreviewFrame>
  );
}
