import type { DailyFritzStartResponse } from '../../../dailyFritz/api.ts';
import { MatchHistoryScrubber } from '../../../modules/replay/index.ts';
import type { MatchHistoryScrubberState } from '../../../modules/replay/index.ts';

type BotMatchLiveTurnHudProps = {
  isDailyFritzMode: boolean;
  dailyFritzPackage: DailyFritzStartResponse | null;
  turnLabel: string;
  botTurn: boolean;
  /** Move-history stepper, when the scrubber applies to this match. */
  historyScrubber?: MatchHistoryScrubberState | null;
};

export function BotMatchLiveTurnHud({
  isDailyFritzMode,
  dailyFritzPackage,
  turnLabel,
  botTurn,
  historyScrubber = null,
}: BotMatchLiveTurnHudProps) {
  return (
    <div
      className={`wl-center-status rh-hud-center ${botTurn ? 'is-fritz-turn' : 'is-player-turn'}`}
      data-ui="turn-status"
    >
      {isDailyFritzMode && dailyFritzPackage && (
        <div className="daily-fritz-progress-pill" data-has-turn-label={!!turnLabel}>
          <span className="hud-pill-label">GAME</span>
          <span className="hud-pill-value">{dailyFritzPackage.current_game_number ?? 1}</span>
        </div>
      )}
      {turnLabel && (
        <span className={`wl-turn-label rh-hud-turn ${botTurn ? 'opp-turn' : 'your-turn'}`}>{turnLabel}</span>
      )}
      {historyScrubber && historyScrubber.total > 0 && (
        <MatchHistoryScrubber scrubber={historyScrubber} />
      )}
    </div>
  );
}
