/**
 * AU-8 (HARDENING_PLAN §6.3): `social/socialAuth.ts` and
 * `scheduledTournament/tournamentAuth.ts` both resolve a Bearer token through the
 * single canonical `platform/auth/supabaseAuth.verifyBearerToken` (cached,
 * in-flight-deduped, timeout-bounded). This proves all route families share that
 * path AND that tournamentAuth keeps its extra `isValidUuid` +
 * payload-userId-match guards layered on top.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { verifyBearerToken } = vi.hoisted(() => ({ verifyBearerToken: vi.fn() }));
vi.mock('../platform/auth/supabaseAuth', () => ({ verifyBearerToken }));

import { requireAuth } from '../social/socialAuth';
import {
  getUserIdFromBearerToken,
  requireAuthUserId,
  rejectMismatchedPayloadUserId,
} from '../scheduledTournament/tournamentAuth';

const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  res.status.mockReturnValue(res);
  return res;
}
const reqWith = (token: string | null): Request =>
  ({ headers: token ? { authorization: `Bearer ${token}` } : {} }) as unknown as Request;

beforeEach(() => verifyBearerToken.mockReset());

describe('social requireAuth routes through verifyBearerToken', () => {
  it('returns the verified uid on success', async () => {
    verifyBearerToken.mockResolvedValue(UUID);
    const res = makeRes();
    await expect(requireAuth(reqWith('t'), res)).resolves.toBe(UUID);
    expect(verifyBearerToken).toHaveBeenCalledWith('t');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('401s when the canonical path rejects', async () => {
    verifyBearerToken.mockResolvedValue(null);
    const res = makeRes();
    await expect(requireAuth(reqWith('t'), res)).resolves.toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('tournament getUserIdFromBearerToken wraps verifyBearerToken with isValidUuid', () => {
  it('passes through a verified UUID', async () => {
    verifyBearerToken.mockResolvedValue(UUID);
    await expect(getUserIdFromBearerToken('t')).resolves.toBe(UUID);
  });

  it('treats a verified NON-UUID subject as unauthenticated', async () => {
    verifyBearerToken.mockResolvedValue('not-a-uuid');
    await expect(getUserIdFromBearerToken('t')).resolves.toBeNull();
  });

  it('propagates a null from the canonical path', async () => {
    verifyBearerToken.mockResolvedValue(null);
    await expect(getUserIdFromBearerToken('t')).resolves.toBeNull();
  });

  it('requireAuthUserId 401s on a non-UUID subject', async () => {
    verifyBearerToken.mockResolvedValue('not-a-uuid');
    const res = makeRes();
    await expect(requireAuthUserId(reqWith('t'), res)).resolves.toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('tournament payload-userId-match guard still enforced', () => {
  it('rejects a payload userId that differs from the authenticated identity', () => {
    expect(rejectMismatchedPayloadUserId(UUID, OTHER_UUID)).toBe('user_mismatch');
  });
  it('rejects a malformed payload userId', () => {
    expect(rejectMismatchedPayloadUserId(UUID, 'nope')).toBe('invalid_user');
  });
  it('allows an omitted or matching payload userId', () => {
    expect(rejectMismatchedPayloadUserId(UUID, undefined)).toBeNull();
    expect(rejectMismatchedPayloadUserId(UUID, UUID)).toBeNull();
  });
});
