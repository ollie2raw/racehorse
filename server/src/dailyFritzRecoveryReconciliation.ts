import { classifyDailyFritzRecovery, type DailyFritzRecoveryCandidate } from './dailyFritzRecoveryEligibility';

/** Ownership evidence is optional and must come from an operator's export. */
export function summarizeDailyFritzStaleAttempt(row: DailyFritzRecoveryCandidate, owner?: { email?: string; missing?: boolean }) {
  const eligibility = classifyDailyFritzRecovery(row.result);
  const testDomain = owner?.email?.split('@')[1]?.toLowerCase();
  const ownershipHint = owner?.missing ? 'orphan_candidate' : ['racehorse-test.invalid', 'qa.invalid', 'example.com'].includes(testDomain ?? '') ? 'test_candidate' : 'unknown_or_player';
  const category = eligibility === 'ambiguous' ? 'corrupt_ambiguous'
    : eligibility === 'complete' ? 'complete_normal_recovery'
      : ownershipHint !== 'unknown_or_player' ? 'obvious_qa_test_orphan_candidate' : 'incomplete_potentially_resumable';
  return {
    id: row.id, userId: row.userId, runDate: row.runDate, startedAt: row.startedAt,
    category, eligibility, ownershipHint,
    recommendedAction: eligibility === 'complete' ? 'normal_recovery' : eligibility === 'ambiguous' ? 'operator_review' : 'preserve_resume_state',
    // Neither age nor test ownership is permission to abandon an attempt.
    automaticClosureAllowed: false,
  };
}
