import { supabaseFetch } from '../../supabaseUtils';
import {
  assertValidDailyFritzPublishedChallenge,
  getDailyFritzPublishedChallengeContent,
  type DailyFritzPublishedChallenge,
  type DailyFritzPublishedChallengeContent,
} from '../../dailyFritzPublishedChallenge';
import type { DailyFritzRunStatus } from '../../dailyFritz';

export type DailyFritzPublishedChallengeRow = {
  challenge_id: string;
  run_date: string;
  contract_version: number;
  generation_version: number;
  seed_version: number;
  product_rules_version: number;
  game_rules_version: number;
  transcript_protocol_version: number;
  verifier_version: number;
  fritz_policy_version: number;
  fritz_policy_contract: string;
  ranking_version: number;
  time_zone: string;
  content_digest: string;
  package: DailyFritzPublishedChallengeContent;
  status: DailyFritzRunStatus;
  published_at: string;
  invalidated_at: string | null;
  invalidation_reason: string | null;
};

export type DailyFritzPublishedChallengeStoreDeps = {
  fetch: typeof supabaseFetch;
};

const DEFAULT_DEPS: DailyFritzPublishedChallengeStoreDeps = { fetch: supabaseFetch };

export function toDailyFritzPublishedChallenge(
  row: DailyFritzPublishedChallengeRow,
): DailyFritzPublishedChallenge {
  const challenge = {
    ...row.package,
    status: row.status,
    contentDigest: row.content_digest,
    publishedAt: row.published_at,
    invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason,
  } as DailyFritzPublishedChallenge;
  assertValidDailyFritzPublishedChallenge(challenge);
  if (
    row.challenge_id !== challenge.challengeId
    || row.run_date !== challenge.runDate
    || row.contract_version !== challenge.contractVersion
    || row.generation_version !== challenge.generationVersion
    || row.seed_version !== challenge.seedVersion
    || row.product_rules_version !== challenge.productRulesVersion
    || row.game_rules_version !== challenge.gameRulesVersion
    || row.transcript_protocol_version !== challenge.transcriptProtocolVersion
    || row.verifier_version !== challenge.verifierVersion
    || row.fritz_policy_version !== challenge.fritzPolicyVersion
    || row.fritz_policy_contract !== challenge.fritzPolicyContract
    || row.ranking_version !== challenge.rankingVersion
    || row.time_zone !== challenge.timeZone
  ) {
    throw new Error('Published Daily Fritz challenge columns do not match the immutable package.');
  }
  return challenge;
}

export async function getDailyFritzPublishedChallenge(
  challengeId: string,
  deps: DailyFritzPublishedChallengeStoreDeps = DEFAULT_DEPS,
): Promise<DailyFritzPublishedChallenge | null> {
  const rows = await deps.fetch<DailyFritzPublishedChallengeRow[]>(
    `/rest/v1/daily_fritz_published_challenges?select=*&challenge_id=eq.${encodeURIComponent(challengeId)}&limit=1`,
    { method: 'GET' },
  );
  return rows?.[0] ? toDailyFritzPublishedChallenge(rows[0]) : null;
}

export async function publishDailyFritzChallenge(
  challenge: DailyFritzPublishedChallenge,
  deps: DailyFritzPublishedChallengeStoreDeps = DEFAULT_DEPS,
): Promise<DailyFritzPublishedChallenge> {
  assertValidDailyFritzPublishedChallenge(challenge);
  const rows = await deps.fetch<DailyFritzPublishedChallengeRow[]>(
    '/rest/v1/rpc/publish_daily_fritz_challenge',
    {
      method: 'POST',
      body: JSON.stringify({
        p_challenge_id: challenge.challengeId,
        p_run_date: challenge.runDate,
        p_contract_version: challenge.contractVersion,
        p_generation_version: challenge.generationVersion,
        p_seed_version: challenge.seedVersion,
        p_product_rules_version: challenge.productRulesVersion,
        p_game_rules_version: challenge.gameRulesVersion,
        p_transcript_protocol_version: challenge.transcriptProtocolVersion,
        p_verifier_version: challenge.verifierVersion,
        p_fritz_policy_version: challenge.fritzPolicyVersion,
        p_fritz_policy_contract: challenge.fritzPolicyContract,
        p_ranking_version: challenge.rankingVersion,
        p_time_zone: challenge.timeZone,
        p_content_digest: challenge.contentDigest,
        p_package: getDailyFritzPublishedChallengeContent(challenge),
        p_published_at: challenge.publishedAt,
      }),
    },
  );
  if (!rows?.[0]) throw new Error('Daily Fritz challenge publication was not confirmed.');
  return toDailyFritzPublishedChallenge(rows[0]);
}

export async function invalidateDailyFritzPublishedChallenge(
  runDate: string,
  reason: string,
  deps: DailyFritzPublishedChallengeStoreDeps = DEFAULT_DEPS,
): Promise<DailyFritzPublishedChallenge> {
  const rows = await deps.fetch<DailyFritzPublishedChallengeRow[]>(
    '/rest/v1/rpc/invalidate_daily_fritz_challenge',
    {
      method: 'POST',
      body: JSON.stringify({ p_run_date: runDate, p_reason: reason }),
    },
  );
  if (!rows?.[0]) throw new Error('Daily Fritz challenge invalidation was not confirmed.');
  return toDailyFritzPublishedChallenge(rows[0]);
}
