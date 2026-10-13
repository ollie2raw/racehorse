/**
 * Store-relevant iOS project settings. Guards against Capacitor template values
 * creeping back (e.g. `armv7` in UIRequiredDeviceCapabilities — the binary is
 * arm64-only and the deployment target is iOS 15) and against accidental
 * changes to the App Store candidate configuration.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const plist = read('../ios/App/App/Info.plist');
const pbxproj = read('../ios/App/App.xcodeproj/project.pbxproj');

function plistArray(key: string): string[] {
  const m = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  return m ? [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]) : [];
}

describe('iOS project settings for the App Store candidate', () => {
  it('requires arm64, never the obsolete armv7 template value', () => {
    expect(plistArray('UIRequiredDeviceCapabilities')).toEqual(['arm64']);
  });

  it('is iPhone-only, iOS 15+, landscape-only', () => {
    const families = [...pbxproj.matchAll(/TARGETED_DEVICE_FAMILY = ([^;]+);/g)].map((m) => m[1].trim());
    expect(families.length).toBeGreaterThan(0);
    expect(new Set(families)).toEqual(new Set(['1']));
    const targets = [...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)].map((m) => m[1].trim());
    expect(new Set(targets)).toEqual(new Set(['15.0']));
    expect(plistArray('UISupportedInterfaceOrientations').sort()).toEqual([
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ]);
  });

  it('declares exempt encryption and bundles the privacy manifest', () => {
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
    expect(pbxproj).toContain('PrivacyInfo.xcprivacy in Resources');
  });
});
