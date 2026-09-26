# Authoritative mobile asset selection

This is the selection gate for seven approved surfaces. Paths are repository-relative; bytes are encoded file bytes on 2026-09-25, dimensions and alpha from `sips`. `1× / 2×` are **required export targets in CSS display pixels**, not assets created in this planning pass. Crop previews are rendered frames in `reference-specs/asset-candidate-crops-{844,667}.png`; the intended Solo art positioning is shown separately in `reference-specs/solo-intended-art-frames-{844,667}.png`. Source files are untouched. `PASS` means the source subject/composition is approved, `REEXPORT` means keep that subject but derive better-sized shipping versions, and `REPLACE` means do not ship it for the target role.

## Frozen Home and Single Player selections

| Screen/role | Selected source | Why / crop contract | Status |
|---|---|---|---|
| Today’s Race Fritz | `client/src/assets/home/newHOMEdailyfritz.webp` | Exact seated Fritz/R-banner subject; CSS right art frame ~190×160, focal face at 50% x / 34% y. Existing 54,294 B is already below 180 KB. Keep source subject, derive 400×420 and 800×840 responsive exports if visual QA confirms 2× need. | PASS |
| Today’s Race puzzle | `client/src/assets/home/homefinalpuzzle.webp` | Exact blue/navy domino path and lit endpoint; right ~190×160 frame, focal 62% x / 50% y. Existing 42,228 B. Derive 420×210 and 840×420. | PASS |
| Solo Fritz | `client/src/assets/singlePlayerHub/fritzwave1.webp` | Exact white waving cutout; positioned right/bottom with `contain`, no cover crop. Source 64,666 B; 379×474 is adequate at ~130×210 CSS px for 2× width, close to 2× height. | PASS |
| Solo Ghost | `client/src/assets/singlePlayerHub/fritzghost2.webp` | Exact cyan hood/face/hands cutout; positioned right/bottom with `contain`, source 96,574 B at 561×716. | PASS |
| Solo Journey | `client/src/assets/singlePlayerHub/fritzjourney.webp` | Exact purple upper-body character on black; frame right/bottom, crop art left black rather than face. Source 69,230 B. | PASS |

**Reject competing Home heroes:** `daily-fritz-art.webp` (1,758,968 B) is a different close-up Fritz composition and `daily-puzzle-art.webp` (1,225,672 B) is a different domino arrangement. They are >20× heavier than the selected live assets and not needed for this design. Do not preload, import, or make mobile derivatives from them. The compressed selected Fritz/puzzle files are already the ones referenced in `RacehorseHomeArt.css:177,215`.

## Complete candidate manifest

`Baked text` means words/numbers baked into the bitmap, not a CSS overlay. None of the selected character/scene art below contains required UI copy; any logo/emblem is decorative. `Crop` describes the **smallest 667×375 target frame**. Preload only the first-view Home pair on `/`; route-owned visible art can load with its lazy route, and below-fold/detail art stays lazy. Do not preload all seven screens.

| Asset | px / bytes / format / alpha | Subject, role, crop survival, focal/frame | Baked text | 1× / 2×, budget, loading | Decision |
|---|---|---|---|---|---|
| `client/src/assets/home/newHOMEdailyfritz.webp` | 1223×1286 / 54,294 / WebP / no | seated Fritz; Home right ~190×160, 50% 34%; survives 667 frame with face | no | 400×420 / 800×840; ≤90 KB; route-critical preload | PASS |
| `client/src/assets/home/homefinalpuzzle.webp` | 1774×887 / 42,228 / WebP / no | lit domino route; Home right ~190×160, 62% 50%; endpoint survives | no | 420×210 / 840×420; ≤80 KB; route-critical preload | PASS |
| `client/src/assets/home/daily-fritz-art.webp` | 1223×1286 / 1,758,968 / WebP / no | alternate Fritz close-up; wrong Home focal/crop, high transfer | no | none; do not load | REPLACE |
| `client/src/assets/home/daily-puzzle-art.webp` | 1469×640 / 1,225,672 / WebP / yes | alternate domino chain; wrong arrangement and >budget | no | none; do not load | REPLACE |
| `client/src/assets/singlePlayerHub/fritzwave1.webp` | 379×474 / 64,666 / WebP / yes | white waving Fritz; Solo card right ~130×190; contain; face/hand survive | no | 190×237 / source 379×474; ≤80 KB; load with Solo route | PASS |
| `client/src/assets/singlePlayerHub/fritzghost2.webp` | 561×716 / 96,574 / WebP / yes | cyan Ghost cutout; Solo right ~130×190; contain; face/hands survive | no | 190×243 / 380×486; ≤110 KB; load with Solo route | PASS |
| `client/src/assets/singlePlayerHub/fritzjourney.webp` | 900×675 / 69,230 / WebP / no | purple Journey; Solo right ~130×190; face/shoulder survives with 70% x | no | 300×225 / 600×450; ≤90 KB; load with Solo route | PASS |
| `client/src/assets/singlePlayerHub/fritzwave.webp` | 379×474 / 64,270 / WebP / yes | near-duplicate white Fritz; not the approved waving pose | no | none for seven surfaces | REPLACE |
| `client/src/assets/singlePlayerHub/fritzScientistLab.webp` | 532×667 / 124,254 / WebP / yes | scientist Fritz; Learn Lab right ~100×105; contain; face survives | no | 160×200 / 320×400; ≤100 KB; lazy with Learn | REEXPORT |
| `client/src/assets/singlePlayerHub/leftfacingfritzNOBRAINER.webp` | 724×896 / 131,746 / WebP / yes | white Fritz for Learn/coaching; right ~100×105; face survives | no | 160×198 / 320×396; ≤100 KB; lazy | REEXPORT |
| `client/src/assets/learn/learnmodeimages.webp` | 2172×724 / 146,550 / WebP / no | multi-mode sprite/scene strip; current Learn art slices; at 667 small frames are fragile and need isolated exports | no | four isolated ~180×120 / 360×240; ≤70 KB each; lazy | REEXPORT |
| `client/src/assets/learn/scoring-open-count-chain.webp` | 1024×199 / 8,424 / WebP / yes | lesson diagram; focused article width; fits crop | no | 512×100 / source; ≤25 KB; lazy with article | PASS |
| `client/src/assets/ghost/ghostblue.webp` | 2528×1682 / 196,840 / WebP / no | Ghost setup scene; target setup art, not gameplay board; face center | no | 420×280 / 840×560; ≤150 KB; lazy | REEXPORT |
| `client/src/assets/dailyFritz/playvsfritzdone.webp` | 1536×1024 / 72,732 / WebP / no | Daily Fritz completion art; focused left panel ~300×320; face survives | no | 420×280 / 840×560; ≤100 KB; lazy on result state | PASS |
| `client/src/assets/dailyPuzzle/newnewladderfinal.webp` | 2528×1682 / 242,158 / WebP / yes | Daily Puzzle destination art; Home CTA route only, not Home card | no | 480×320 / 960×640; ≤150 KB; lazy | REEXPORT |
| `client/src/assets/bot/playfritz2png.webp` | 1536×1024 / 60,348 / WebP / yes | Fritz setup character; not a hub hero | no | 420×280 / 840×560; ≤100 KB; lazy | PASS |
| `client/public/brand_logo.webp` | 157×137 / 2,278 / WebP / yes | Racehorse mark; header ~32–40; survives | logo mark only | source / source; ≤5 KB; shell critical | PASS |
| `client/public/daystreak.webp` | 38×49 / 650 / WebP / yes | streak flame; 24–30 UI icon; 2× width marginal | no | 38×49 / vector or 76×98; ≤5 KB; Home critical | REEXPORT |
| `client/public/rookieICON.webp` | 234×199 / 2,266 / WebP / yes | tier badge; profile/utility, no seven-screen hero | no | 80×68 / 160×136; ≤10 KB; lazy | PASS |
| `client/public/GOATicon.webp` | 404×399 / 5,078 / WebP / yes | tier badge; profile/utility | no | 80×79 / 160×158; ≤12 KB; lazy | PASS |
| `client/public/dailyfritznew.webp` | 1080×1080 / 84,500 / WebP / no | alternate Daily Fritz art; does not replace selected Home scene | no | none on seven primary screens | REPLACE |
| `client/public/dailypuzzleHOMEBG.webp` | 1774×887 / 37,176 / WebP / no | public duplicate of selected puzzle scene; avoid separate import/path | no | none; consolidate to selected source | REPLACE |
| `client/public/NEWpuzzleBG.webp` | 1469×640 / 28,186 / WebP / yes | alternate puzzle route art; not Home composition | no | 420×183 / 840×366; ≤60 KB; lazy if used in puzzle | PASS |
| `client/public/dailyfritzimage.webp` | 1536×1024 / 105,166 / WebP / no | alternate Daily Fritz scene; completion reference uses selected module art | no | none for approved screen | REPLACE |
| `client/public/fritz2.webp` | 1008×1060 / 69,250 / WebP / no | old Fritz portrait; not selected Home/Solo subject | no | none for seven primary | REPLACE |
| `client/public/fritz-robot.webp` | 1223×1286 / 79,012 / WebP / no | duplicate Fritz scene, public path; avoid duplicate fetch | no | none; selected source above | REPLACE |
| `client/public/fritzGHOST.webp` | 1522×1024 / 111,766 / WebP / yes | alternate Ghost cutout; not selected Solo pose; setup candidate | no | 420×283 / 840×566; ≤120 KB; lazy | REEXPORT |
| `client/public/ghostmodeimage.webp` | 1552×1013 / 120,906 / WebP / yes | alternate Ghost scene; setup only, not core board | no | 420×274 / 840×548; ≤120 KB; lazy | REEXPORT |
| `client/public/fritzwave.webp` | 379×474 / 64,270 / WebP / yes | duplicate alternate waving Fritz; avoid duplicate URL | no | none | REPLACE |
| `client/public/fritzNOBRAINER.webp` | 724×896 / 132,296 / WebP / yes | public duplicate Learn Fritz; use imported source | no | none | REPLACE |
| `client/public/assets/match-v2/final/arena/arena-frame-gold-neon.webp` | 1586×992 / 38,496 / WebP / yes | match arena frame; current gameplay texture, assess on 667 board | no | 844×528 / source; ≤60 KB; lazy with match | PASS |

PNG siblings of these WebPs are source/archive candidates and are **not selected for phone transfer**. Notable sizes: `newHOMEdailyfritz.png` 1,665,612 B, `homefinalpuzzle.png` 1,778,796 B, `fritzjourney.png` 703,811 B, `learnmodeimages.png` 1,939,589 B, `ghostblue.png` 3,591,128 B, and `newnewladderfinal.png` 5,565,663 B. Keep original files unchanged; do not import PNG siblings in phone views.

## Gaps and follow-up decisions

- **Tournament:** no approved transparent 3D trophy matching `(6)`. Existing inline SVG trophy is a functional icon; PR 5 may commission an isolated trophy export. The hub remains implementable with the current trophy and correct layout. No CSS faux 3D.
- **Social:** reference avatars/status imagery can use user-provided profile images and existing icon system; no fabricated faces or baked leaderboard. Need real populated fixture for visual QA.
- **Learn:** the single wide sprite is a likely quality/crop blocker for four short cards; PR 4 should export four isolated images before page review. Its absence does not block PR 1–3.
- **Gameplay:** reference `(3)` is composition guidance, not an art export. Current domino/arena assets and CSS-rendered state stay domain owned. Do not put a static screenshot beneath interactive tiles.

Current selected Home transfer is 96,522 B total, below the proposed 350 KB two-art budget. Selected Solo art totals 230,470 B but is route-lazy; avoid decoding it on Home. Dimensions of the Home source are larger than needed, so PR 0 may generate approved derivatives if its asset-only scope is opened; no production UI is changed here. Keep frames/aspect reserved to prevent layout shift.
