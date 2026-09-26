# Asset gap matrix

**Selection freeze:** `ASSET_SELECTION_MANIFEST.md` is authoritative for exact paths, bytes, dimensions, crop previews, 1×/2× export targets and PASS/REEXPORT/REPLACE decisions. If an older candidate assessment below differs, follow that manifest. Home selects `newHOMEdailyfritz.webp` and `homefinalpuzzle.webp`; Solo selects `fritzwave1.webp`, `fritzghost2.webp`, `fritzjourney.webp`.

Inventory is based on files in `client/public` and `client/src/assets`, plus source imports; reference PNGs live at repository root. Filenames with `.png` and `.webp` duplicates are not automatically separate art direction. Confirm original dimensions, alpha, compression, legal rights, and crop focal points before shipping.

| Surface | Existing usable asset families | Approximate matches | Gaps / new export needed |
|---|---|---|---|
| Today’s Race | `client/src/assets/home/{daily-fritz-art,daily-puzzle-art,newHOMEdailyfritz,homefinalpuzzle}.{webp,png}`, `client/public/{dailyfritzimage,dailypuzzleHOMEBG,NEWpuzzleBG,daystreak}.{webp,png}` | Fritz portrait and domino/puzzle feature art exist; streak graphic exists | Reference compositions include wider right-side puzzle/domino branch scene and visible Fritz-at-right crop. Need inspect focal point/resolution; new crop/art export only if current assets cannot preserve legible text-safe zone. |
| Single Player | `client/src/assets/singlePlayerHub/{fritzwave,fritzwave1,fritzghost2,fritzjourney,fritzScientistLab,leftfacingfritzNOBRAINER}.{webp,png}`, `client/public/{fritz2,fritzNOBRAINER,ghostmodeimage,fritzGHOST,fritz-robot}.{webp,png}` | Fritz and Ghost robots, Journey purple art are close | Mock uses three differently composed card scenes with clear text-safe left and full-height isolated figures. Verify candidates at mobile card crop. Need transparent isolated Fritz/Ghost if no image has a useful clean crop. |
| Tournament | generic lucide/icons and tournament UI; `client/public/GOATicon` | trophy icon and tournament event art can be built from existing icons/typography | No clear repository feature hero of a gold Racehorse trophy matching `(6)`; commission/export one responsive hero, preferably source plus desktop/phone crop. |
| Learn | `client/src/assets/learn/{learnmodeimages,scoring-open-count-chain}.{webp,png}`, `singlePlayerHub/fritzScientistLab`, `public/fritzNOBRAINER`, Fritz robots | lesson domino illustration, scientist Fritz, Fritz portrait | Need confirm the four requested compositions (How to Play robot, Guided Match robot/tiles, Lab scientist, lesson library art/book/dominoes). Likely new isolated Learn library scene and possibly three exports/crops. |
| Social | avatar initials/profile data and lucide icons; `brand_logo` | brand/avatar UI and icon primitives | No bespoke activity/feed hero needed. Avoid large robot artwork here; create/standardize avatar placeholders and social glyphs as code/vector. |
| Ghost gameplay | `client/src/assets/ghost/ghostblue.{webp,png}`, `singlePlayerHub/fritzghost2`, robot files, board watermark/assets | blue ghost robot and live board assets | Reference ghost appears as compact transparent avatar, not a large scene. Export a transparent small avatar if existing images have nontransparent backgrounds. No CSS robot substitutes. |
| Daily Fritz | `client/src/assets/dailyFritz/playvsfritzdone.{webp,png}`, home Fritz art, `public/dailyfritznew`, `fritzwave`, robot assets | Existing high-quality Fritz portraits and Daily Fritz art | Reference has seated full-body Fritz against warm competitive setting plus neutral scene crop. Current art may be reused if resolution and text-safe crop pass. Isolated Fritz transparent version may be needed. |

## Verified candidate dimensions and encoded sizes

The source files already include several compressed WebP candidates; dimensions/size below were measured during this audit (`sips`, `du -h`, rounded):

| Asset | Pixels | WebP size | Assessment |
|---|---:|---:|---|
| `assets/home/daily-fritz-art.webp` | 1223×1286 | 1.7 MB | far above target; inspect whether duplicated larger source or unused; export optimized phone/desktop derivatives |
| `assets/home/daily-puzzle-art.webp` | 1469×640 | 1.2 MB | wide art, still too heavy for initial phone download; derive/resample/compress responsive source |
| `assets/singlePlayerHub/fritzwave.webp` | 379×474 | 64 KB | close to reasonable card-art target, but likely low for large 2× display |
| `assets/singlePlayerHub/fritzghost2.webp` | 561×716 | 96 KB | good size, check art/text-free crop |
| `assets/singlePlayerHub/fritzScientistLab.webp` | 532×667 | 124 KB | plausible Learn/solo role |
| `assets/singlePlayerHub/fritzjourney.webp` | inspect during asset manifest | inspect | likely existing mode-card art |
| `assets/learn/learnmodeimages.webp` | 2172×724 | 144 KB | likely sprite/composite; use source CSS crop and avoid decoding if multiple hidden variants |
| `assets/ghost/ghostblue.webp` | 2528×1682 | 196 KB | oversized for avatar; create small transparent derivative if alpha/focal inspection passes |
| `assets/dailyFritz/playvsfritzdone.webp` | 1536×1024 | 72 KB | efficient composition; verify correct state/content and crop |
| `client/public/brand_logo.webp` | 157×137 | 4 KB | small logo candidate; enough for header at DPR 2 with dimensions checked |
| `client/public/dailyfritznew.webp` | 1080×1080 | 84 KB | square feature candidate |
| `client/public/dailypuzzleHOMEBG.webp` | 1774×887 | 40 KB | unusually efficient wide background, verify contrast/focal point |
| `client/public/fritz-robot.webp` | 1223×1286 | 80 KB | efficient high-resolution portrait art |

Image inspection is still required for alpha/transparency, text baked into art, focal point and actual usage. The 1.2–1.7 MB hero candidates alone exceed the full home-art transfer target proposed below; do not use them as-is on initial phone render.

## Icon system

Bottom tabs use custom inline SVG in `components/nav/AppBottomTabBar.tsx`, with a second navigation icon family likely in `GlobalNav`/lucide. Define one icon contract (24px visual box, consistent stroke/cap, semantic labels and one active treatment). Reuse Lucide React for product UI where the icon exists; preserve any Racehorse logo/brand glyph as official assets. Do not use emoji as final key status icons. The references’ icon variation is generation noise.

## Phone asset performance

- Serve WebP where verified and AVIF where browser support and pipeline permit; keep PNG only for alpha/quality cases where size justifies it. Do not blindly add duplicate AVIFs or transcode line art without visual QA.
- Responsive `srcset`/`sizes`: export 1× and 2× card source widths based on measured CSS frame (likely 600–900 CSS px max for hero cards); avoid sending 1448×1086 full reference/mockup images in production.
- Aim per-screen noncritical art ≤350 KB transfer compressed; critical hero art ≤180 KB per item. Lazy-load below-fold artwork, set explicit width/height or aspect ratio, decode async, avoid preloading all seven surfaces.
- Preload only the visible initial page hero, with `fetchpriority=high`; route-split and lazy-load other feature art as existing lazy routes permit.
- Keep texture/ambient backgrounds as CSS if cheap to paint; avoid full-screen high-resolution raster texture and giant transparent composites that increase memory.
- Use crop/focal metadata (`object-position`) per asset/page; low-resolution fuzzy crop is worse than a deliberately smaller artwork role.
- Measure decoded memory: approximate RGBA = width × height × 4 × simultaneously decoded images. Avoid eagerly mounting hidden route artwork in shared shell.

## Work before asset production

Create a verified manifest: source file, dimensions, encoded bytes, alpha, focal point, mode, attribution, proposed frame, 1×/2× derivative, and whether existing candidate passes. Only then commission gaps. The seven AI reference PNGs are visual review inputs, not shippable assets without explicit rights/provenance approval.
