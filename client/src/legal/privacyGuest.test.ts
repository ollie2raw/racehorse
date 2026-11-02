import { describe, expect, it } from 'vitest';
import { guestPlayDisclosed } from './legalConfig.mjs';
import { LEGAL_DOCUMENTS, PRIVACY_POLICY, privacyPolicy } from './legalContent.mjs';

const text = (doc: ReturnType<typeof privacyPolicy>) => JSON.stringify(doc.sections);
const section = (doc: ReturnType<typeof privacyPolicy>, id: string) => doc.sections.find((s) => s.id === id)!;

describe('guestPlayDisclosed', () => {
  it('is on only for the exact string "true", the same test the app uses for the flag', () => {
    expect(guestPlayDisclosed({ VITE_ENABLE_GUEST_PLAY: 'true' })).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', true]) {
      expect(guestPlayDisclosed({ VITE_ENABLE_GUEST_PLAY: value })).toBe(false);
    }
    expect(guestPlayDisclosed({})).toBe(false);
  });
});

describe('the Privacy Policy and guest play', () => {
  it('says nothing about guests while guest play is off', () => {
    expect(text(privacyPolicy(false))).not.toMatch(/guest/i);
  });

  it('describes guest accounts when it is on: what is created, where games go, how long they last, who is not ranked', () => {
    const on = privacyPolicy(true);
    const collect = JSON.stringify(section(on, 'what-we-collect').blocks);
    expect(collect).toMatch(/anonymous guest account/);
    expect(collect).toMatch(/no email address and no password/);
    expect(collect).toMatch(/become part of your account/);
    expect(collect).toMatch(/clear your browser data or delete the app, you lose access/);
    expect(collect).toMatch(/do not appear on leaderboards and cannot enter tournaments/);
    expect(JSON.stringify(section(on, 'retention').blocks)).toMatch(/no activity for 30 days are deleted automatically/);
  });

  it('puts the guest paragraph before the account one, and keeps everything that was already there', () => {
    const off = section(privacyPolicy(false), 'what-we-collect').blocks;
    const on = section(privacyPolicy(true), 'what-we-collect').blocks;
    expect(on.slice(2)).toEqual(off);
    expect(on[0]).toBe('If you play as a guest, without an account:');
    expect(on[2]).toBe('When you create an account:');
    const retentionOff = section(privacyPolicy(false), 'retention').blocks;
    expect(section(privacyPolicy(true), 'retention').blocks.slice(0, retentionOff.length)).toEqual(retentionOff);
  });

  it('leaves every other section, the title and the effective line untouched', () => {
    const off = privacyPolicy(false);
    const on = privacyPolicy(true);
    expect(on.title).toBe(off.title);
    expect(on.effective).toBe(off.effective);
    for (const s of off.sections.filter((s) => !['what-we-collect', 'retention'].includes(s.id))) {
      expect(section(on, s.id)).toEqual(s);
    }
  });

  it('does not change the base document when building the guest one', () => {
    const before = text(privacyPolicy(false));
    privacyPolicy(true);
    expect(text(privacyPolicy(false))).toBe(before);
  });

  it('serves the guest-free policy in a build with the flag off (the default here)', () => {
    expect(guestPlayDisclosed()).toBe(false);
    expect(LEGAL_DOCUMENTS.privacy).toBe(PRIVACY_POLICY);
    expect(text(PRIVACY_POLICY)).not.toMatch(/guest/i);
  });
});
