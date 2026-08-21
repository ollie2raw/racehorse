// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LearnHowToPlayRacehorse from './LearnHowToPlayRacehorse';
import { AuthProvider } from '../auth/useAuth';

describe('LearnHowToPlayRacehorse', () => {
  it('renders the first How to Play lesson module content', () => {
    render(
      <LearnHowToPlayRacehorse
        onBack={vi.fn()}
        onNavigate={vi.fn()}
        onStartGuidedMatch={vi.fn()}
      />, { wrapper: AuthProvider });

    expect(screen.getByText('What Racehorse is')).toBeInTheDocument();
    expect(
      screen.getByText('Fast, forced, scoring-focused dominoes built for the race to 60.'),
    ).toBeInTheDocument();
  });
});
