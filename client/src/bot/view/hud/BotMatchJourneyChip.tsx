import type { JourneyMatchContext } from '../../../modules/match/contracts/matchScreenProps';
import './botMatchJourneyChip.css';

type BotMatchJourneyChipProps = {
  context: JourneyMatchContext;
};

/**
 * Journey stage context for a match: which stage, who the rival is, the target score and — when the
 * stage configures one — the player's head start. Pure presentation of what the launch provided; it
 * is only rendered for Journey trials, so ordinary matches are untouched.
 */
export function BotMatchJourneyChip({ context }: BotMatchJourneyChipProps) {
  const label = [
    `Journey stage ${context.stageTitle}`,
    `versus ${context.rivalName}`,
    `race to ${context.targetScore}`,
    context.headStartLabel,
  ].filter(Boolean).join(', ');

  return (
    <div className="rh-journey-chip" data-ui="journey-match-context" role="note" aria-label={label}>
      <span className="rh-journey-chip__stage">{context.stageTitle}</span>
      <span className="rh-journey-chip__meta">vs {context.rivalName}</span>
      <span className="rh-journey-chip__meta">Race to {context.targetScore}</span>
      {context.headStartLabel ? (
        <span className="rh-journey-chip__head-start" data-ui="journey-head-start">{context.headStartLabel}</span>
      ) : null}
    </div>
  );
}
