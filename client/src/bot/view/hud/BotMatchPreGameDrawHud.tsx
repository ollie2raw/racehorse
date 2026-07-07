import type { BotMatchViewPreGameDraw } from '../../view-model/botMatchViewModelTypes.ts';
import { buildPreGameDrawHudContent } from '../utils/botMatchHudLabels.ts';

type BotMatchPreGameDrawHudProps = {
  preGameDraw: BotMatchViewPreGameDraw;
  opponentLabel: string;
};

export function BotMatchPreGameDrawHud({ preGameDraw, opponentLabel }: BotMatchPreGameDrawHudProps) {
  const content = buildPreGameDrawHudContent(preGameDraw, opponentLabel);
  if (!content) return null;
  return (
    <div className="wl-center-status" data-ui="turn-status">
      <span className={`wl-turn-label ${content.tone}`} role="status" aria-live="polite">
        {content.label}
      </span>
    </div>
  );
}