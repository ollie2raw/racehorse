import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A response must never carry an error's own message: a database error can include the query, a table or a path. Routes answer a failure with
 * `sendServerError(res, err, 'Fixed sentence.')` (http/errors.ts), which shows the real message only while developing.
 *
 * This reads every server source file and fails on a line that sends `.message` of something in a JSON response. The one place that may is
 * http/errors.ts itself, behind the production check.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('no route sends an error message to the caller', () => {
  it('has no response built from an error\'s .message', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/\bres\b[^;]*\.json\(/.test(line) && /\.message\b/.test(line)) offenders.push(`${relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(offenders, `Use sendServerError(res, err, 'sentence') instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('is looking at the server source, so an empty result means something', () => {
    const files = walk(SRC).map((file) => relative(SRC, file));
    expect(files).toContain('http/errors.ts');
    expect(files.length).toBeGreaterThan(100);
  });
});
