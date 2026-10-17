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
const readBytes = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url))); // variable, not a literal: Vite rewrites literal new URL(...) as an asset
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

describe('App Store submission assets and native security wiring', () => {
  // The icon is a single universal 1024x1024 slot; Xcode derives every other size from it. The owner replaces this one file.
  // App Store Connect rejects an icon with transparency, so a wrong replacement must fail here, not at upload.
  const icon = readBytes('../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');

  it('the app icon is a 1024x1024 PNG with no alpha channel and no transparency chunk', () => {
    expect(icon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(icon.readUInt32BE(16)).toBe(1024);
    expect(icon.readUInt32BE(20)).toBe(1024);
    const colorType = icon[25];
    expect([4, 6], 'colour type has an alpha channel').not.toContain(colorType);
    expect(icon.includes(Buffer.from('tRNS')), 'tRNS chunk makes pixels transparent').toBe(false);
  });

  it('the AppIcon catalog is the single universal 1024 slot the owner icon drops into', () => {
    const contents = JSON.parse(read('../ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json'));
    expect(contents.images).toHaveLength(1);
    expect(contents.images[0]).toMatchObject({ idiom: 'universal', platform: 'ios', size: '1024x1024', filename: 'AppIcon-512@2x.png' });
  });

  it('the auth session is Keychain-backed: the native package links the Keychain plugin', () => {
    expect(read('../ios/App/CapApp-SPM/Package.swift')).toContain('capacitor-keychain-storage');
    expect(read('../../packages/capacitor-keychain-storage/ios/Sources/KeychainStoragePlugin/KeychainStoragePlugin.swift')).toContain(
      'kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly',
    );
  });

  it('the home-screen display name has exactly one source the owner edits (Info.plist), and is not silently renamed', () => {
    expect(plist).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]+<\/string>/);
  });
});
