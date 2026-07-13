import type { PlacementPosition, Tile } from './types';
import { GAME_RULES_VERSION } from './versions';
import { FRITZ_POLICY_VERSION } from './fritzPolicy';

export const DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION = 1 as const;
export const DAILY_FRITZ_VERIFIER_VERSION = 1 as const;
export const DAILY_FRITZ_MAX_ACTIONS = 512;
export const DAILY_FRITZ_MAX_TRANSCRIPT_BYTES = 64 * 1024;

export type DailyFritzTranscriptAction =
  | { sequence: number; actor: 'player' | 'fritz'; kind: 'play'; tile: Tile; position: PlacementPosition }
  | { sequence: number; actor: 'player' | 'fritz'; kind: 'draw' | 'pass' };

export type DailyFritzTranscript = {
  protocolVersion: typeof DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION;
  rulesVersion: typeof GAME_RULES_VERSION;
  fritzPolicyVersion: typeof FRITZ_POLICY_VERSION;
  challengeId: string;
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  actions: DailyFritzTranscriptAction[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function parseTile(value: unknown): Tile | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ['low', 'high'])) return null;
  if (!Number.isInteger(value.low) || !Number.isInteger(value.high)) return null;
  const low = Number(value.low);
  const high = Number(value.high);
  if (low < 0 || high < 0 || low > 6 || high > 6) return null;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function parsePosition(value: unknown): PlacementPosition | null {
  if (value === 'left' || value === 'right') return value;
  if (typeof value !== 'string' || !/^branch-\d+-[01]$/.test(value)) return null;
  return value as PlacementPosition;
}

export function parseDailyFritzTranscript(value: unknown): DailyFritzTranscript {
  let serialized = '';
  try { serialized = JSON.stringify(value); } catch { throw new Error('Malformed transcript.'); }
  if (serialized.length > DAILY_FRITZ_MAX_TRANSCRIPT_BYTES) throw new Error('Transcript exceeds size limit.');
  if (!isRecord(value)) throw new Error('Malformed transcript.');
  if (!hasOnlyKeys(value, ['protocolVersion', 'rulesVersion', 'fritzPolicyVersion', 'challengeId', 'attemptId', 'gameNumber', 'handIndex', 'actions'])) {
    throw new Error('Transcript contains unsupported fields.');
  }
  if (value.protocolVersion !== DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION) throw new Error('Unsupported transcript version.');
  if (value.rulesVersion !== GAME_RULES_VERSION) throw new Error('Unsupported rules version.');
  if (value.fritzPolicyVersion !== FRITZ_POLICY_VERSION) throw new Error('Unsupported Fritz policy version.');
  if (typeof value.challengeId !== 'string' || value.challengeId.length < 1 || value.challengeId.length > 160) throw new Error('Invalid challenge id.');
  if (typeof value.attemptId !== 'string' || value.attemptId.length < 1 || value.attemptId.length > 160) throw new Error('Invalid attempt id.');
  if (value.gameNumber !== 1 && value.gameNumber !== 2 && value.gameNumber !== 3) throw new Error('Invalid game number.');
  if (!Number.isSafeInteger(value.handIndex) || Number(value.handIndex) < 0) throw new Error('Invalid hand index.');
  if (!Array.isArray(value.actions) || value.actions.length === 0 || value.actions.length > DAILY_FRITZ_MAX_ACTIONS) throw new Error('Invalid transcript action count.');
  const actions: DailyFritzTranscriptAction[] = value.actions.map((raw, index) => {
    if (!isRecord(raw) || raw.sequence !== index || (raw.actor !== 'player' && raw.actor !== 'fritz')) {
      throw new Error('Transcript action sequence is invalid.');
    }
    if (raw.kind === 'draw' || raw.kind === 'pass') {
      if (!hasOnlyKeys(raw, ['sequence', 'actor', 'kind'])) throw new Error('Transcript action contains unsupported fields.');
      return { sequence: index, actor: raw.actor, kind: raw.kind };
    }
    if (raw.kind !== 'play') throw new Error('Transcript action kind is invalid.');
    if (!hasOnlyKeys(raw, ['sequence', 'actor', 'kind', 'tile', 'position'])) throw new Error('Transcript action contains unsupported fields.');
    const tile = parseTile(raw.tile);
    const position = parsePosition(raw.position);
    if (!tile || !position) throw new Error('Transcript play action is invalid.');
    return { sequence: index, actor: raw.actor, kind: 'play', tile, position };
  });
  return {
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    challengeId: value.challengeId,
    attemptId: value.attemptId,
    gameNumber: value.gameNumber,
    handIndex: Number(value.handIndex),
    actions,
  };
}
