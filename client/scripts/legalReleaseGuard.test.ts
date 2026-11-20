// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { defaultSampleRate, privacyTextSampleRate, validateReleaseLegalConfig, validateRumSampleRate } from './legalReleaseGuard.mjs';
import { LEGAL_CONFIG } from '../src/legal/legalConfig.mjs';
const valid = { LEGAL_ENTITY_NAME: 'QA Test Operator', SUPPORT_EMAIL: 'qa@example.test', MINIMUM_AGE: '13', POLICY_EFFECTIVE_DATE: '2026-10-13', POSTHOG_LOCATION: 'derived' };
describe('release legal guard', () => {
  it('blocks unresolved owner configuration', () => { expect(validateReleaseLegalConfig(LEGAL_CONFIG).length).toBeGreaterThan(0); });
  it('accepts explicit valid test configuration', () => { expect(validateReleaseLegalConfig(valid)).toEqual([]); });
  it.each(Object.keys(valid))('requires %s', (key) => { expect(validateReleaseLegalConfig({ ...valid, [key]: '' }).length).toBeGreaterThan(0); });
  it('rejects invalid disclosures, dates, emails and ages', () => { expect(validateReleaseLegalConfig({ ...valid, SUPPORT_EMAIL: 'invalid', MINIMUM_AGE: '-1', POLICY_EFFECTIVE_DATE: 'unknown', POSTHOG_LOCATION: 'unknown' })).toHaveLength(4); });
});

const clientRoot = join(__dirname, '..');
const textRate = privacyTextSampleRate(readFileSync(join(clientRoot, 'src/legal/legalContent.mjs'), 'utf8'));
const defaultRate = defaultSampleRate(readFileSync(join(clientRoot, 'src/rum/rumConfig.ts'), 'utf8'));

describe('the speed-measurement sample rate cannot drift from the privacy text', () => {
  it('the real files agree: the text says one in four and the default is 0.25', () => {
    expect(textRate).toBe(0.25);
    expect(defaultRate).toBe(0.25);
    expect(validateRumSampleRate({ raw: undefined, defaultRate, textRate })).toEqual([]);
  });
  it.each([undefined, '', '0', '0.25', '.25', '0.250'])('accepts VITE_RUM_SAMPLE_RATE=%s', (raw) => {
    expect(validateRumSampleRate({ raw, defaultRate: 0.25, textRate: 0.25 })).toEqual([]);
  });
  it.each(['1', '0.5', '0.1', '0.01', '25'])('rejects VITE_RUM_SAMPLE_RATE=%s (the text promises one in four)', (raw) => {
    expect(validateRumSampleRate({ raw, defaultRate: 0.25, textRate: 0.25 }).length).toBeGreaterThan(0);
  });
  it.each(['abc', '0,25', 'NaN'])('rejects the unreadable value %s that would silently switch measurements off', (raw) => {
    expect(validateRumSampleRate({ raw, defaultRate: 0.25, textRate: 0.25 }).length).toBeGreaterThan(0);
  });
  it('fails when the code default and the text disagree, in either direction', () => {
    expect(validateRumSampleRate({ raw: undefined, defaultRate: 0.5, textRate: 0.25 }).length).toBeGreaterThan(0);
    expect(validateRumSampleRate({ raw: undefined, defaultRate: 0.25, textRate: 0.1 }).length).toBeGreaterThan(0);
  });
  it('fails (rather than passing vacuously) when either source cannot be read', () => {
    expect(validateRumSampleRate({ raw: undefined, defaultRate: 0.25, textRate: null }).length).toBeGreaterThan(0);
    expect(validateRumSampleRate({ raw: undefined, defaultRate: null, textRate: 0.25 }).length).toBeGreaterThan(0);
  });
  it('reads the sentence in several wordings and rejects other text', () => {
    expect(privacyTextSampleRate('there is about a one in four chance that')).toBe(0.25);
    expect(privacyTextSampleRate('about one in ten chance')).toBe(0.1);
    expect(privacyTextSampleRate('there is a chance')).toBeNull();
  });
});

describe('the release guard command enforces the sample rate (what `npm run build` runs)', () => {
  const run = (rate: string | undefined) => spawnSync(process.execPath, [join(clientRoot, 'scripts/legalReleaseGuard.mjs'), 'production'], {
    cwd: clientRoot,
    env: { ...process.env, ...Object.fromEntries(Object.entries(valid).map(([k, v]) => [`VITE_LEGAL_${k}`, v])), ...(rate === undefined ? { VITE_RUM_SAMPLE_RATE: '' } : { VITE_RUM_SAMPLE_RATE: rate }) },
    encoding: 'utf8',
  });
  it('passes with a valid legal config and the default, 0 or 0.25', () => {
    for (const rate of [undefined, '0', '0.25']) expect(run(rate).status, `rate ${rate}`).toBe(0);
  });
  it('fails the build when the rate differs from the privacy text', () => {
    const result = run('1');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_RUM_SAMPLE_RATE 1 does not match the privacy text');
  });
});
