# Brand assets: app icon, splash, favicons

`client/scripts/generateBrandAssets.mjs` turns owner-supplied master artwork
into every icon and launch image the app and website use. It uses only macOS
`sips` (resizing) and Node built-ins. It has **not** been run for real: the
icon and splash in the iOS project are still the Capacitor placeholders, and
the current `public/icon-512.png` is too small and transparent to be a master
(the script refuses it, and a test checks that).

## Master artwork the owner supplies

### 1. App icon master (`--icon`, required)

| Requirement | Why |
|---|---|
| PNG, **square**, at least **1024 × 1024** (exactly 1024 is ideal) | App Store icon size; everything else is scaled down from it |
| **Opaque: no alpha channel at all**, not even a fully opaque one | App Store Connect rejects icons with alpha (ITMS-90717). The script refuses any alpha channel or `tRNS` transparency |
| **Square corners, full bleed**: no rounded corners, no drop shadow, no border margin | iOS applies its own mask |
| 8 bits per channel, **sRGB** | Consistent colour; the script warns if untagged or tagged with another profile |
| Background: brand navy **#0A0E17** (`capacitor.config.ts` `backgroundColor`) or the approved icon background | Matches the launch screen and app background |
| Mark centred, important detail inside the central ~80% | The same file feeds the web `maskable` manifest icons, which can be cropped to a circle |
| Legible at 16 × 16 | Favicons are made from it |

Also keep the **vector master** (SVG/AI/Figma) in the owner's design files;
the PNG is an export of it.

### 2. Splash mark (`--mark`, optional but needed for the launch screen)

| Requirement | Why |
|---|---|
| PNG, square, at least 1024 × 1024, 8-bit RGBA | Scaled to 720 px and centred on a 2732 × 2732 navy canvas |
| The mark only, **transparent background**, little padding | The script composites it onto #0A0E17; output is opaque |

The launch storyboard shows the 2732 square aspect-filled. In landscape on a
19.5:9 iPhone only a centred band about 1260 px tall is visible, so the 720 px
mark always fits.

## What it writes

| Output | Size | From |
|---|---|---|
| `client/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (+ `Contents.json` rewritten to the single 1024 universal entry) | 1024 | icon |
| `client/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png`, `-1.png`, `-2.png` (+ `Contents.json`) | 2732 | mark on navy |
| `client/public/apple-touch-icon.png` | 180 | icon |
| `client/public/icon-192.png`, `icon-512.png` (paths `manifest.json` already uses) | 192, 512 | icon |
| `client/public/favicon-16.png`, `favicon-32.png`, `favicon.ico` (16/32/48, PNG-in-ICO) | — | icon |
| `--social <dir>`: `social-avatar-1024.png`, `social-avatar-400.png` | 1024, 400 | icon |

Every output is re-encoded as opaque 8-bit RGB with an sRGB tag.

## Usage

```sh
cd client
# 1. Validate and list outputs, write nothing:
node scripts/generateBrandAssets.mjs --icon ~/Racehorse/icon-1024.png --mark ~/Racehorse/mark.png --dry-run
# 2. Optional: stage into a scratch folder to review first:
node scripts/generateBrandAssets.mjs --icon … --mark … --client-dir /tmp/racehorse-brand --social /tmp/racehorse-brand/social
# 3. Write into the project:
node scripts/generateBrandAssets.mjs --icon … --mark …
```

Then:

1. Look at every file (Finder Quick Look; the icon at 16 px especially).
2. Update `client/index.html` to point at the new files (one-time, after the
   files exist):
   ```html
   <link rel="icon" href="/favicon.ico" sizes="48x48" />
   <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
   <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
   <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
   ```
   (today it uses `icon-192.png` for both icon and apple-touch-icon).
3. `npm run build:ios`, open Xcode, check the asset catalog shows no warnings,
   run on a device: launch screen is navy with the mark, no white flash.
4. Commit the generated files together with the `index.html` change.

Tests: `npx vitest run scripts/generateBrandAssets.test.ts` (PNG/ICO helpers,
validation, refusal of the current 512 px icon, dry run, and on macOS a full
generation into a temp folder).
