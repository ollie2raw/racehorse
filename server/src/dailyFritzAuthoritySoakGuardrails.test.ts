import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Daily Fritz authority soak guardrails', () => {
  it('runs the complete best-of-three and reports latency percentiles', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/dailyFritzAuthoritySoak.ts'),
      'utf8',
    );
    expect(source).toContain("for (const gameNumber of [2, 3] as const)");
    expect(source).toContain("if (!setResult.setWinner) throw new Error");
    expect(source).toContain('p50ElapsedMs');
    expect(source).toContain('p95ElapsedMs');
    expect(source).toContain('p99ElapsedMs');
  });
});
