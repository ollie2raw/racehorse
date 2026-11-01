import * as core from '@racehorse/game-core';
import { describe, expect, it } from 'vitest';
import * as client from './openEndsGeometry';

// The scoring-critical open-ends logic exists once, in game-core, the same code
// the server replays against. The client module may only re-export it (plus its
// own dev diagnostics); a second implementation here could show a different
// score in the UI than the server awards.
const SHARED = [
  'auditOpenEndsBoard',
  'branchHasPlayableTiles',
  'branchTipPipFromGeometry',
  'computeOpenEndsSum',
  'endpointPipFromOrientation',
  'explainOpenEndsSum',
  'findHubById',
  'getScoringOpenEndPips',
  'hubIdAt',
  'isBranchHubCrossedGeometrically',
  'isDouble',
  'isHubCrossedGeometrically',
  'isMainlineHubCrossedGeometrically',
  'reconcileBoardOpenEndsMetadata',
  'sanitizeBoardBranchSlots',
  'scoreBranchArm',
] as const;

describe('client open-ends geometry is the core implementation', () => {
  it.each(SHARED)('%s is the same function as game-core', (name) => {
    expect((client as Record<string, unknown>)[name]).toBeDefined();
    expect((client as Record<string, unknown>)[name]).toBe((core as Record<string, unknown>)[name]);
  });

  it('the only client-owned exports are the dev diagnostics and the hydrate wrapper', () => {
    const own = Object.keys(client).filter((key) => !(SHARED as readonly string[]).includes(key)).sort();
    expect(own).toEqual([
      'assertDisplayedOpenCountMatchesCanonical',
      'assertOpenEndsSumConsistent',
      'hydrateBoardForOpenEnds',
      'warnOpenEndsBoardIssues',
    ]);
  });
});
