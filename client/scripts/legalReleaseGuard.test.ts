// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateReleaseLegalConfig } from './legalReleaseGuard.mjs';
import { LEGAL_CONFIG } from '../src/legal/legalConfig.mjs';
const valid = { LEGAL_ENTITY_NAME: 'QA Test Operator', SUPPORT_EMAIL: 'qa@example.test', MINIMUM_AGE: '13', POLICY_EFFECTIVE_DATE: '2026-10-13', POSTHOG_LOCATION: 'derived' };
describe('release legal guard', () => {
  it('blocks unresolved owner configuration', () => { expect(validateReleaseLegalConfig(LEGAL_CONFIG).length).toBeGreaterThan(0); });
  it('accepts explicit valid test configuration', () => { expect(validateReleaseLegalConfig(valid)).toEqual([]); });
  it.each(Object.keys(valid))('requires %s', (key) => { expect(validateReleaseLegalConfig({ ...valid, [key]: '' }).length).toBeGreaterThan(0); });
  it('rejects invalid disclosures, dates, emails and ages', () => { expect(validateReleaseLegalConfig({ ...valid, SUPPORT_EMAIL: 'invalid', MINIMUM_AGE: '-1', POLICY_EFFECTIVE_DATE: 'unknown', POSTHOG_LOCATION: 'unknown' })).toHaveLength(4); });
});
