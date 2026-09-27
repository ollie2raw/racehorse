import type { AppMode } from '../types';
import { buildAppPath } from '../routing/appRoutePath';

/** Direct loads use the declared parent; app-created history entries go back through real route history. */
export function navigateContextualBack(currentMode: AppMode, parentMode: AppMode, navigate: (mode: AppMode) => void) {
  if (window.history.state?.rhAppEntry === true && typeof window.history.state.rhPreviousPath === 'string') {
    window.history.back();
  } else if (currentMode === parentMode) {
    // A directly loaded subview has no app-owned entry to pop. Re-resolve its parent
    // through the existing route listener so tournament/lesson state clears as well.
    const parentPath = buildAppPath({
      mode: parentMode, multiplayerView: 'quick', profileUsername: null,
      learnHowToPlay: false, tournamentId: null, tournamentView: 'hub',
    });
    window.history.replaceState(window.history.state, '', parentPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } else {
    navigate(parentMode);
  }
}
