import { describe, expect, it, vi } from 'vitest';
import { buildDailyFritzPublishedChallenge, getDailyFritzPublishedChallengeContent } from '../../dailyFritzPublishedChallenge';
import {
  getDailyFritzPublishedChallenge,
  invalidateDailyFritzPublishedChallenge,
  publishDailyFritzChallenge,
  type DailyFritzPublishedChallengeRow,
  type DailyFritzPublishedChallengeStoreDeps,
} from './dailyFritzPublishedChallengeStore';

function rowFor(
  challenge: ReturnType<typeof buildDailyFritzPublishedChallenge>,
): DailyFritzPublishedChallengeRow {
  return {
    challenge_id: challenge.challengeId,
    run_date: challenge.runDate,
    contract_version: challenge.contractVersion,
    generation_version: challenge.generationVersion,
    seed_version: challenge.seedVersion,
    product_rules_version: challenge.productRulesVersion,
    game_rules_version: challenge.gameRulesVersion,
    transcript_protocol_version: challenge.transcriptProtocolVersion,
    verifier_version: challenge.verifierVersion,
    fritz_policy_version: challenge.fritzPolicyVersion,
    fritz_policy_contract: challenge.fritzPolicyContract,
    ranking_version: challenge.rankingVersion,
    time_zone: challenge.timeZone,
    content_digest: challenge.contentDigest,
    package: getDailyFritzPublishedChallengeContent(challenge),
    status: challenge.status,
    published_at: challenge.publishedAt,
    invalidated_at: challenge.invalidatedAt,
    invalidation_reason: challenge.invalidationReason,
  };
}

describe('Daily Fritz published challenge store', () => {
  it('publishes through the identity-conflict-safe RPC', async () => {
    const challenge = buildDailyFritzPublishedChallenge({
      runDate: '2026-08-01',
      publishedAt: '2026-08-01T07:00:00.000Z',
    });
    const fetch = vi.fn(async () => [rowFor(challenge)]) as DailyFritzPublishedChallengeStoreDeps['fetch'];

    await expect(publishDailyFritzChallenge(challenge, { fetch }))
      .resolves.toMatchObject({ challengeId: challenge.challengeId, contentDigest: challenge.contentDigest });
    expect(fetch).toHaveBeenCalledWith(
      '/rest/v1/rpc/publish_daily_fritz_challenge',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.p_package).not.toHaveProperty('publishedAt');
    expect(body.p_content_digest).toBe(challenge.contentDigest);
  });

  it('reads and validates immutable package/column parity', async () => {
    const challenge = buildDailyFritzPublishedChallenge({ runDate: '2026-08-01' });
    const fetch = vi.fn(async () => [rowFor(challenge)]) as DailyFritzPublishedChallengeStoreDeps['fetch'];
    await expect(getDailyFritzPublishedChallenge(challenge.challengeId, { fetch }))
      .resolves.toMatchObject({ challengeId: challenge.challengeId });
  });

  it('fails closed when indexed version columns disagree with package authority', async () => {
    const challenge = buildDailyFritzPublishedChallenge({ runDate: '2026-08-01' });
    const fetch = vi.fn(async () => [{ ...rowFor(challenge), game_rules_version: 999 }]) as DailyFritzPublishedChallengeStoreDeps['fetch'];
    await expect(getDailyFritzPublishedChallenge(challenge.challengeId, { fetch }))
      .rejects.toThrow('columns do not match');
  });

  it('invalidates legacy and published authority through one RPC', async () => {
    const live = buildDailyFritzPublishedChallenge({ runDate: '2026-08-01' });
    const invalidated = {
      ...live,
      status: 'invalidated' as const,
      invalidatedAt: '2026-08-01T20:00:00.000Z',
      invalidationReason: 'operator test',
    };
    const fetch = vi.fn(async () => [rowFor(invalidated)]) as DailyFritzPublishedChallengeStoreDeps['fetch'];
    await expect(invalidateDailyFritzPublishedChallenge(live.runDate, 'operator test', { fetch }))
      .resolves.toMatchObject({ status: 'invalidated', invalidationReason: 'operator test' });
    expect(fetch).toHaveBeenCalledWith(
      '/rest/v1/rpc/invalidate_daily_fritz_challenge',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
