// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LearnHome from './LearnHome';
import { AuthProvider } from '../auth/useAuth';

vi.mock('../screens/RacehorseHomeArt.css', () => ({}));
vi.mock('../screens/SinglePlayerModes.css', () => ({}));
vi.mock('./learn.css', () => ({}));
vi.mock('./lessonV2', () => ({
  resolveGuidedMatchStart: vi.fn(() => ({ route: 'v2' as const, error: null })),
  loadV2AuthoringSession: vi.fn(() => null),
  loadV2FrozenLesson: vi.fn(() => null),
  freezeV2Lesson: vi.fn(),
}));

describe('LearnHome — The Lab Play flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to noBrainer when The Lab Play is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <LearnHome
        onBack={vi.fn()}
        onNavigate={onNavigate}
      />, { wrapper: AuthProvider });

    const labCard = screen.getByRole('heading', { name: 'The Lab' }).closest('section');
    expect(labCard).toBeTruthy();
    fireEvent.click(within(labCard!).getByRole('button', { name: /^Play$/i }));
    expect(onNavigate).toHaveBeenCalledWith('noBrainer');
  });

  it('navigates to noBrainer when The Lab card is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <LearnHome
        onBack={vi.fn()}
        onNavigate={onNavigate}
      />, { wrapper: AuthProvider });

    fireEvent.click(screen.getByRole('heading', { name: 'The Lab' }));
    expect(onNavigate).toHaveBeenCalledWith('noBrainer');
  });
});
