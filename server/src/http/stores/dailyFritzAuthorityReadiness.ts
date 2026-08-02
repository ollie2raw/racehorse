import { isDailyFritzTransactionalAuthorityEnabled } from '../../dailyFritzAuthorityFeature';
import { supabaseFetch } from '../../supabaseUtils';

let available: boolean | null = null;

export function getDailyFritzAuthoritySchemaAvailability(): boolean | null {
  return available;
}

export async function probeDailyFritzAuthoritySchema(): Promise<boolean> {
  if (!isDailyFritzTransactionalAuthorityEnabled()) {
    available = true;
    return true;
  }
  try {
    await Promise.all([
      supabaseFetch('/rest/v1/daily_fritz_attempts?select=revision,current_game_number,challenge_id&limit=0', {
        method: 'GET', timeoutMs: 3_000,
      }),
      supabaseFetch('/rest/v1/daily_fritz_published_challenges?select=challenge_id,content_digest&limit=0', {
        method: 'GET', timeoutMs: 3_000,
      }),
      supabaseFetch('/rest/v1/daily_fritz_attempt_operations?select=operation_id,committed_revision&limit=0', {
        method: 'GET', timeoutMs: 3_000,
      }),
      supabaseFetch('/rest/v1/daily_fritz_verified_hands?select=attempt_id,hand_index&limit=0', {
        method: 'GET', timeoutMs: 3_000,
      }),
      supabaseFetch('/rest/v1/daily_fritz_outbox?select=event_type,analytics_projected_at&limit=0', {
        method: 'GET', timeoutMs: 3_000,
      }),
      supabaseFetch('/rest/v1/daily_fritz_events?select=event_version,failure_phase,recovery_class&limit=0', {
        method: 'GET', timeoutMs: 3_000,
      }),
    ]);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function resetDailyFritzAuthorityReadinessForTests(): void {
  available = null;
}
