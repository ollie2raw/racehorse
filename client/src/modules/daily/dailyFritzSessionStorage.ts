import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotHandReveal } from '../match/types.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';
import { createDailyFritzChallengeIdentity, isDailyFritzChallengeCurrent, type DailyFritzChallengeIdentity } from '../../dailyFritz/dailyFritzChallengeIdentity.ts';
import type { DailyFritzTranscript } from '@racehorse/game-core';

// Bump when the local match state is no longer safe to replay against the
// server verifier. Version 4 snapshots may contain pre-verifier Fritz moves.
export const DAILY_FRITZ_SESSION_SCHEMA_VERSION = 5;
export type DailyFritzPersistedPhase = 'active_hand' | 'hand_transition' | 'completed';

export type DailyFritzPersistedSnapshot = {
  schemaVersion: 5;
  challenge: DailyFritzChallengeIdentity;
  classification: 'official';
  attemptId: string;
  gameNumber: number;
  currentHandIndex: number;
  lifecyclePhase: DailyFritzPersistedPhase;
  match: BotMatchState;
  handResult: BotHandReveal | null;
  movesUsed: number;
  moveLog: MoveEntry[];
  transcript: DailyFritzTranscript | null;
  verificationPhase: 'collecting' | 'pending';
  startedAt: string;
  lastTransitionAt: string;
  revision: number;
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nonNegativeInteger = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
const validTile = (value: unknown) => object(value)
  && Number.isInteger(value.low)
  && Number.isInteger(value.high)
  && Number(value.low) >= 0
  && Number(value.low) <= 6
  && Number(value.high) >= 0
  && Number(value.high) <= 6;

function validMatch(value: unknown): value is BotMatchState {
  if (!object(value) || !object(value.players) || !object(value.players.you) || !object(value.players.bot)) return false;
  const you = value.players.you as Record<string, unknown>;
  const bot = value.players.bot as Record<string, unknown>;
  return Array.isArray(you.hand) && you.hand.every(validTile)
    && Array.isArray(bot.hand) && bot.hand.every(validTile)
    && Array.isArray(value.boneyard) && value.boneyard.every(validTile)
    && Array.isArray(value.deadTiles) && value.deadTiles.every(validTile)
    && Number.isFinite(you.score) && Number(you.score) >= 0
    && Number.isFinite(bot.score) && Number(bot.score) >= 0
    && nonNegativeInteger(value.handNumber)
    && typeof value.handOver === 'boolean'
    && typeof value.gameOver === 'boolean';
}

function validChallenge(value: unknown): value is DailyFritzChallengeIdentity {
  return object(value) && typeof value.challengeDate === 'string' && typeof value.challengeId === 'string'
    && Number.isInteger(value.rulesVersion) && Number.isInteger(value.seedVersion);
}
function validHandResult(value: unknown): value is BotHandReveal | null {
  if (value === null) return true;
  return object(value) && (value.winner === 'you' || value.winner === 'bot' || value.winner === null)
    && (value.reason === 'domino' || value.reason === 'blocked')
    && Number.isFinite(value.pointsAwarded) && Number(value.pointsAwarded) >= 0
    && Array.isArray(value.yourRemainingTiles) && value.yourRemainingTiles.every(validTile)
    && Array.isArray(value.botRemainingTiles) && value.botRemainingTiles.every(validTile);
}

export function parseDailyFritzPersistedSnapshot(value: unknown, now = new Date()): DailyFritzPersistedSnapshot | null {
  if (!object(value) || value.schemaVersion !== DAILY_FRITZ_SESSION_SCHEMA_VERSION || value.classification !== 'official') return null;
  if (!validChallenge(value.challenge) || !isDailyFritzChallengeCurrent(value.challenge, now)) return null;
  if (typeof value.attemptId !== 'string' || !value.attemptId || !nonNegativeInteger(value.gameNumber) || !nonNegativeInteger(value.currentHandIndex)) return null;
  if (!['active_hand','hand_transition','completed'].includes(String(value.lifecyclePhase)) || !validMatch(value.match)) return null;
  if (!nonNegativeInteger(value.movesUsed) || !Array.isArray(value.moveLog) || !validHandResult(value.handResult) || !validIso(value.startedAt) || !validIso(value.lastTransitionAt) || Date.parse(value.lastTransitionAt) < Date.parse(value.startedAt) || !nonNegativeInteger(value.revision)) return null;
  const phase = value.lifecyclePhase as DailyFritzPersistedPhase;
  const match = value.match as BotMatchState;
  if (phase === 'active_hand' && (match.handOver || match.gameOver)) return null;
  if (phase === 'hand_transition' && (!match.handOver || match.gameOver || value.handResult === null)) return null;
  if (phase === 'completed' && !match.gameOver) return null;
  const verificationPhase = value.verificationPhase === 'pending' ? 'pending' : 'collecting';
  return {
    ...value,
    schemaVersion: DAILY_FRITZ_SESSION_SCHEMA_VERSION,
    transcript: object(value.transcript) ? value.transcript as unknown as DailyFritzTranscript : null,
    verificationPhase,
  } as unknown as DailyFritzPersistedSnapshot;
}

export function buildDailyFritzStorageKey(attemptId: string, gameNumber: number): string {
  return `racehorse:daily-fritz:v3:${attemptId}:game:${gameNumber}`;
}

export function resolveDailyFritzStorageKey(mode: string, dailyFritzPackage: DailyFritzStartResponse | null | undefined): string | null {
  if (mode !== 'daily-fritz' || !dailyFritzPackage) return null;
  return buildDailyFritzStorageKey(dailyFritzPackage.attempt_id, dailyFritzPackage.current_game_number ?? 1);
}

export function loadPersistedDailyFritzMatch(storageKey: string | null, attemptId: string | undefined, serverHandIndex: number, runDate?: string, now = new Date()): DailyFritzPersistedSnapshot | null {
  if (!storageKey || !attemptId || !runDate || typeof window === 'undefined') return null;
  try {
    // Daily Fritz must survive route changes, reloads, and tab closes. The
    // server still validates every completed hand; this is only the resume
    // checkpoint for the in-progress match.
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = parseDailyFritzPersistedSnapshot(JSON.parse(raw), now);
    if (!parsed || parsed.attemptId !== attemptId || parsed.challenge.challengeId !== createDailyFritzChallengeIdentity(runDate).challengeId || parsed.currentHandIndex < serverHandIndex || parsed.lifecyclePhase === 'completed') return null;
    return parsed;
  } catch { return null; }
}

export function persistDailyFritzSnapshot(storageKey: string, snapshot: DailyFritzPersistedSnapshot): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const existingRaw = window.localStorage.getItem(storageKey);
    const existing = existingRaw ? JSON.parse(existingRaw) as unknown : null;
    if (object(existing)) {
      const revision = Number(existing.revision);
      const transitionAt = typeof existing.lastTransitionAt === 'string'
        ? Date.parse(existing.lastTransitionAt)
        : Number.NaN;
      if (
        (Number.isInteger(revision) && revision > snapshot.revision)
        || (Number.isFinite(transitionAt) && transitionAt > Date.parse(snapshot.lastTransitionAt))
      ) return false;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    return true;
  } catch { return false; }
}

export function pruneNonPlayableDailyFritzSnapshot(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try { const raw=window.localStorage.getItem(storageKey); if(raw && !parseDailyFritzPersistedSnapshot(JSON.parse(raw))) window.localStorage.removeItem(storageKey); } catch { window.localStorage.removeItem(storageKey); }
}
