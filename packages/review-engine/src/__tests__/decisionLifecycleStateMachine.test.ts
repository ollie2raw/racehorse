import { describe, expect, it } from 'vitest';
import {
  assertLifecycleTransition,
  isAllowedLifecycleTransition,
  mayEnterFailedFatal,
  transitionLifecycle,
} from '../decisionLifecycleStateMachine';

describe('decision lifecycle state machine', () => {
  it('allows the happy path PENDING → SEARCHING → SCORED', () => {
    expect(transitionLifecycle('PENDING', 'SEARCHING')).toBe('SEARCHING');
    expect(transitionLifecycle('SEARCHING', 'SCORED')).toBe('SCORED');
  });

  it('allows retry path FAILED_RETRYABLE → PENDING → SEARCHING → SCORED', () => {
    expect(transitionLifecycle('FAILED_RETRYABLE', 'PENDING')).toBe('PENDING');
    expect(transitionLifecycle('PENDING', 'SEARCHING')).toBe('SEARCHING');
    expect(transitionLifecycle('SEARCHING', 'SCORED')).toBe('SCORED');
  });

  it('treats FORCED as terminal', () => {
    expect(isAllowedLifecycleTransition('FORCED', 'SCORED')).toBe(false);
    expect(() => assertLifecycleTransition('FORCED', 'PENDING')).toThrow(/Illegal/);
  });

  it('rejects budget reasons for FAILED_FATAL', () => {
    expect(mayEnterFailedFatal('wall-clock-exhausted')).toBe(false);
    expect(mayEnterFailedFatal('coverage-unreachable')).toBe(false);
    expect(mayEnterFailedFatal('corrupt-snapshot')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(isAllowedLifecycleTransition('SCORED', 'PENDING')).toBe(false);
    expect(isAllowedLifecycleTransition('PENDING', 'FAILED_RETRYABLE')).toBe(false);
  });
});
