/**
 * Regenerates docs/review-explanation-voice-signoff-packet.md from the
 * recorded self-play corpus using a predeclared 10-decision selection.
 *
 * Selection is fixed by decision ID (not cherry-picked at runtime). Categories
 * covered: same-tile/wrong-end, played==reference, value-gap without features,
 * search contested, heuristic contested, true equality, immediate scoring.
 *
 * Product flag REVIEW_POSITIONAL_EXPLANATIONS_ENABLED remains false; this
 * script force-enables positional prose only for sample generation.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewAction } from '@racehorse/game-core/review';
import { buildReviewCoachingFacts, type ReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse } from '../../../../client/src/analyzer/reviewCoachingProse';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SELF_PLAY_DIR = resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play');
const PACKET_PATH = resolve(ROOT, 'docs/review-explanation-voice-signoff-packet.md');

/**
 * Predeclared decision IDs for Gate 2 voice review (deterministic).
 * Drawn from the prior closeout packet + equality/value-gap sample docs.
 */
export const VOICE_SIGNOFF_DECISION_IDS: readonly {
  readonly decisionId: string;
  readonly label: string;
}[] = [
  { decisionId: 'self-play:demo-ordinary-pvf-1:0:move-106', label: 'exact — same tile / wrong end (positional outs)' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:0:move-28', label: 'exact — played == reference (scoring)' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:0:move-105', label: 'exact — value gap without supporting features' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:0:move-68', label: 'search contested — same tile / wrong end' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:0:move-101', label: 'search contested — outs translation' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:4:move-35', label: 'search contested — branch vs branch' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:0:move-45', label: 'heuristic contested — Fritz primary' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:0:move-58', label: 'heuristic contested — close placement' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:1:move-31', label: 'search — true displayed-reference equality' },
  { decisionId: 'self-play:demo-ordinary-pvf-1:0:move-66', label: 'search — value-gap fallback' },
];

function actionText(action: ReviewAction): string {
  if (action.kind === 'play') return `${action.tile.low}-${action.tile.high} at ${action.position}`;
  return action.kind;
}

function featureAudit(facts: ReviewCoachingFacts): string {
  const deltas = facts.featureDeltas ?? [];
  if (deltas.length === 0) return 'no supported feature delta above reporting threshold';
  return deltas
    .slice(0, 4)
    .map((d) => `${d.feature}: played ${d.playedValue}, reference ${d.referenceValue}, delta ${d.delta}`)
    .join('; ');
}

export function writeVoiceSignoffPacket(): { written: number; missing: string[] } {
  const byId = new Map(
    replayRecordedSelfPlay(SELF_PLAY_DIR).map((row) => [row.snapshot.identifiers.decisionId, row]),
  );
  const missing: string[] = [];
  const sections: string[] = [];

  for (const [index, entry] of VOICE_SIGNOFF_DECISION_IDS.entries()) {
    const row = byId.get(entry.decisionId);
    if (!row) {
      missing.push(entry.decisionId);
      continue;
    }
    const facts = buildReviewCoachingFacts(row.evaluation, row.snapshot, true);
    const prose = buildReviewCoachingProse(facts, true);
    const hand = row.snapshot.preAction.actorHand.map((t) => `${t.low}-${t.high}`).join(', ');
    const dead = Math.max(0, row.snapshot.preAction.boneyard.physicalCount - row.snapshot.preAction.boneyard.drawableCount);
    sections.push([
      `## Packet sample ${index + 1} — ${entry.label}`,
      '',
      `- **Decision ID:** \`${entry.decisionId}\``,
      `- **Position:** \`${row.file}\`; score ${row.snapshot.preAction.scores.actor}-${row.snapshot.preAction.scores.opponent}; hand [${hand}]; boneyard ${row.snapshot.preAction.boneyard.drawableCount} drawable / ${dead} dead.`,
      `- **Played:** ${actionText(facts.played.action)} (${facts.played.immediatePoints} immediate points)`,
      `- **Displayed reference:** ${actionText(facts.best.action)} (${facts.referenceSource}; ${facts.best.immediatePoints} immediate points)`,
      `- **Classification / evidence:** missKind=\`${facts.missKind}\`; tier=\`${facts.evidence.source}\`; display=\`${facts.evidence.displayLabel}\``,
      `- **Contested:** ${facts.agreement?.contested ? 'yes' : 'no'}`,
      `- **referenceExpectedPointDifferential:** ${facts.deltas.referenceExpectedPointDifferential === undefined ? 'unavailable' : facts.deltas.referenceExpectedPointDifferential}`,
      `- **Player-facing NEW prose:**`,
      `  - Headline: ${prose.headline}`,
      `  - Why: ${prose.detail || '(none)'}`,
      `  - Takeaway: ${prose.takeaway || '(none)'}`,
      `- **Supporting structured facts (audit):** ${featureAudit(facts)}; immediateΔ=${facts.deltas.immediatePoints}; expectedΔ=${facts.deltas.expectedPointDifferential}.`,
      '',
    ].join('\n'));
  }

  const body = [
    '# Game Review explanation voice — product-owner review packet (10 samples)',
    '',
    '**Status:** PENDING — PRODUCT OWNER VOICE SIGN-OFF',
    '',
    'This packet is for human review only. An agent must not mark Ship Gate 2 complete.',
    '',
    '**Voice pass:** `feat/review-coaching-voice-quality` — coaching translation of structured facts (no oracle/feature/D1–D4 changes).',
    '',
    '**Product flag:** `REVIEW_POSITIONAL_EXPLANATIONS_ENABLED` remains `false`. Samples force-enable positional prose for review only.',
    '',
    '**Selection:** deterministic predeclared decision IDs in `packages/review-engine/src/devtools/writeVoiceSignoffPacket.ts` (`VOICE_SIGNOFF_DECISION_IDS`).',
    '',
    '**Review ask:** Read these 10 NEW prose samples. Approve or reject the voice for admin-cohort enablement of positional explanations.',
    '',
    '---',
    '',
    ...sections,
  ].join('\n');

  writeFileSync(PACKET_PATH, body);
  return { written: sections.length, missing };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(writeVoiceSignoffPacket()));
}
