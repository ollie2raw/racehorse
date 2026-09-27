// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigateContextualBack } from './contextualBack';

const navigate = vi.fn();
afterEach(() => { navigate.mockReset(); window.history.replaceState(null, '', '/'); });

describe('contextual back', () => {
  it('uses an explicit parent for a direct-loaded detail', () => {
    window.history.replaceState(null, '', '/daily-fritz');
    navigateContextualBack('dailyFritz', 'home', navigate);
    expect(navigate).toHaveBeenCalledWith('home');
  });

  it('uses browser history for an app-created detail entry', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    window.history.replaceState({ rhAppEntry: true, rhPreviousPath: '/solo' }, '', '/solo/fritz');
    navigateContextualBack('botSetup', 'singlePlayerHub', navigate);
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('returns a directly loaded same-mode lesson to its parent route', () => {
    window.history.replaceState(null, '', '/learn/how-to-play');
    const pop = vi.fn();
    window.addEventListener('popstate', pop);
    navigateContextualBack('learn', 'learn', navigate);
    expect(window.location.pathname).toBe('/learn');
    expect(pop).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    window.removeEventListener('popstate', pop);
  });

  it('sends a directly loaded Puzzle Rush setup to its declared Home parent', () => {
    window.history.replaceState(null, '', '/puzzle-rush');
    navigateContextualBack('puzzleRush', 'home', navigate);
    expect(navigate).toHaveBeenCalledWith('home');
  });
});
