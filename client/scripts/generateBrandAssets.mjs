#!/usr/bin/env node
/**
 * Generates the iOS app icon, iOS launch (splash) images and the web favicon
 * set from owner-supplied master artwork. Docs:
 * docs/ops/app-store-candidate/brand-assets.md
 *
 *   node scripts/generateBrandAssets.mjs --icon <icon-master.png> [--mark <mark.png>] [--dry-run]
 *
 * --icon   Full-bleed square app icon master. Required. PNG, >= 1024x1024,
 *          square, 8-bit, NO alpha channel (App Store Connect rejects icons
 *          with one, ITMS-90717), no rounded corners (iOS applies the mask).
 * --mark   The Racehorse mark on a transparent background (PNG, 8-bit RGBA or
 *          RGB, square, >= 1024x1024). Used for the splash, centred on navy.
 *          Optional: without it the splash step is skipped.
 * --social <dir>  Also write a 1024 and a 400 px square avatar into <dir>
 *          (outside the repo is fine; they are not shipped in the app).
 * --client-dir <dir>  Write into <dir> laid out like client/ (ios/App/App/...,
 *          public/) instead of this client/ folder: a staging copy to review.
 * --dry-run  Validate the inputs and print every file that would be written.
 *
 * Only macOS `sips` (resizing) and Node built-ins are used: no new
 * dependencies. Resizing always starts from the master, never from a smaller
 * output. Output paths are fixed so manifest.json, index.html and the Xcode
 * asset catalog keep working without edits (see the docs for the one
 * index.html follow-up).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/** Brand background (capacitor.config.ts backgroundColor, --rh-bg). */
export const BRAND_NAVY = { r: 0x0a, g: 0x0e, b: 0x17 };
export const MIN_MASTER_SIZE = 1024;
export const IOS_ICON_SIZE = 1024;
export const SPLASH_SIZE = 2732;
/**
 * The launch screen shows the 2732 square scaled to fill the screen width in
 * landscape, so only a centred band about 46% as tall as the canvas is visible
 * on a 19.5:9 iPhone. The mark is kept well inside it.
 */
export const SPLASH_MARK_SIZE = 720;
export const SPLASH_FILENAMES = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'];
export const IOS_ICON_FILENAME = 'AppIcon-512@2x.png';
export const FAVICON_ICO_SIZES = [16, 32, 48];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// PNG reading / writing (8-bit, non-interlaced: what every design tool exports)
// ---------------------------------------------------------------------------

function readChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG file.');
  }
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

/** Header facts from a PNG buffer, without decoding pixels. */
export function readPngInfo(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG has no IHDR chunk.');
  const colorType = ihdr.data[9];
  const iccp = chunks.find((c) => c.type === 'iCCP');
  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType,
    interlaced: ihdr.data[12] === 1,
    // Colour types 4 (grey+alpha) and 6 (RGBA) carry an alpha channel; a tRNS
    // chunk adds transparency to the others.
    hasAlpha: colorType === 4 || colorType === 6 || chunks.some((c) => c.type === 'tRNS'),
    hasSrgbChunk: chunks.some((c) => c.type === 'sRGB'),
    iccProfileName: iccp ? iccp.data.toString('latin1', 0, Math.max(0, iccp.data.indexOf(0))) : null,
  };
}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decodes an 8-bit non-interlaced grey/RGB/RGBA PNG to RGBA pixels. */
export function decodePng(buf) {
  const info = readPngInfo(buf);
  const channels = CHANNELS[info.colorType];
  if (info.bitDepth !== 8 || !channels || info.interlaced) {
    throw new Error(
      `Unsupported PNG (bit depth ${info.bitDepth}, colour type ${info.colorType}${info.interlaced ? ', interlaced' : ''}). Export an 8-bit RGB or RGBA PNG without interlacing.`,
    );
  }
  const idat = Buffer.concat(readChunks(buf).filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const { width, height } = info;
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`Bad PNG filter type ${filter}.`);
      line[x] = (line[x] + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      if (channels === 1 || channels === 2) {
        out[d] = out[d + 1] = out[d + 2] = line[s];
        out[d + 3] = channels === 2 ? line[s + 1] : 255;
      } else {
        out[d] = line[s];
        out[d + 1] = line[s + 1];
        out[d + 2] = line[s + 2];
        out[d + 3] = channels === 4 ? line[s + 3] : 255;
      }
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encodes an opaque 8-bit RGB PNG (no alpha channel) tagged sRGB. */
export function encodeOpaquePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB, no alpha
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])), // perceptual
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Centres an RGBA image on a solid square canvas and alpha-blends it, giving
 * opaque RGB pixels (no transparent corners anywhere in the output).
 */
export function compositeCentered(canvasSize, background, image) {
  if (image.width > canvasSize || image.height > canvasSize) throw new Error('Image is larger than the canvas.');
  const rgb = Buffer.alloc(canvasSize * canvasSize * 3);
  for (let i = 0; i < canvasSize * canvasSize; i++) {
    rgb[i * 3] = background.r;
    rgb[i * 3 + 1] = background.g;
    rgb[i * 3 + 2] = background.b;
  }
  const left = Math.floor((canvasSize - image.width) / 2);
  const top = Math.floor((canvasSize - image.height) / 2);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const s = (y * image.width + x) * 4;
      const d = ((top + y) * canvasSize + left + x) * 3;
      const a = image.rgba[s + 3] / 255;
      rgb[d] = Math.round(image.rgba[s] * a + rgb[d] * (1 - a));
      rgb[d + 1] = Math.round(image.rgba[s + 1] * a + rgb[d + 1] * (1 - a));
      rgb[d + 2] = Math.round(image.rgba[s + 2] * a + rgb[d + 2] * (1 - a));
    }
  }
  return rgb;
}

/** favicon.ico holding PNG-encoded images (supported by every current browser). */
export function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function colourNote(info) {
  if (info.hasSrgbChunk) return null;
  if (info.iccProfileName && /srgb/i.test(info.iccProfileName)) return null;
  if (info.iccProfileName) {
    return `embedded colour profile "${info.iccProfileName}" is not sRGB; export as sRGB so the icon looks the same everywhere.`;
  }
  return 'no colour profile tag; it will be treated as sRGB. Export as sRGB to be sure.';
}

/** Problems that stop the run, plus warnings, for the iOS app icon master. */
export function validateIconMaster(info) {
  const errors = [];
  if (info.width !== info.height) errors.push(`must be square (got ${info.width}x${info.height}).`);
  if (Math.min(info.width, info.height) < MIN_MASTER_SIZE) {
    errors.push(`must be at least ${MIN_MASTER_SIZE}x${MIN_MASTER_SIZE} (got ${info.width}x${info.height}).`);
  }
  if (info.hasAlpha) {
    errors.push('must not have an alpha channel or transparency: App Store Connect rejects it (ITMS-90717). Flatten it onto the navy background and export without alpha.');
  }
  if (info.bitDepth !== 8) errors.push(`must be 8 bits per channel (got ${info.bitDepth}).`);
  const note = colourNote(info);
  return { errors, warnings: note ? [note] : [] };
}

/** Problems for the transparent splash mark. */
export function validateMarkMaster(info) {
  const errors = [];
  if (info.width !== info.height) errors.push(`must be square (got ${info.width}x${info.height}).`);
  if (Math.min(info.width, info.height) < MIN_MASTER_SIZE) {
    errors.push(`must be at least ${MIN_MASTER_SIZE}x${MIN_MASTER_SIZE} (got ${info.width}x${info.height}).`);
  }
  if (info.bitDepth !== 8 || !CHANNELS[info.colorType] || info.interlaced) {
    errors.push('must be an 8-bit RGB or RGBA PNG without interlacing.');
  }
  const note = colourNote(info);
  return { errors, warnings: note ? [note] : [] };
}

// ---------------------------------------------------------------------------
// Output plan
// ---------------------------------------------------------------------------

/**
 * Every file the generator writes. `from: 'icon'` outputs are resized from the
 * opaque icon master; `from: 'mark'` outputs are the mark composited on navy.
 */
export function planOutputs({ clientDir, includeSplash, socialDir }) {
  const iosAssets = path.join(clientDir, 'ios/App/App/Assets.xcassets');
  const pub = path.join(clientDir, 'public');
  const plan = [
    { from: 'icon', size: IOS_ICON_SIZE, path: path.join(iosAssets, 'AppIcon.appiconset', IOS_ICON_FILENAME), use: 'iOS App Store icon (all sizes derive from it)' },
    { from: 'icon', size: 180, path: path.join(pub, 'apple-touch-icon.png'), use: 'iOS home-screen bookmark (web)' },
    { from: 'icon', size: 192, path: path.join(pub, 'icon-192.png'), use: 'manifest.json icon' },
    { from: 'icon', size: 512, path: path.join(pub, 'icon-512.png'), use: 'manifest.json icon' },
    { from: 'icon', size: 32, path: path.join(pub, 'favicon-32.png'), use: 'browser tab' },
    { from: 'icon', size: 16, path: path.join(pub, 'favicon-16.png'), use: 'browser tab' },
    { from: 'icon', sizes: FAVICON_ICO_SIZES, path: path.join(pub, 'favicon.ico'), use: 'legacy /favicon.ico requests' },
  ];
  if (includeSplash) {
    for (const name of SPLASH_FILENAMES) {
      plan.push({ from: 'mark', size: SPLASH_SIZE, path: path.join(iosAssets, 'Splash.imageset', name), use: 'iOS launch screen' });
    }
  }
  if (socialDir) {
    plan.push({ from: 'icon', size: 1024, path: path.join(socialDir, 'social-avatar-1024.png'), use: 'social profile avatar' });
    plan.push({ from: 'icon', size: 400, path: path.join(socialDir, 'social-avatar-400.png'), use: 'social profile avatar' });
  }
  return plan;
}

export const APP_ICON_CONTENTS = {
  images: [{ filename: IOS_ICON_FILENAME, idiom: 'universal', platform: 'ios', size: '1024x1024' }],
  info: { author: 'xcode', version: 1 },
};

export const SPLASH_CONTENTS = {
  images: [
    { idiom: 'universal', filename: SPLASH_FILENAMES[2], scale: '1x' },
    { idiom: 'universal', filename: SPLASH_FILENAMES[1], scale: '2x' },
    { idiom: 'universal', filename: SPLASH_FILENAMES[0], scale: '3x' },
  ],
  info: { version: 1, author: 'xcode' },
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { icon: null, mark: null, social: null, clientDir: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--icon' || a === '--mark' || a === '--social' || a === '--client-dir') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${a} needs a path.`);
      args[a === '--client-dir' ? 'clientDir' : a.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.icon) throw new Error('--icon <icon-master.png> is required.');
  return args;
}

/** Resizes with macOS sips into a temp file and returns the PNG bytes. */
function sipsResize(src, size, workDir) {
  const out = path.join(workDir, `r-${size}-${path.basename(src)}`);
  execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), src, '--out', out], { stdio: 'ignore' });
  return readFileSync(out);
}

/** Re-encodes a resized icon as opaque RGB (sips can add an alpha channel). */
function opaqueResized(src, size, workDir) {
  const decoded = decodePng(sipsResize(src, size, workDir));
  return encodeOpaquePng(size, size, compositeCentered(size, BRAND_NAVY, decoded));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientDir = args.clientDir
    ? path.resolve(args.clientDir)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const iconPath = path.resolve(args.icon);
  const markPath = args.mark ? path.resolve(args.mark) : null;

  let failed = false;
  const report = (label, file, { errors, warnings }) => {
    for (const w of warnings) console.warn(`warning: ${label} (${file}): ${w}`);
    for (const e of errors) console.error(`error: ${label} (${file}) ${e}`);
    if (errors.length) failed = true;
  };
  report('icon master', iconPath, validateIconMaster(readPngInfo(readFileSync(iconPath))));
  if (markPath) report('splash mark', markPath, validateMarkMaster(readPngInfo(readFileSync(markPath))));
  if (failed) {
    console.error('Refusing to generate assets. See docs/ops/app-store-candidate/brand-assets.md for the master requirements.');
    process.exit(1);
  }

  const plan = planOutputs({ clientDir, includeSplash: Boolean(markPath), socialDir: args.social ? path.resolve(args.social) : null });
  console.log(`${args.dryRun ? 'Would write' : 'Writing'} ${plan.length} files:`);
  for (const item of plan) {
    const dims = item.sizes ? item.sizes.map((s) => `${s}`).join('+') : `${item.size}x${item.size}`;
    console.log(`  ${path.relative(process.cwd(), item.path)}  ${dims}  (${item.use})`);
  }
  if (!markPath) console.log('No --mark given: the iOS splash images are left unchanged.');
  if (args.dryRun) return;

  if (process.platform !== 'darwin') {
    console.error('Resizing uses macOS sips; run this on a Mac.');
    process.exit(1);
  }

  const workDir = mkdtempSync(path.join(tmpdir(), 'racehorse-brand-'));
  try {
    for (const item of plan) {
      mkdirSync(path.dirname(item.path), { recursive: true });
      let bytes;
      if (item.from === 'mark') {
        const mark = decodePng(sipsResize(markPath, SPLASH_MARK_SIZE, workDir));
        bytes = encodeOpaquePng(SPLASH_SIZE, SPLASH_SIZE, compositeCentered(SPLASH_SIZE, BRAND_NAVY, mark));
      } else if (item.sizes) {
        bytes = buildIco(item.sizes.map((size) => ({ size, png: opaqueResized(iconPath, size, workDir) })));
      } else {
        bytes = opaqueResized(iconPath, item.size, workDir);
        if (readPngInfo(bytes).hasAlpha) throw new Error(`${item.path} came out with alpha.`);
      }
      writeFileSync(item.path, bytes);
    }
    const iconDir = path.join(clientDir, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
    mkdirSync(iconDir, { recursive: true });
    writeFileSync(path.join(iconDir, 'Contents.json'), `${JSON.stringify(APP_ICON_CONTENTS, null, 2)}\n`);
    if (markPath) {
      const splashDir = path.join(clientDir, 'ios/App/App/Assets.xcassets/Splash.imageset');
      if (existsSync(splashDir)) writeFileSync(path.join(splashDir, 'Contents.json'), `${JSON.stringify(SPLASH_CONTENTS, null, 2)}\n`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  console.log('Done. Review every file visually before committing (docs/ops/app-store-candidate/brand-assets.md).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
