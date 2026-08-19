import * as Sentry from '@sentry/react';

export type DailyFritzOperationalAlert =
  | 'saving_timeout'
  | 'record_game_failed'
  | 'complete_failed'
  | 'cursor_divergence'
  | 'recovery_started'
  | 'recovery_failed'
  | 'transcript_build_failed';

export function reportDailyFritzOperationalAlert(
  alert: DailyFritzOperationalAlert,
  message: string,
  context: Record<string, unknown> = {},
): void {
  Sentry.captureMessage(message, {
    level: alert === 'record_game_failed' || alert === 'complete_failed' || alert === 'recovery_failed'
      ? 'error'
      : 'warning',
    tags: {
      daily_fritz_alert: alert,
    },
    extra: context,
  });
}
