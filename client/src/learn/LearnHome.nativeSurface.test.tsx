// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

// As production wires it (App.tsx: canOpenHowToPlayPreview = true), so How to
// Play is open and Lesson Library is the only locked card.
const liveProps = { onBack: vi.fn(), onNavigate: vi.fn(), canOpenHowToPlay: true, onOpenHowToPlay: vi.fn() };

describe('LearnHome — coming-soon cards (nativeAppSurface)', () => {
  it('keeps the locked Lesson Library card on the website', () => {
    render(<LearnHome {...liveProps} />, { wrapper: AuthProvider });

    expect(screen.getByRole('heading', { name: 'Lesson Library' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coming Soon' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
  });

  it('leaves out the locked card in the iOS app and lays the rest out as a trio', () => {
    const { container } = render(<LearnHome {...liveProps} hideComingSoon />, {
      wrapper: AuthProvider,
    });

    expect(screen.queryByRole('heading', { name: 'Lesson Library' })).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'How to Play',
      'Guided Match',
      'The Lab',
    ]);
    expect(container.querySelector('.learn-hub-grid--trio')).toBeTruthy();
  });
});
