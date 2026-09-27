import { describe, expect, it } from 'vitest';
import type { AppMode } from '../types';
import { resolveSurfacePresentation, SURFACE_BY_MODE } from './surfacePresentation';

const modes: AppMode[] = [
  'home', 'multiplayer', 'singlePlayerHub', 'tournament', 'feed', 'learn',
  'botSetup', 'ghostSetup', 'dailyFritz', 'dailyFritzLeaderboard', 'journey',
  'puzzleRush', 'noBrainer', 'guidedMatchRecorder', 'guidedMatchAnnotator',
  'friends', 'stats', 'ratingHistory', 'leaderboard', 'profile', 'live',
  'bot', 'ghost', 'settings', 'dailyFritzHealthAdmin',
];

const context = (mode: AppMode) => ({
  mode, joinedMatch: false, tournamentView: 'hub' as const, learnLessonOpen: false,
});

describe('surface presentation contract', () => {
  it('maps every AppMode explicitly to complete chrome and scroll metadata', () => {
    expect(Object.keys(SURFACE_BY_MODE).sort()).toEqual([...modes].sort());
    for (const mode of modes) {
      expect(resolveSurfacePresentation(context(mode))).toMatchObject({
        shell: expect.any(String), chrome: expect.any(String),
        scroll: expect.any(String), account: expect.any(String),
      });
    }
  });

  it.each([
    ['home', null], ['multiplayer', 'multiplayer'], ['singlePlayerHub', 'solo'],
    ['tournament', 'tournament'], ['feed', 'social'], ['learn', 'learn'],
  ] as const)('%s is a Hub with its exact primary area', (mode, area) => {
    expect(resolveSurfacePresentation(context(mode))).toMatchObject({
      shell: 'hub', primaryArea: area, chrome: 'hub-tabs', account: 'compact',
    });
  });

  it('makes bracket, lesson, and live match refinements explicit', () => {
    expect(resolveSurfacePresentation({ ...context('tournament'), tournamentView: 'bracket' })).toMatchObject({ shell: 'focused', chrome: 'contextual', parentMode: 'tournament' });
    expect(resolveSurfacePresentation({ ...context('tournament'), tournamentView: 'result' })).toMatchObject({ shell: 'focused', chrome: 'contextual' });
    expect(resolveSurfacePresentation({ ...context('learn'), learnLessonOpen: true })).toMatchObject({ shell: 'focused', chrome: 'contextual', parentMode: 'learn' });
    expect(resolveSurfacePresentation({ ...context('multiplayer'), joinedMatch: true })).toMatchObject({ shell: 'gameplay', chrome: 'none', account: 'hidden', primaryArea: null });
  });
});
