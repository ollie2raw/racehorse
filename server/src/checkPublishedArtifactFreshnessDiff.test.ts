import { describe, expect, it } from 'vitest';
import {
  FRITZ_POLICY_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
} from '@racehorse/game-core';
import {
  buildDailyFritzPublishedChallenge,
  digestDailyFritzChallengeContent,
  getDailyFritzPublishedChallengeContent,
  type DailyFritzPublishedChallenge,
} from './dailyFritzPublishedChallenge';
import type { DailyFritzPublishedChallengeRow } from './http/stores/dailyFritzPublishedChallengeStore';
import {
  diffPublishedArtifactFreshness,
  isFailingFreshnessFinding,
} from '../scripts/checkPublishedArtifactFreshness';

const RUN_DATE = '2026-12-01';

function toRow(
  challenge: DailyFritzPublishedChallenge,
  status: string = 'live',
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
    status: status as DailyFritzPublishedChallengeRow['status'],
    published_at: challenge.publishedAt ?? '2026-11-30T07:00:00.000Z',
    invalidated_at: status === 'invalidated' ? '2026-11-30T12:00:00.000Z' : null,
    invalidation_reason: null,
  };
}

const currentChallenge = buildDailyFritzPublishedChallenge({
  runDate: RUN_DATE,
  fritzTier: 'elite',
  dealSize: 7,
  winningScore: 60,
  publishedAt: '2026-11-30T07:00:00.000Z',
});

/** A fully self-consistent row stamped with a supported *prior* policy version
 *  — the DF-STALE-1 scenario, now absorbed by the reuse-first serving path. */
function stalePolicyRow(): DailyFritzPublishedChallengeRow {
  const prior = FRITZ_POLICY_VERSION - 1;
  if (!isSupportedFritzPolicyVersion(prior)) {
    throw new Error('Test assumes at least two supported Fritz policy versions.');
  }
  const stale: DailyFritzPublishedChallenge = {
    ...currentChallenge,
    fritzPolicyVersion: prior,
    fritzPolicyContract: getFritzPolicyContract(prior),
  };
  const digest = digestDailyFritzChallengeContent(getDailyFritzPublishedChallengeContent(stale));
  return toRow({ ...stale, contentDigest: digest });
}

describe('diffPublishedArtifactFreshness', () => {
  it('is clean for a current-version live row with a matching live run', () => {
    const findings = diffPublishedArtifactFreshness(
      [toRow(currentChallenge)],
      [{ run_date: RUN_DATE, status: 'live' }],
      FRITZ_POLICY_VERSION,
    );
    expect(findings).toEqual([]);
  });

  it('reports a supported-but-behind policy version as stale_tolerated, not a failure', () => {
    const findings = diffPublishedArtifactFreshness(
      [stalePolicyRow()],
      [{ run_date: RUN_DATE, status: 'live' }],
      FRITZ_POLICY_VERSION,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('stale_tolerated');
    expect(isFailingFreshnessFinding(findings[0])).toBe(false);
  });

  it('fails a row whose content_digest no longer matches its package (corruption)', () => {
    const corrupt = { ...toRow(currentChallenge), content_digest: 'deadbeef'.repeat(8) };
    const findings = diffPublishedArtifactFreshness(
      [corrupt],
      [{ run_date: RUN_DATE, status: 'live' }],
      FRITZ_POLICY_VERSION,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unservable');
    expect(isFailingFreshnessFinding(findings[0])).toBe(true);
  });

  it('fails a row whose fritz_policy_version has dropped below the supported floor', () => {
    const unsupported: DailyFritzPublishedChallenge = {
      ...currentChallenge,
      fritzPolicyVersion: 0 as DailyFritzPublishedChallenge['fritzPolicyVersion'],
    };
    const row = toRow(unsupported);
    row.package = getDailyFritzPublishedChallengeContent(unsupported);
    const findings = diffPublishedArtifactFreshness([row], [{ run_date: RUN_DATE, status: 'live' }], FRITZ_POLICY_VERSION);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unservable');
    expect(isFailingFreshnessFinding(findings[0])).toBe(true);
  });

  it('fails a live challenge with no daily_fritz_runs row for its date', () => {
    const findings = diffPublishedArtifactFreshness([toRow(currentChallenge)], [], FRITZ_POLICY_VERSION);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('orphaned_run');
    expect(isFailingFreshnessFinding(findings[0])).toBe(true);
  });

  it('fails a live challenge whose run is invalidated', () => {
    const findings = diffPublishedArtifactFreshness(
      [toRow(currentChallenge)],
      [{ run_date: RUN_DATE, status: 'invalidated' }],
      FRITZ_POLICY_VERSION,
    );
    expect(findings.some((f) => f.kind === 'orphaned_run' && isFailingFreshnessFinding(f))).toBe(true);
  });

  it('warns (non-failing) about a future live run with no published challenge yet', () => {
    const findings = diffPublishedArtifactFreshness([], [{ run_date: RUN_DATE, status: 'live' }], FRITZ_POLICY_VERSION);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('missing_published_row');
    expect(isFailingFreshnessFinding(findings[0])).toBe(false);
  });
});
