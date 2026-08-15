import { describe, expect, it, vi } from 'vitest';
import {
  buildFritzChallengeIdentity,
  createGeneratedFritzChallenge,
  generateFritzChallengeHand,
  getFritzChallengeDrawWinner,
} from '../fritzChallenge';
import {
  driveFritzChallengeAttempt,
  parseFritzChallengeLifecycleStart,
} from './fritzChallengeLifecycleDriver';

describe('Fritz Challenge lifecycle driver', () => {
  it('drives an authoritative terminal hand and checks record replay', async () => {
    const challenge = createGeneratedFritzChallenge({
      creatorUserId: 'creator',
      recipientUserId: 'recipient',
      fritzTier: 'master',
      dealSize: 7,
      seed: 'lifecycle-driver-seed',
    });
    const start = parseFritzChallengeLifecycleStart({
      challenge_id: buildFritzChallengeIdentity(challenge),
      verified_match_id: 'attempt-1',
      current_game_number: 1,
      current_hand_index: 0,
      current_game_scores: { you: 59, fritz: 59 },
      fritz_tier: 'master',
      deal_size: 7,
      winning_score: 60,
      first_hand: generateFritzChallengeHand(challenge.seed, 1, 0, 7),
      draw_winner: getFritzChallengeDrawWinner(challenge.seed, 1),
      fritz_policy_version: challenge.versions.fritzPolicyVersion,
      verification_protocol_version: 1,
      game_rules_version: challenge.versions.rulesVersion,
      verifier_version: challenge.versions.verifierVersion,
    });
    let recorded = false;
    const request = vi.fn(async ({ path, body }: { path: string; body: Record<string, unknown> }) => {
      expect(path).toContain('/record-game');
      expect(body).toMatchObject({ attempt_id: 'attempt-1', game_number: 1 });
      const transcript = body.transcript as { actions?: unknown[] };
      expect(transcript.actions?.length).toBeGreaterThan(0);
      if (!recorded) {
        recorded = true;
        return { ok: true, next_game_number: null, set_result: { setWinner: 'player' } };
      }
      return { ok: true, replayed: true, next_game_number: null, set_result: { setWinner: 'player' } };
    });

    const result = await driveFritzChallengeAttempt({
      shareCode: challenge.shareCode,
      start,
      request,
    });

    expect(result).toMatchObject({ attemptId: 'attempt-1', gamesPlayed: 1, handsPlayed: 1 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed authority start payloads before driving commands', () => {
    expect(() => parseFritzChallengeLifecycleStart({ current_game_number: 4 })).toThrow(
      /invalid game number/,
    );
  });
});
