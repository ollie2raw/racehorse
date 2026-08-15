import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('authentication boundary guardrails', () => {
  it('keeps the unverified synchronous JWT decoder limited to rate-limit bucketing', () => {
    const indexSource = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const usageCount = indexSource.match(/getUserIdFromAuthHeaderSync/g)?.length ?? 0;

    expect(usageCount).toBe(2); // one import and one rate-limit key extractor
    expect(indexSource).toMatch(
      /const dailySubmitLimit = createRateLimitMiddleware\([\s\S]*?getUserIdFromAuthHeaderSync,\s*\);/,
    );
    expect(indexSource).not.toMatch(/await\s+getUserIdFromAuthHeaderSync/);
    expect(indexSource).not.toMatch(/getUserIdFromAuthHeaderSync\s*\(\s*req/);
  });
});

