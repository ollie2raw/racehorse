import type { DailyFritzStartResponse } from './api';
import { createDailyFritzChallengeIdentity } from './dailyFritzChallengeIdentity';
import {
  dailyFritzServerCheckpointToSnapshot,
  reconcileDailyFritzResume,
  type DailyFritzPersistedSnapshot,
} from '../modules/daily/dailyFritzSessionStorage';

/**
 * Resolve Daily Fritz in-match session state from a /start response only.
 * Server `resume_checkpoint` is the sole resume source — localStorage is never read.
 */
export function resolveDailyFritzSession(
  startResponse: DailyFritzStartResponse,
  now = new Date(),
): DailyFritzPersistedSnapshot | null {
  if (!startResponse.attempt_id || !startResponse.run_date) return null;

  const serverRaw = startResponse.resume_checkpoint;
  if (!serverRaw || typeof serverRaw !== 'object') return null;

  const parsed = dailyFritzServerCheckpointToSnapshot(serverRaw, startResponse.run_date, now);
  if (!parsed) return null;

  const reconciled = reconcileDailyFritzResume(parsed, {
    attemptId: startResponse.attempt_id,
    challengeId: startResponse.challenge_id
      ?? createDailyFritzChallengeIdentity(startResponse.run_date).challengeId,
    runFingerprint: startResponse.run_fingerprint,
    cursor: {
      gameNumber: startResponse.current_game_number ?? 1,
      handIndex: startResponse.current_hand_index,
      revision: Number(startResponse.authority_revision ?? 0),
    },
    fritzPolicyVersion: startResponse.fritz_policy_version,
    fritzPolicyContract: startResponse.fritz_policy_contract,
  });

  return reconciled.accepted ? reconciled.snapshot : null;
}
