# Reference conformance contract — 844×390 CSS px

The seven source PNGs in [`references/`](references/README.md) are **composition references**, not Playwright baselines: their decorative phone bezels, side buttons, fictional data and inconsistent chrome are outside the product viewport. The usable screen inside each render is taller in proportion than 844×390; the bands below are deliberate height budgets for the actual CSS viewport. See `reference-specs/asset-candidate-crops-844.png` and `asset-candidate-crops-667.png` for rendered asset candidate frames. All coordinates are viewport-relative *bands*, with ±4–8 px review tolerance for chrome and ±8–12 px for artwork. They are not positioning instructions.

## Shared measurement contract

| Role | Canonical target / review tolerance |
|---|---|
| Usable x bounds | CSS viewport minus actual `env(safe-area-inset-left/right)` and 12–18 px inner gutter; ordinary browser with zero safe inset: x≈14–830. No image or hitbox enters an unsafe edge. |
| Hub header | y≈0–50/56 including top safe inset; brand left, identity right. At 844 signed in: rating, Friends, avatar. Account always reachable; Friends then rating collapse as space falls. |
| Hub bottom tabs | one five-area bar, y≈332–390 (52–58 px plus actual bottom safe inset). Multiplayer, Single Player, Tournament, Social, Learn; selected primary-area tab uses icon/label plus one accent cue. Home shows no selected tab. No top primary links. |
| Focused header | y≈0–48/56; contextual back + title/brand/account as appropriate; no bottom tabs. |
| Main title | hub title 28–34 px, subtitle 13–15 px if height permits; focused title 26–32 px. One strong alignment axis per page. |
| Panel system | dark matte navy, 1 px restrained accent border, radius 14–20 px; controlled local glow, no full-page gradient. CTA ≥44 px target, ideally 44–48 px visible box. |
| Spacing | outer 12–18 px; major column gap 10–16 px; intra-panel gap 6–12 px. Bounded content height: 276–284 px for hubs after chrome; 334–342 px for focused pages. |
| Scroll | app/document never scrolls accidentally. Named content pane may scroll for overflow; header and hub tabs remain stationary. Screenshot state is captured at scroll origin unless stated. |

At 740×360, remove subtitle/secondary metadata first and reduce art exposure; preserve title, card identities, CTA target and shell. At 667×375, use a named horizontal card rail or internal content scroll only where a complete side-by-side set cannot maintain readable text and ≥44 px controls. Do not scale the whole page or reduce primary text below 14 px. Portrait uses its own reflow, not a rotated landscape canvas.

## 1. Today’s Race — `(1)` → `/` — Hub

**Bounds and composition.** Header 50–56, with brand left, open center space, and identity/account right; centered title/subtitle band 43–51; two feature panels from about y=105 to y=270–282, equal columns (49/49) with 10–14 gap; streak strip 42–50 high immediately below with 7–10 gap; tab bar at bottom. At 844 the two panel widths are ~397–404 px. Content axes: title centered on viewport, left panel text/CTA shares x inset ~16, art occupies right 42–55% of each panel. Fritz face sits near the upper-right third and remains complete; puzzle chain sits center/right with highlighted endpoint visible. Panel CTAs sit on a common baseline, ≥44 high and ~170–210 wide. Streak text/day sequence/weekly goal must be legible in one shallow strip; day circles can contract but not turn into untappable micro-controls if interactive. Dominant type: title 30–34, card heads 22–27, body 13–15, CTA 15–16, streak 14–17. Gold left, blue right, green streak.

**Height/scroll.** Target 50 header + 48 title + 170 panel + 46 streak + 58 tabs + ~18 gaps = 390. No page scroll at canonical. At 740×360, subtitle and secondary card status may collapse; streak goal detail may move behind an explicit detail action. At 667×375 preserve both daily choices and both actions; use a bounded content scroll if panel width makes art/text collide. CTA, title, completion state and safe inset never compress below legibility.

**Acceptance tiers.** T1: dual-card balance, Fritz/puzzle crop, title, CTA baseline, streak relationship, gold/blue contrast, compact density. T2: date, streak/rank numbers, exact status wording, minor geometric linework. T3: mock’s **selected** Multiplayer state while on Home, any duplicated nav, fake rank, phone hardware/camera bar, generated data. Multiplayer remains the first tab but is unselected on Home.

## 2. Single Player — `(7)` → `/solo` — Hub and visual-fidelity gate

**Bounds and composition.** Header 50–56; centered title/subtitle 50–58; three cards in one row from y≈108 to y≈329, with x gutters 14–18, card gaps 10–14, equal fractional widths ~260–267 px, height ~211–221. Each card is a single panel with text left/top, art right and cropped by rounded frame; usable art region ~38–54% card width, Fritz full face + raised hand, Ghost hood/face and hands, Journey purple face/upper torso. Heads ~21–25 px; body 13–14 px over at most 3–4 short lines; compact two-value stats 10–12 labels and 17–21 values at lower left; CTA spans almost card width and aligns across cards at y≈279–323, ≥44 high. Gold, blue, purple borders/buttons follow each card. Title center and CTA bottoms are the dominant alignment axes. No back button inside hub content on phone; bottom nav provides area switch, and browser back handles prior history.

**Height/scroll.** 52 header + 52 title + 220 card + 58 tabs + 8 gaps = 390. No canonical vertical scroll. At 740×360, trim body copy and card art exposure, retain 3 cards only if each text zone stays ≥142 px wide and CTA ≥44; otherwise switch to a 3-card horizontal rail with obvious next-card affordance and full-card snap. At 667×375 rail is expected, with first card complete and adjacent card visible. Never hide mode title, availability/locked state, CTA, stats meaning, or active tab. Use `contain`/positioned art, **not `background-size:cover` on transparent Fritz/Ghost cutouts**, which crops faces at these ratios.

**Acceptance tiers.** T1: three-card geometry, visual weight of each Fritz variant, title/subtitle, stats, bottom CTA row, distinct restrained accents, matte border/glow. T2: exact stat values/descriptions, minor icon glyphs. T3: invented progression, false unlocked state, fake account values, hardware, inconsistent tab icons. PR 3 cannot pass on structural checks alone; target crop/composition requires human image review at 844 and 667.

## 3. Tournament / Compete — `(6)` → `/tournament` — Hub

**Bounds and composition.** Header 50–56, title 42–50. Main region ~219–230 high, two columns ~43/57 with 12–16 gap. Left amber tournament feature owns trophy/emblem and large label; right owns countdown/current event plus compact schedule/registration rows. Countdown is numerically prominent (20–28), schedule metadata 11–13, CTA ≥44 anchored low/right and visible. Trophy frame takes roughly 45–60% of left panel area and must not obscure copy; if no matching asset is approved, use the existing SVG trophy at honest scale instead of faux 3D CSS. Nav 52–58 bottom. Content axis: event card left edge aligns with header content edge; right rows share their own inner x axis.

**Height/scroll.** At canonical show current event and at least the next schedule item without scroll; overflow rows scroll inside schedule pane. At 740/667, preserve countdown/status/registration CTA; reduce trophy and secondary rules first, then use internal schedule scroll. No clipped register button.

**Acceptance tiers.** T1: warm competition hierarchy, feature vs schedule proportions, countdown/CTA prominence. T2: event names, timer values, exact trophy glyph. T3: fictional live bracket, fake registrations, duplicate top/bottom nav, phone hardware.

## 4. Learn — `(5)` → `/learn` — Hub

**Bounds and composition.** Header 50–56, title band 36–46, bottom tabs 52–58. Four modes form a 2×2 grid in the remaining ~224–240 px: each row ~106–114 high, x columns near 50/50 with 10–14 gutter and 8–10 row gap. This is shorter than the generated phone interior; prioritize clear mode name, one short line of purpose, lock/status and one ≥44 action. Art occupies right 28–40% of each card with stronger scrim under text; green/cyan education accent with per-mode secondary distinction. Card heading 18–22, body 12–14, CTA 14–15. Only the active/unlocked destination gets an enabled CTA.

**Height/scroll.** At 740×360, body descriptions may reduce to one line, never hide lock/CTA. At 667×375, allow bounded grid scroll if two rows would violate CTA targets. Hub tabs remain visible; lesson/article uses focused shell instead. Artwork can crop tighter but mode identity remains recognizable.

**Acceptance tiers.** T1: four-mode grid, visual category hierarchy, green/cyan identity, art/text separation, locked-state clarity. T2: lesson copy, badges, minor linework. T3: invented lesson availability/progress, generated copy errors, independent navigation shell, hardware.

## 5. Social — `(4)` → `/social` — Hub

**Bounds and composition.** Header 50–56, title/filter region 54–68, content until bottom tabs ~208–225. Main feed uses ~65–70% width; right online/highlights pane ~30–35%, 10–14 gutter. Feed rows have 40–52 px rhythm with avatar 28–36 and readable action/time; sidebar player rows 36–44. Filter is one compact segmented control, not a second primary nav. Profile/avatar action in header. Feed scrolls in its own pane; sidebar independently scrolls only when needed. Title 26–31; feed body 13–15; metadata 11–12.

**Height/scroll.** At 740, sidebar narrows and shows fewer rows; at 667, sidebar becomes a compact online summary/detail affordance while feed remains readable. Filter and first activity row must be visible. No horizontal document overflow.

**Acceptance tiers.** T1: feed/sidebar split, activity density, filter hierarchy, social cool-blue restraint. T2: usernames, online counts, relative time, avatars. T3: fabricated activity, fake friends, duplicate nav, nonfunctional challenge controls, hardware.

## 6. Ghost Mode / core gameplay — `(3)` → transient Ghost match — Gameplay

**Bounds and composition.** Safe content fills actual 844×390. Top player/score/turn HUD ~46–58 high; central board viewport ~198–224 high, spanning 73–83% available width after a 44–52 px side control rail; user hand/tray ~76–88 high near bottom; 8–16 total distributed gutters. Board is the visual center, with ivory tiles ≥36 px short edge for touch candidate and open ends visibly distinct; action hit targets ≥44 px even if tile image itself is smaller. Opponent/you scores and active-turn indication remain visible. Boneyard/draw/pass/zoom/audio/home have one defined location, never floating over legal endpoints. Player hand remains fully visible or horizontally scrollable with a visible count/edge cue. Score track remains a Racehorse identity element where current game design requires it.

**Height/scroll.** No document scroll. At 740×360, collapse secondary HUD words and art before board/hand. The frozen minimum usable envelope is board viewport ≥430×160 px, hand tray ≥72 px high, hand tile short edge ≥36 px, and legal action hitboxes ≥44×44 px. At any **portrait** gameplay size where fitted measured geometry misses one of these, show a dismissible rotate recommendation; never hide the game or disable interaction. At 667×375 landscape, the same minima remain acceptance criteria but a rotate prompt is not the remedy—use fit/rail adjustments. Rotation preserves state and camera re-fits from actual board container. Dialog content scrolls inside safe modal bounds.

**Acceptance tiers.** T1: board allocation, ivory tile readability, opponent/user status, legal move affordance, hand dominance, restrained glow. T2: score/timer/player names, exact icon glyphs. T3: fake move state, impossible board, ornamental controls, decorative phone/cutout, visual gameplay state not backed by fixture.

## 7. Daily Fritz — `(2)` → `/daily-fritz` — Focused Content

**Bounds and composition.** Contextual header 48–56; two-column main frame 334–342 high with x gutter 14–18 and column split ~43/57, gap 12–16. Left Fritz art/context panel is tall and crop-led; face is upper/middle focal point, gold line/border restrained. Right column owns series status, three game/result rows, primary Start/Resume/View Results CTA and secondary leaderboard path. Title 27–33; status/score 18–24; row labels 12–14. CTA is ≥44 high, on a stable right-column baseline. No bottom primary tabs. Account remains available in focused header if it fits safely.

**Height/scroll.** Canonical main panel fits without body scroll; result history/leaderboard rows own internal scroll. At 740/667, reduce left art width to ~34–38% and shorten secondary copy while keeping all set-game state and primary CTA reachable. In-progress match switches to Gameplay shell; completed result/review uses focused/utility presentation. Do not compress CTA or hide game progression.

**Acceptance tiers.** T1: Fritz visual anchor, left/right proportion, gold set hierarchy, three-stage progression, CTA prominence. T2: date, score, leaderboard position, exact labels. T3: fabricated completed score, unverified result data, phone hardware, duplicate global tabs, impossible active-game state.

## Review method

Playwright screenshots use actual 844×390 viewport, DPR 1, fixed fixtures and no decorative hardware. Review first against the bounds/axes and T1 bullets, then compare art focal point and type hierarchy, then allow T2 differences. T3 items are explicit exclusions. The six-size geometry suite verifies control intersections, scroll ownership, safe inset and horizontal overflow; pixel diff alone cannot approve a page.
