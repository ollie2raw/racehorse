/**
 * Source-level guards for the speed measurements (docs/ops/rum-beacon.md): the claims the privacy policy makes that a unit test of the
 * collector cannot see, and the screens' classes the collector depends on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SELECTORS, SELECTOR_SOURCES } from '../src/rum/rumSelectors';

const src = (file: string) => readFileSync(resolve(__dirname, '../src', file), 'utf8');
const code = (file: string) => src(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the collector stays out of the cold-load bundle', () => {
  it('main.tsx imports only the tiny starter; the collector is a dynamic import', () => {
    const main = src('main.tsx');
    expect(main).toContain("from './rum/startRum'");
    expect(main).not.toContain('rumCollector');
    expect(src('rum/startRum.ts')).toMatch(/import\('\.\/rumCollector'\)/);
  });
});

describe('what the privacy policy says about the device', () => {
  it('nothing in src/rum uses device storage, cookies or an identifier source', () => {
    for (const file of ['rumCollector.ts', 'rumPayload.ts', 'rumSink.ts', 'rumConfig.ts', 'startRum.ts', 'rumSelectors.ts']) {
      expect(code(`rum/${file}`), file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|randomUUID|getRandomValues|userAgent|fingerprint/);
    }
  });
});

describe('rumSelectors contract: the classes the collector watches are still rendered', () => {
  for (const [name, source] of Object.entries(SELECTOR_SOURCES)) {
    it(`${name} (${SELECTORS[name as keyof typeof SELECTORS]}) is in ${source.file}`, () => {
      const text = src(source.file);
      for (const needle of source.needles) expect(text).toContain(needle);
    });
  }
});
