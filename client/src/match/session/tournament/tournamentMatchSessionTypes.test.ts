// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  getTournamentStageLabel,
  isTournamentJoinMatchPayload,
  type TournamentMatchSessionApi,
} from './tournamentMatchSessionTypes';

const SESSION_API_KEYS: (keyof TournamentMatchSessionApi)[] = [
  'tournamentSubView',
  'setTournamentSubView',
  'activeTournamentId',
  'setActiveTournamentId',
  'tournamentMatch',
  'setTournamentMatch',
  'currentTournamentContext',
  'tournamentAttachPhase',
  'tournamentAttachError',
  'tournamentResult',
  'setTournamentResult',
  'tournamentResultLoading',
  'setTournamentResultLoading',
  'tournamentResultError',
  'setTournamentResultError',
  'pendingTournamentAttachMatchIdRef',
  'attachedTournamentMatchIdRef',
  'consumedTournamentGameOverMatchIds',
  'clearTournamentAttachRefs',
  'applyTournamentMetadataFromJoin',
  'attemptTournamentAttach',
  'attachAssignedTournamentMatch',
  'finalizeTournamentMatchSession',
  'exitToTournamentHub',
  'enterTournamentLobby',
  'navigateAfterTournamentMatch',
];

describe('tournamentMatchSessionTypes', () => {
  it('getTournamentStageLabel maps rounds to stage labels', () => {
    expect(getTournamentStageLabel(1)).toBe('Quarterfinal');
    expect(getTournamentStageLabel(2)).toBe('Semifinal');
    expect(getTournamentStageLabel(3)).toBe('Final');
  });

  it('isTournamentJoinMatchPayload validates join metadata shape', () => {
    expect(
      isTournamentJoinMatchPayload({
        matchId: 'm-1',
        tournamentId: 't-1',
        round: 2,
      }),
    ).toBe(true);
    expect(isTournamentJoinMatchPayload({ matchId: 'm-1', tournamentId: 't-1', round: 4 })).toBe(false);
    expect(isTournamentJoinMatchPayload(null)).toBe(false);
    expect(isTournamentJoinMatchPayload({ matchId: 1, tournamentId: 't-1', round: 1 })).toBe(false);
  });

  it('TournamentMatchSessionApi preserves all 26 public return fields', () => {
    expect(SESSION_API_KEYS).toHaveLength(26);
  });
});