/**
 * The production web CSP must parse cleanly and must let the browser SDK reach
 * Sentry's ingest host.
 *
 * `https://o*.ingest.sentry.io` once sat in connect-src. CSP host-parts only
 * allow `*` as a whole leading label (`*.example.com`), so browsers logged it as
 * an invalid source and ignored it on every page load. This pins the grammar and
 * the hosts we actually depend on, using CSP3's host-part matching (a leading
 * `*.` is a suffix match, i.e. any subdomain depth).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vercel = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

/** Host of the browser DSN (`VITE_SENTRY_DSN`, US region), as served by the production bundle. */
const SENTRY_INGEST_HOST = 'o4511656845312000.ingest.us.sentry.io';

function cspValue(): string {
  const values = vercel.headers.flatMap((rule) =>
    rule.headers.filter((h) => h.key.toLowerCase() === 'content-security-policy').map((h) => h.value),
  );
  expect(values).toHaveLength(1);
  return values[0];
}

function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const raw of policy.split(';')) {
    const [name, ...sources] = raw.trim().split(/\s+/).filter(Boolean);
    if (name) map.set(name.toLowerCase(), sources);
  }
  return map;
}

// CSP3 §2.3.1 host-source: [ scheme "://" ] host-part [ ":" port ] [ path ],
// host-part = "*" / [ "*." ] 1*host-char *( "." 1*host-char ) [ "." ].
const HOST_SOURCE_RE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?)(?::(\d+|\*))?(\/[^;,]*)?$/i;

function isKeywordOrSchemeSource(token: string): boolean {
  return /^'[^']+'$/.test(token) || /^[a-z][a-z0-9+.-]*:$/i.test(token);
}

/** CSP3 §6.7.2.10 host-part matching. */
function hostPartMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) return host.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
  return pattern.toLowerCase() === host.toLowerCase();
}

function allows(sources: string[], url: string): boolean {
  const target = new URL(url);
  const scheme = target.protocol.slice(0, -1);
  return sources.some((token) => {
    const m = HOST_SOURCE_RE.exec(token);
    if (!m) return false;
    const [, srcScheme, hostPart] = m;
    if (srcScheme && srcScheme.toLowerCase() !== scheme) return false;
    return hostPartMatches(hostPart, target.hostname);
  });
}

describe('vercel.json Content-Security-Policy', () => {
  const policy = directives(cspValue());

  it('contains only well-formed sources (wildcards only as a whole leading label)', () => {
    const malformed: string[] = [];
    for (const [name, sources] of policy) {
      for (const token of sources) {
        if (isKeywordOrSchemeSource(token)) continue;
        if (!HOST_SOURCE_RE.test(token)) malformed.push(`${name}: ${token}`);
      }
    }
    expect(malformed).toEqual([]);
  });

  it('lets the browser SDK post envelopes to the Sentry ingest host', () => {
    const connect = policy.get('connect-src') ?? [];
    expect(allows(connect, `https://${SENTRY_INGEST_HOST}/api/1/envelope/`)).toBe(true);
  });

  it('does not open connect-src to unrelated origins', () => {
    const connect = policy.get('connect-src') ?? [];
    expect(allows(connect, 'https://evil.example.com/collect')).toBe(false);
    expect(allows(connect, 'https://sentry.io.evil.example/collect')).toBe(false);
    expect(allows(connect, `http://${SENTRY_INGEST_HOST}/api/1/envelope/`)).toBe(false);
  });

  it('rejects the previously shipped malformed token', () => {
    expect(HOST_SOURCE_RE.test('https://o*.ingest.sentry.io')).toBe(false);
    expect(HOST_SOURCE_RE.test('https://*.ingest.us.sentry.io')).toBe(true);
  });
});
