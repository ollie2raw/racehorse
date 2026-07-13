export const SPECTATOR_SCHEMA_VERSION = 1 as const;
export const SPECTATOR_MOVE_FEED_LIMIT = 30;
export const SPECTATOR_DISCOVERY_LIMIT = 50;
export type SpectatorSessionKind = 'multiplayer_match' | 'daily_fritz';
export type SpectatorStatus = 'waiting' | 'active' | 'paused' | 'completed' | 'ended';
export type SpectatorParticipantSummary = { userId: string | null; displayName: string; avatarUrl: string | null; score: number; handCount: number; connectionStatus?: 'connected' | 'reconnecting' | 'disconnected' };
export type SpectatorMoveFeedEntry = { id: string; sequence: number; timestamp: string; participantName: string | null; kind: 'played' | 'drew' | 'passed' | 'hand_ended' | 'score_awarded' | 'completed' | 'broadcast_started' | 'broadcast_ended'; tile?: { low: number; high: number }; position?: string; message: string };
export type SpectatorPublicResult = { winnerDisplayName: string | null; finalScores: number[]; reason: string };
export type SpectatorPublicSnapshot = { schemaVersion: 1; sessionId: string; kind: SpectatorSessionKind; sequence: number; status: SpectatorStatus; board: unknown; participants: SpectatorParticipantSummary[]; activeParticipantIndex: number | null; consecutivePasses: number; boneyardCount: number; handNumber: number; publicMoveFeed: SpectatorMoveFeedEntry[]; spectatorCount: number; startedAt: string; updatedAt: string; completedAt: string | null; result: SpectatorPublicResult | null };
export type SpectatorSessionSummary = Pick<SpectatorPublicSnapshot, 'sessionId' | 'kind' | 'status' | 'sequence' | 'participants' | 'handNumber' | 'spectatorCount' | 'startedAt' | 'updatedAt' | 'completedAt'>;
export type SpectatorListRequest = { kind?: SpectatorSessionKind | 'all'; limit?: number };
export type SpectatorJoinRequest = { sessionId: string };
export type DailyFritzBroadcastStart = { runId: string; snapshot: Omit<SpectatorPublicSnapshot, 'schemaVersion' | 'sessionId' | 'kind' | 'spectatorCount'> };
export type DailyFritzBroadcastUpdate = { sessionId: string; sequence: number; snapshot: Omit<SpectatorPublicSnapshot, 'schemaVersion' | 'sessionId' | 'kind' | 'spectatorCount'> };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export function isSpectatorListRequest(value: unknown): value is SpectatorListRequest { return object(value) && (value.kind === undefined || ['all','multiplayer_match','daily_fritz'].includes(String(value.kind))) && (value.limit === undefined || Number.isInteger(value.limit) && Number(value.limit) > 0 && Number(value.limit) <= SPECTATOR_DISCOVERY_LIMIT); }
export function isSpectatorJoinRequest(value: unknown): value is SpectatorJoinRequest { return object(value) && nonEmpty(value.sessionId); }
export function isSpectatorPublicSnapshot(value: unknown): value is SpectatorPublicSnapshot { if (!object(value) || value.schemaVersion !== 1 || !nonEmpty(value.sessionId) || !['multiplayer_match','daily_fritz'].includes(String(value.kind)) || !Number.isInteger(value.sequence) || Number(value.sequence) < 0 || !['waiting','active','paused','completed','ended'].includes(String(value.status)) || !Array.isArray(value.participants) || !Array.isArray(value.publicMoveFeed) || value.publicMoveFeed.length > SPECTATOR_MOVE_FEED_LIMIT || !Number.isInteger(value.boneyardCount) || Number(value.boneyardCount) < 0) return false; return value.participants.every((participant) => object(participant) && nonEmpty(participant.displayName) && Number.isFinite(participant.score) && Number.isInteger(participant.handCount) && Number(participant.handCount) >= 0); }
const FORBIDDEN_SPECTATOR_KEYS = new Set(['hand','boneyard','authToken','recoveryToken','inviteCode','verificationToken','randomSeed','socketId','boneyardOrder','plannedMove','opponentKnownMissing']);
function assertNoPrivateKeys(value: unknown): void { if (Array.isArray(value)) { value.forEach(assertNoPrivateKeys); return; } if (!object(value)) return; for (const [key, nested] of Object.entries(value)) { if (FORBIDDEN_SPECTATOR_KEYS.has(key)) throw new Error(`Spectator payload contains forbidden field ${key}.`); assertNoPrivateKeys(nested); } }
export function assertSpectatorSnapshotSafe(snapshot: SpectatorPublicSnapshot): void { if (!isSpectatorPublicSnapshot(snapshot)) throw new Error('Malformed spectator public snapshot.'); assertNoPrivateKeys(snapshot); }
