import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  parseDailyFritzTranscript,
} from '../index';

const valid = () => ({
  protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  rulesVersion: GAME_RULES_VERSION,
  fritzPolicyVersion: FRITZ_POLICY_VERSION,
  fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
  stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  challengeId: 'daily-fritz:2026-07-13:r2:s1',
  attemptId: 'attempt-1',
  gameNumber: 1,
  handIndex: 0,
  actions: [{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' }],
});

describe('Daily Fritz transcript parser', () => {
  it('accepts the strict versioned command transcript', () => {
    expect(parseDailyFritzTranscript(valid()).actions).toHaveLength(1);
  });

  it('accepts historical policy version 1 transcripts for Retry compatibility', () => {
    expect(parseDailyFritzTranscript({
      ...valid(),
      fritzPolicyVersion: 1,
      fritzPolicyContract: getFritzPolicyContract(1),
    }).fritzPolicyVersion).toBe(1);
  });

  it('accepts a policy version 2 transcript so an in-flight attempt survives the v3 bump (GC-6)', () => {
    expect(parseDailyFritzTranscript({
      ...valid(),
      fritzPolicyVersion: 2,
      fritzPolicyContract: getFritzPolicyContract(2),
    }).fritzPolicyVersion).toBe(2);
  });

  it('rejects a policy contract that does not match its implementation version', () => {
    expect(() => parseDailyFritzTranscript({
      ...valid(),
      fritzPolicyContract: getFritzPolicyContract(1),
    })).toThrow(/contract/i);
  });

  it.each([
    { actions: [{ sequence: 1, actor: 'player', kind: 'draw' }] },
    { actions: [{ sequence: 0, actor: 'unknown', kind: 'draw' }] },
    { actions: [{ sequence: 0, actor: 'player', kind: 'play', tile: { low: -1, high: 2 }, position: 'left' }] },
    { actions: [{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 1.5, high: 2 }, position: 'left' }] },
    { actions: [{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 1, high: 2 }, position: 'middle' }] },
    { rulesVersion: 999 },
    { fritzPolicyVersion: 999 },
    { protocolVersion: 999 },
    { claimedScore: 600 },
  ])('rejects malformed or unsupported evidence %#', (override) => {
    expect(() => parseDailyFritzTranscript({ ...valid(), ...override })).toThrow();
  });

  it('rejects unsupported fields nested in a played tile', () => {
    const value = valid();
    expect(() => parseDailyFritzTranscript({
      ...value,
      actions: [{
        ...value.actions[0],
        tile: { ...value.actions[0].tile, score: 600 },
      }],
    })).toThrow(/play action/i);
  });
});
