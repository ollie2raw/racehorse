import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A response must never carry an error's own message: a database error can include the query, a table or a path. Routes answer a failure with
 * `sendServerError(res, err, 'Fixed sentence.')` (http/errors.ts), which shows the real message only while developing.
 *
 * This reads every server source file and, for each `res.json(...)` / `res.status(n).json(...)`, takes the WHOLE call (brace and paren balanced,
 * so a body spread over several lines is seen) and fails if it carries an error's text. The first version of this guard looked one line at a
 * time and missed 16 multi-line bodies.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Responses that may carry an error's own message, and why. Keep this list short and justified. */
const ALLOWED: Record<string, string> = {
  'http/routes/dailyFritzVerificationGlue.ts':
    'Only a DailyFritzVerificationError reaches it (respondVerificationError returns false for anything else); its messages are written by the verifier for the player.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/** The text of the balanced (...) that starts at `open`, the index of its "(". */
function balancedCall(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

const CARRIES_ERROR_TEXT = /\.message\b|String\(\s*(?:error|err|e)\s*\)|instanceof Error/;
const RESPONSE_CALL = /\bres(?:\.status\([^)]*\))?\.json\(/g;

function responsesCarryingErrorText(text: string): number[] {
  const lines: number[] = [];
  for (const match of text.matchAll(RESPONSE_CALL)) {
    const call = balancedCall(text, (match.index ?? 0) + match[0].length - 1);
    if (CARRIES_ERROR_TEXT.test(call)) lines.push(text.slice(0, match.index).split('\n').length);
  }
  return lines;
}

describe('no route sends an error message to the caller', () => {
  it('has no response, however many lines it spans, built from an error\'s text', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED[rel]) continue;
      for (const line of responsesCarryingErrorText(readFileSync(file, 'utf8'))) offenders.push(`${rel}:${line}`);
    }
    expect(offenders, `Use sendServerError(res, err, 'sentence') instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('sees a body spread over several lines (the case the first version of this guard missed)', () => {
    const sample = [
      'try {} catch (error) {',
      '  res.status(500).json({',
      "    error: error instanceof Error ? error.message : 'Failed.',",
      '  });',
      '}',
    ].join('\n');
    expect(responsesCarryingErrorText(sample)).toEqual([2]);
    expect(responsesCarryingErrorText("res.status(500).json({ error: 'Failed.', requestId });")).toEqual([]);
  });

  it('keeps the allowlist honest: every entry still exists and still needs it', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const text = readFileSync(join(SRC, rel), 'utf8');
      expect(responsesCarryingErrorText(text).length, `${rel} no longer carries error text; remove it from ALLOWED`).toBeGreaterThan(0);
    }
  });

  it('is looking at the server source, so an empty result means something', () => {
    const files = walk(SRC).map((file) => relative(SRC, file));
    expect(files).toContain('http/errors.ts');
    expect(files.length).toBeGreaterThan(100);
  });
});
