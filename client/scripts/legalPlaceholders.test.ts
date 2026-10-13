/**
 * Owner placeholders for the legal pages.
 *
 * 1. Lists what the owner still has to decide (printed, so it shows in CI logs).
 * 2. Keeps those facts in one place: no email address, company name, age or
 *    placeholder token may be typed anywhere in the legal sources except
 *    legalConfig.mjs — otherwise filling in the config would leave a stale
 *    copy somewhere else on the page.
 * 3. Checks the pages render a placeholder as an honest visible label, never
 *    as the raw token and never as an invented value.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_CONFIG,
  LEGAL_PLACEHOLDER_LABELS,
  isOwnerPlaceholder,
  legalPlaceholdersOutstanding,
  legalText,
  posthogDerivesLocation,
  supportEmailAddress,
  type LegalConfig,
} from '../src/legal/legalConfig.mjs';
import { LEGAL_DOCUMENTS } from '../src/legal/legalContent.mjs';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legalDir = path.join(clientDir, 'src/legal');

/** Every source that renders legal copy or links, other than the config itself. */
const LEGAL_SOURCES = [
  ...readdirSync(legalDir)
    .filter((file) => /\.(tsx?|mjs|css)$/.test(file))
    .filter((file) => !file.startsWith('legalConfig.') && !file.includes('.test.'))
    .map((file) => path.join(legalDir, file)),
  path.join(clientDir, 'src/routes/legalRoutes.tsx'),
  path.join(clientDir, 'src/auth/AuthModal.tsx'),
  path.join(clientDir, 'src/screens/SettingsScreen.tsx'),
  path.join(clientDir, 'scripts/prerender.mjs'),
];

function allDocumentText(): string {
  return Object.values(LEGAL_DOCUMENTS)
    .flatMap((doc) => [
      doc.title,
      doc.effective ?? '',
      doc.standfirst,
      ...doc.sections.flatMap((section) => [section.heading, ...section.blocks.flat()]),
    ])
    .join('\n');
}

describe('legal owner placeholders', () => {
  it('lists the owner decisions still outstanding', () => {
    const outstanding = legalPlaceholdersOutstanding();
    // Printed on purpose: this is the owner's to-do list before launch.
    console.info(
      outstanding.length
        ? `Legal placeholders outstanding (set them in client/src/legal/legalConfig.mjs): ${outstanding.join(', ')}`
        : 'Legal placeholders: none outstanding.',
    );
    for (const key of outstanding) {
      expect(isOwnerPlaceholder(LEGAL_CONFIG[key])).toBe(true);
    }
    for (const key of Object.keys(LEGAL_CONFIG) as (keyof LegalConfig)[]) {
      if (!outstanding.includes(key)) expect(isOwnerPlaceholder(LEGAL_CONFIG[key])).toBe(false);
    }
  });

  it('gives every config key a visible to-be-confirmed label', () => {
    for (const key of Object.keys(LEGAL_CONFIG) as (keyof LegalConfig)[]) {
      expect(LEGAL_PLACEHOLDER_LABELS[key]).toMatch(/^\[.+ — to be confirmed\]$/);
    }
  });

  it('prints the label while a value is a placeholder, and the real value once set', () => {
    const filled: LegalConfig = { ...LEGAL_CONFIG, SUPPORT_EMAIL: 'help@racehorse.test' };
    expect(legalText('SUPPORT_EMAIL', { ...LEGAL_CONFIG, SUPPORT_EMAIL: 'OWNER_PLACEHOLDER_SUPPORT_EMAIL' })).toBe(
      '[support email — to be confirmed]',
    );
    expect(legalText('SUPPORT_EMAIL', filled)).toBe('help@racehorse.test');
    expect(supportEmailAddress(filled)).toBe('help@racehorse.test');
    expect(supportEmailAddress({ ...LEGAL_CONFIG, SUPPORT_EMAIL: 'OWNER_PLACEHOLDER_SUPPORT_EMAIL' })).toBeNull();
    expect(legalPlaceholdersOutstanding(filled)).not.toContain('SUPPORT_EMAIL');
  });

  it('describes PostHog location as derived until the owner records that IPs are discarded', () => {
    // The undecided state must describe what actually happens today.
    expect(posthogDerivesLocation({ ...LEGAL_CONFIG, POSTHOG_LOCATION: 'OWNER_PLACEHOLDER_POSTHOG_LOCATION' })).toBe(true);
    expect(posthogDerivesLocation({ ...LEGAL_CONFIG, POSTHOG_LOCATION: 'derived' })).toBe(true);
    expect(posthogDerivesLocation({ ...LEGAL_CONFIG, POSTHOG_LOCATION: 'discarded' })).toBe(false);
    if (posthogDerivesLocation()) {
      expect(allDocumentText()).toMatch(/approximate location/);
    }
  });

  it('never renders a raw placeholder token on a page', () => {
    expect(allDocumentText()).not.toMatch(/OWNER_PLACEHOLDER/);
  });

  it('shows outstanding placeholders as their labels in the rendered copy', () => {
    const text = allDocumentText();
    for (const key of legalPlaceholdersOutstanding()) {
      if (key === 'POSTHOG_LOCATION') continue; // a switch, not printed text
      expect(text).toContain(LEGAL_PLACEHOLDER_LABELS[key]);
    }
  });

  describe.each(LEGAL_SOURCES.map((file) => [path.relative(clientDir, file), file] as const))(
    '%s keeps owner facts in legalConfig.mjs',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');

      it('contains no literal email address', () => {
        // Reserved example domains (form placeholders like you@example.com) are fine.
        const emails = (source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).filter(
          (email) => !/@example\.(com|org|net)$/i.test(email),
        );
        expect(emails).toEqual([]);
      });

      it('contains no placeholder token or company-form name', () => {
        expect(source).not.toMatch(/OWNER_PLACEHOLDER_[A-Z]/);
        expect(source).not.toMatch(/\b(Ltd|Limited|LLC|L\.L\.C\.|Inc\.|GmbH|Pty|PLC)\b/);
      });

      it('states no minimum age as a number', () => {
        expect(source).not.toMatch(/\b\d{1,2}\s*(years old|or older|\+)/i);
      });
    },
  );
});
