import type { DailyFritzStartResponse } from '../../../dailyFritz/api.ts';

type BotMatchLiveTurnHudProps = {
  isDailyFritzMode: boolean;
  dailyFritzPackage: DailyFritzStartResponse | null;
  turnLabel: string;
  botTurn: boolean;
};

export function BotMatchLiveTurnHud({
  isDailyFritzMode,
  dailyFritzPackage,
  turnLabel,
  botTurn,
}: BotMatchLiveTurnHudProps) {
  return (
    <div
      className={`wl-center-status ${botTurn ? 'is-fritz-turn' : 'is-player-turn'}`}
      data-ui="turn-status"
    >
      {isDailyFritzMode && dailyFritzPackage && (
        <div className="daily-fritz-progress-pill" data-has-turn-label={!!turnLabel}>
          <span className="hud-pill-label">GAME</span>
          <span className="hud-pill-value">{dailyFritzPackage.current_game_number ?? 1}</span>
        </div>
      )}
      {turnLabel && (
        <span className={`wl-turn-label ${botTurn ? 'opp-turn' : 'your-turn'}`}>{turnLabel}</span>
      )}
    </div>
  );
}
