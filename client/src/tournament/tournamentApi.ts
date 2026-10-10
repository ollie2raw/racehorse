/**
 * Tournament REST client (Phase 3C).
 *
 * Built on the non-throwing request helpers so a refused request keeps its
 * structured body: status, the stable `error` code, `retryAfterMs`, `reason`,
 * `conflict`, `serverNow`. Every response (success or error) that carries
 * `serverNow` feeds the tournament server clock with its round trip.
 * Failures throw a TournamentApiError whose `message` is the stable code
 * (never backend exception text), so `err.message` stays a code for callers.
 */
import { apiDelete, apiGet, apiPost, type ApiResult } from '../api/client';
import { monotonicNow, observeTournamentRequest } from './tournamentClock';
import type {
  BracketView,
  FritzCupStartResponse,
  ScheduledTournament,
  TournamentFeatures,
  TournamentKind,
  TournamentMyResponse,
  TournamentResultView,
  TournamentUpcomingResponse,
} from './types';

export type TournamentConflict = { tournamentId: string; kind: TournamentKind; scheduledStart: string };

export class TournamentApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly reason: string | null;
  readonly conflict: TournamentConflict | null;
  readonly serverNow: string | null;

  constructor(init: {
    code: string;
    status?: number | null;
    retryAfterMs?: number | null;
    reason?: string | null;
    conflict?: TournamentConflict | null;
    serverNow?: string | null;
  }) {
    super(init.code);
    this.name = 'TournamentApiError';
    this.code = init.code;
    this.status = init.status ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.reason = init.reason ?? null;
    this.conflict = init.conflict ?? null;
    this.serverNow = init.serverNow ?? null;
  }
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(['live', 'fritz_cup']);

function parseConflict(raw: unknown): TournamentConflict | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.tournamentId !== 'string' || typeof c.scheduledStart !== 'string') return null;
  const kind = typeof c.kind === 'string' && KNOWN_KINDS.has(c.kind) ? (c.kind as TournamentKind) : 'live';
  return { tournamentId: c.tournamentId, kind, scheduledStart: c.scheduledStart };
}

/** A stable machine code from a failed result; transport failures become `network`. */
function codeOf(result: ApiResult<unknown>): string {
  const body = result.errorData;
  if (body && typeof body.error === 'string' && /^[a-z0-9_]+$/.test(body.error)) return body.error;
  if (result.status === 401 || result.errorCode === 'auth_required' || result.errorCode === 'session_expired') return 'not_authenticated';
  if (result.status === undefined) return 'network';
  return 'internal';
}

export function toTournamentApiError(result: ApiResult<unknown>): TournamentApiError {
  const body = result.errorData ?? {};
  const retryAfterMs = Number(body.retryAfterMs);
  return new TournamentApiError({
    code: codeOf(result),
    status: result.status ?? null,
    retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : null,
    reason: typeof body.reason === 'string' ? body.reason : null,
    conflict: parseConflict(body.conflict),
    serverNow: typeof body.serverNow === 'string' ? body.serverNow : null,
  });
}

/** One tournament request: times it, feeds the clock, throws a TournamentApiError on failure. */
async function tournamentRequest<T extends object>(send: () => Promise<ApiResult<T>>): Promise<T> {
  const sendMono = monotonicNow();
  const result = await send();
  const receiveMono = monotonicNow();
  const serverNow = (result.data as { serverNow?: unknown } | null)?.serverNow ?? result.errorData?.serverNow;
  observeTournamentRequest(sendMono, receiveMono, serverNow);
  if (result.error || !result.data) throw toTournamentApiError(result as ApiResult<unknown>);
  return result.data;
}

const DISABLED_FEATURES: TournamentFeatures = { tournaments: false, fritzCup: false };

function featuresOf(body: { features?: unknown; disabled?: unknown }): TournamentFeatures {
  const f = body.features as Partial<TournamentFeatures> | undefined;
  if (f && typeof f.tournaments === 'boolean' && typeof f.fritzCup === 'boolean') return { tournaments: f.tournaments, fritzCup: f.fritzCup };
  // A pre-3B server: no feature block. Tournaments are on unless it says disabled; no Fritz Cup.
  return body.disabled === true ? DISABLED_FEATURES : { tournaments: true, fritzCup: false };
}

export async function fetchUpcoming(): Promise<TournamentUpcomingResponse> {
  const r = await tournamentRequest(() => apiGet<{ tournaments?: ScheduledTournament[]; features?: unknown; disabled?: unknown }>('/api/tournaments/upcoming', { auth: false }));
  return { tournaments: r.tournaments ?? [], features: featuresOf(r) };
}

export async function fetchMy(): Promise<TournamentMyResponse> {
  const r = await tournamentRequest(() => apiGet<Partial<TournamentMyResponse> & { disabled?: unknown }>('/api/tournaments/my'));
  return {
    registrations: r.registrations ?? [],
    tournaments: r.tournaments ?? [],
    activeAssignedMatch: r.activeAssignedMatch ?? null,
    features: featuresOf(r),
  };
}

export async function startFritzCup(): Promise<FritzCupStartResponse> {
  const r = await tournamentRequest(() => apiPost<Partial<FritzCupStartResponse>>('/api/tournaments/fritz-cup', {}));
  if (!r.tournament) throw new TournamentApiError({ code: 'internal' });
  return { existing: Boolean(r.existing), tournament: r.tournament, activeAssignedMatch: r.activeAssignedMatch ?? null };
}

export async function fetchBracket(tournamentId: string): Promise<BracketView> {
  const r = await tournamentRequest(() => apiGet<{ view?: BracketView }>(`/api/tournaments/${encodeURIComponent(tournamentId)}/bracket`, { auth: false }));
  if (!r.view) throw new TournamentApiError({ code: 'internal' });
  return r.view;
}

export async function fetchResult(tournamentId: string): Promise<TournamentResultView> {
  const r = await tournamentRequest(() => apiGet<{ result?: TournamentResultView }>(`/api/tournaments/${encodeURIComponent(tournamentId)}/result`, { auth: false }));
  if (!r.result) throw new TournamentApiError({ code: 'internal' });
  return r.result;
}

/** Register the signed-in user (the server takes the user from the token). */
export async function registerForTournament(tournamentId: string): Promise<{ alreadyRegistered: boolean }> {
  const r = await tournamentRequest(() => apiPost<{ alreadyRegistered?: boolean }>(`/api/tournaments/${encodeURIComponent(tournamentId)}/register`, {}));
  return { alreadyRegistered: Boolean(r.alreadyRegistered) };
}

export async function withdrawFromTournament(tournamentId: string): Promise<void> {
  await tournamentRequest(() => apiDelete<{ ok?: boolean }>(`/api/tournaments/${encodeURIComponent(tournamentId)}/register`, {}));
}
