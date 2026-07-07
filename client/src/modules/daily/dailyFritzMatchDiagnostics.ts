import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { BOT_MATCH_DEBUG_ENV, hasDebugLocalStorageFlag } from '../match/runtime/botMatchDebug.ts';
import { normalizePreGameDrawTile } from '../../match/preGameDraw/preGameDrawLogic.ts';
import type { Tile } from '../../types.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';

export const DAILY_FRITZ_DEBUG_ENV =
  BOT_MATCH_DEBUG_ENV || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';

export function shouldLogDailyFritzDebug(): boolean {
  return (
    DAILY_FRITZ_DEBUG_ENV ||
    hasDebugLocalStorageFlag('BOT_DEBUG') ||
    hasDebugLocalStorageFlag('DAILY_FRITZ_DEBUG') ||
    hasDebugLocalStorageFlag('DAILY_FRITZ_PROFILE')
  );
}

export function dailyFritzDebugLog(...args: unknown[]): void {
  if (shouldLogDailyFritzDebug()) console.log(...args);
}

export function traceDailyFritzEvent(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (!shouldLogDailyFritzDebug()) return;
  if (typeof window === 'undefined') return;
  const timestamp =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? Number(performance.now().toFixed(2))
      : Date.now();
  const entry = { tag, timestamp, ...payload };
  const win = window as typeof window & {
    __dailyFritzInteractionTrace?: Array<Record<string, unknown>>;
  };
  const bucket = (win.__dailyFritzInteractionTrace ??= []);
  bucket.push(entry);
  if (bucket.length > 400) {
    bucket.splice(0, bucket.length - 400);
  }
  dailyFritzDebugLog(tag, entry);
}

export function isDailyFritzScriptedDrawReady(
  pkg: DailyFritzStartResponse | null | undefined,
): pkg is DailyFritzStartResponse & {
  draw_winner: 'you' | 'bot';
  draw_player_tile: Tile;
  draw_fritz_tile: Tile;
} {
  if (!pkg) return false;
  if (pkg.draw_winner !== 'you' && pkg.draw_winner !== 'bot') return false;
  return (
    normalizePreGameDrawTile(pkg.draw_player_tile) != null &&
    normalizePreGameDrawTile(pkg.draw_fritz_tile) != null
  );
}

export function logDailyFritzScriptedDrawMount(payload: Record<string, unknown>): void {
  console.log('[df-scripted-draw] mount', payload);
}

/** Session storage may contain the pre-game draw shell — that is not a mid-match resume. */
export function isPersistedDailyFritzPlayableResume(match: BotMatchState): boolean {
  return !(
    match.handNumber === 0 &&
    match.players.you.hand.length === 0 &&
    match.players.bot.hand.length === 0 &&
    match.handOver
  );
}