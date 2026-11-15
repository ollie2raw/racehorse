import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENV_SPECS } from '../envSchema';
import { isReviewCpuBenchmarkEnabled } from './reviewCpuBenchmarkFlag';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('REVIEW_CPU_BENCHMARK_ENABLED', () => {
  it('is off by default and off for anything but the exact text "true"', () => {
    vi.stubEnv('REVIEW_CPU_BENCHMARK_ENABLED', '');
    expect(isReviewCpuBenchmarkEnabled()).toBe(false);
    for (const value of ['1', 'TRUE', 'True', 'yes', 'on', 'false', ' true']) {
      vi.stubEnv('REVIEW_CPU_BENCHMARK_ENABLED', value);
      expect(isReviewCpuBenchmarkEnabled()).toBe(false);
    }
    vi.stubEnv('REVIEW_CPU_BENCHMARK_ENABLED', 'true');
    expect(isReviewCpuBenchmarkEnabled()).toBe(true);
  });

  it('is declared in the env schema', () => {
    expect(ENV_SPECS.some((spec) => spec.name === 'REVIEW_CPU_BENCHMARK_ENABLED')).toBe(true);
  });
});
