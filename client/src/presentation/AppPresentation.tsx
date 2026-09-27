import { useCallback, useState, type ReactNode } from 'react';
import type { AppMode } from '../types';
import { GlobalNav } from '../components/GlobalNav';
import { AppBottomTabBar } from '../components/nav/AppBottomTabBar';
import { RouteChromeOwnedContext, type RouteChromeHints } from './routeChromeContext';
import { GameplayPresentationContext } from './gameplayPresentation';
import { SURFACE_BY_MODE } from './surfacePresentation';
import { navigateContextualBack } from './contextualBack';
import type { SurfacePresentation } from './surfacePresentation';

export function AppPresentation({
  presentation, mode, navigate, contextualBackOverride, openAuth, signOut, children,
}: {
  presentation: SurfacePresentation;
  mode: AppMode;
  navigate: (mode: AppMode) => void;
  contextualBackOverride?: () => void;
  openAuth: () => void;
  signOut: () => void;
  children: ReactNode;
}) {
  const [embeddedGameplayActive, setEmbeddedGameplayActive] = useState(false);
  const [routeChromeHints, setRouteChromeHints] = useState<RouteChromeHints | null>(null);
  const registerChromeHints = useCallback((hints: RouteChromeHints | null) => setRouteChromeHints(hints), []);
  const activePresentation = embeddedGameplayActive ? SURFACE_BY_MODE.bot : presentation;
  const showHeader = activePresentation.shell !== 'gameplay' && activePresentation.account !== 'hidden';
  const showHubTabs = activePresentation.chrome === 'hub-tabs';
  return (
    <div className={`app rh-presentation rh-presentation--${activePresentation.shell}`} data-surface-shell={activePresentation.shell}>
      {showHeader && (
        <GlobalNav
          currentMode={mode}
          primaryArea={presentation.primaryArea}
          accountPresentation={activePresentation.account}
          activeColor={routeChromeHints?.activeColor}
          compactChrome={routeChromeHints?.compactChrome}
          solidDarkChrome={routeChromeHints?.solidDarkChrome}
          contextual={activePresentation.chrome === 'contextual'}
          onBack={presentation.parentMode ? (contextualBackOverride ?? (() => navigateContextualBack(mode, presentation.parentMode!, navigate))) : undefined}
          onNavigate={navigate}
          onOpenAuth={openAuth}
          onSignOut={signOut}
        />
      )}
      <div className="rh-presentation-content" data-scroll-policy={activePresentation.scroll}>
        <RouteChromeOwnedContext.Provider value={registerChromeHints}>
          <GameplayPresentationContext.Provider value={setEmbeddedGameplayActive}>
            {children}
          </GameplayPresentationContext.Provider>
        </RouteChromeOwnedContext.Provider>
      </div>
      {showHubTabs && (
        <AppBottomTabBar primaryArea={presentation.primaryArea} onNavigate={navigate} />
      )}
    </div>
  );
}
