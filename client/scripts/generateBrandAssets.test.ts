import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRAND_NAVY,
  SPLASH_SIZE,
  buildIco,
  compositeCentered,
  decodePng,
  encodeOpaquePng,
  parseArgs,
  planOutputs,
  readPngInfo,
  validateIconMaster,
  validateMarkMaster,
} from './generateBrandAssets.mjs';

const SCRIPT = path.join(__dirname, 'generateBrandAssets.mjs');

/** Minimal RGBA PNG writer for fixtures (filter 0, one IDAT). */
function rgbaPng(size: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const tempDirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'brand-test-'));
  tempDirs.push(d);
  return d;
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('PNG helpers', () => {
  it('round-trips an opaque RGB PNG with no alpha channel and an sRGB tag', () => {
    const rgb = Buffer.from([10, 14, 23, 255, 255, 255, 0, 0, 0, 200, 100, 50]);
    const png = encodeOpaquePng(2, 2, rgb);
    const info = readPngInfo(png);
    expect(info).toMatchObject({ width: 2, height: 2, bitDepth: 8, colorType: 2, hasAlpha: false, hasSrgbChunk: true });
    const decoded = decodePng(png);
    expect([...decoded.rgba.subarray(0, 8)]).toEqual([10, 14, 23, 255, 255, 255, 255, 255]);
  });

  it('detects alpha in an RGBA PNG and blends it onto navy', () => {
    const png = rgbaPng(2, (x) => (x === 0 ? [255, 255, 255, 0] : [255, 255, 255, 255]));
    expect(readPngInfo(png).hasAlpha).toBe(true);
    const rgb = compositeCentered(4, BRAND_NAVY, decodePng(png));
    // Canvas corner: navy. Transparent mark pixel at (1,1): navy. Opaque at (2,1): white.
    expect([...rgb.subarray(0, 3)]).toEqual([0x0a, 0x0e, 0x17]);
    expect([...rgb.subarray((1 * 4 + 1) * 3, (1 * 4 + 1) * 3 + 3)]).toEqual([0x0a, 0x0e, 0x17]);
    expect([...rgb.subarray((1 * 4 + 2) * 3, (1 * 4 + 2) * 3 + 3)]).toEqual([255, 255, 255]);
  });

  it('builds a favicon.ico directory pointing at embedded PNGs', () => {
    const a = encodeOpaquePng(1, 1, Buffer.from([1, 2, 3]));
    const ico = buildIco([
      { size: 16, png: a },
      { size: 32, png: a },
    ]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 32);
    expect(ico.subarray(6 + 32, 6 + 32 + a.length).equals(a)).toBe(true);
  });
});

describe('master validation', () => {
  const opaque1024 = { width: 1024, height: 1024, bitDepth: 8, colorType: 2, interlaced: false, hasAlpha: false, hasSrgbChunk: true, iccProfileName: null };

  it('accepts a square, opaque, sRGB 1024 master', () => {
    expect(validateIconMaster(opaque1024)).toEqual({ errors: [], warnings: [] });
  });

  it('refuses a small, non-square or transparent icon master', () => {
    expect(validateIconMaster({ ...opaque1024, width: 512, height: 512 }).errors.join(' ')).toMatch(/at least 1024/);
    expect(validateIconMaster({ ...opaque1024, height: 1000 }).errors.join(' ')).toMatch(/square/);
    expect(validateIconMaster({ ...opaque1024, colorType: 6, hasAlpha: true }).errors.join(' ')).toMatch(/alpha/);
  });

  it('warns on a non-sRGB profile', () => {
    const r = validateIconMaster({ ...opaque1024, hasSrgbChunk: false, iccProfileName: 'Display P3' });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/not sRGB/);
  });

  it('allows a transparent splash mark but still needs 1024 square', () => {
    expect(validateMarkMaster({ ...opaque1024, colorType: 6, hasAlpha: true }).errors).toEqual([]);
    expect(validateMarkMaster({ ...opaque1024, width: 800, height: 800 }).errors.join(' ')).toMatch(/at least 1024/);
  });
});

describe('output plan and CLI', () => {
  it('keeps the paths manifest.json, index.html and the Xcode catalog already use', () => {
    const plan = planOutputs({ clientDir: '/c', includeSplash: true, socialDir: null }).map((p) => p.path);
    expect(plan).toContain('/c/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
    expect(plan).toContain('/c/public/icon-192.png');
    expect(plan).toContain('/c/public/icon-512.png');
    expect(plan).toContain('/c/public/apple-touch-icon.png');
    expect(plan).toContain('/c/public/favicon.ico');
    expect(plan.filter((p) => p.includes('Splash.imageset'))).toHaveLength(3);
  });

  it('requires --icon', () => {
    expect(() => parseArgs([])).toThrow(/--icon/);
    expect(parseArgs(['--icon', 'a.png', '--dry-run'])).toMatchObject({ icon: 'a.png', dryRun: true });
  });

  it('refuses the current 512 px web icon as a master and writes nothing', () => {
    const out = tempDir();
    const r = spawnSync(process.execPath, [SCRIPT, '--icon', path.join(__dirname, '../public/icon-512.png'), '--client-dir', out], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/at least 1024/);
    expect(r.stderr).toMatch(/alpha/);
    expect(existsSync(path.join(out, 'public'))).toBe(false);
  });

  it('dry run lists the files without writing them', () => {
    const dir = tempDir();
    const icon = path.join(dir, 'icon.png');
    writeFileSync(icon, encodeOpaquePng(1024, 1024, Buffer.alloc(1024 * 1024 * 3, 0x20)));
    const out = path.join(dir, 'client');
    const r = spawnSync(process.execPath, [SCRIPT, '--icon', icon, '--client-dir', out, '--dry-run'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Would write 7 files/);
    expect(existsSync(out)).toBe(false);
  });

  it.runIf(process.platform === 'darwin')('generates opaque assets into a staging folder (macOS sips)', () => {
    const dir = tempDir();
    const icon = path.join(dir, 'icon.png');
    writeFileSync(icon, encodeOpaquePng(1024, 1024, Buffer.alloc(1024 * 1024 * 3, 0x40)));
    const mark = path.join(dir, 'mark.png');
    writeFileSync(mark, rgbaPng(1024, (x, y) => (Math.hypot(x - 512, y - 512) < 300 ? [80, 160, 255, 255] : [0, 0, 0, 0])));
    const out = path.join(dir, 'client');
    const r = spawnSync(process.execPath, [SCRIPT, '--icon', icon, '--mark', mark, '--client-dir', out], { encoding: 'utf8' });
    expect(r.stderr).not.toMatch(/error/);
    expect(r.status).toBe(0);

    const appIcon = readPngInfo(readFileSync(path.join(out, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')));
    expect(appIcon).toMatchObject({ width: 1024, height: 1024, hasAlpha: false });
    const splashPath = path.join(out, 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png');
    const splash = decodePng(readFileSync(splashPath));
    expect(readPngInfo(readFileSync(splashPath)).hasAlpha).toBe(false);
    expect(splash.width).toBe(SPLASH_SIZE);
    expect([...splash.rgba.subarray(0, 3)]).toEqual([0x0a, 0x0e, 0x17]); // navy corner
    const centre = ((SPLASH_SIZE / 2) * SPLASH_SIZE + SPLASH_SIZE / 2) * 4;
    expect(splash.rgba[centre + 2]).toBeGreaterThan(200); // the blue mark
    expect(readPngInfo(readFileSync(path.join(out, 'public/apple-touch-icon.png')))).toMatchObject({ width: 180, hasAlpha: false });
    const contents = JSON.parse(readFileSync(path.join(out, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json'), 'utf8'));
    expect(contents.images[0]).toMatchObject({ filename: 'AppIcon-512@2x.png', size: '1024x1024' });
  }, 60_000);
});
