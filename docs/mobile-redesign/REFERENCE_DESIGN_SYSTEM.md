# Reference design system decomposition

Six of the seven mapped source images in `references/` are direct 1448×1086 PNGs, each showing a 16:9-ish landscape handset inside an illustrative device render. The decorative exterior bezel is not an app viewport. Measurements below are approximate CSS proportions normalized to the visible screen, not pixel coordinates to copy. The approved Learn image is [`references/ChatGPT Image Sep 25, 2026 at 09_06_36 AM (5).png`](<references/ChatGPT%20Image%20Sep%2025,%202026%20at%2009_06_36%20AM%20(5).png>); the separate Finder screenshot described in the request is not treated as a reference.

## Shared visual grammar

- Near-black / deep navy page ground, fine geometric linework, matte cards with thin accent borders and controlled glow.
- Warm-white headings and labels, blue/cyan informational energy, brass/gold for competitive identity, green for learning/success. Avoid adopting the Purple Journey card as a universal identity color; it is mode-specific.
- Wide landscape content with low vertical stacks: usually 20–30 px viewport-safe inset (roughly 2–3% width), header around 70–85 px (about 9–11% screen height), cards/panels around 14–24 px radius, 1 px border, 12–20 px internal gutters.
- Headline roughly 34–42 px display; card heading 23–30 px; primary CTA ~48–60 px high; supporting copy 14–18 px; metadata 11–14 px. A narrow label may be uppercase/letter-spaced but must remain legible.
- Art occupies bounded card regions and generally 35–55% of a feature card; text remains in a left-safe zone with artwork cropped from the right. Real images should be clipped to the card frame with an intentional focal point.

## Per-reference layout readings

| Reference | Geometry / hierarchy | Reusable rules vs exceptions |
|---|---|---|
| Single Player `(7)` | Header plus centered title/subtitle; three equal cards across, each ~31% width with ~12 px gutter; cards fill most of remaining height. CTA anchored at card bottom, stats/content middle-left, robot art right. Outer content inset ~4% on mock screen. | Hub header, title, card/art, CTA, stat block are reusable; three-card row and three different card accents are page-specific. Only one primary nav in the shell. |
| Tournament `(6)` | Header with five area links plus account cluster; two-column body around 47/53. Left trophy card and rules strip; right countdown and upcoming list. Five-item bottom tabs are also shown. Insets ~3–4%; body cards share ~12 px gap. | Countdown block, compact event row, card and stat primitives reusable; page-specific two-column information hierarchy. Simultaneous top tabs + bottom tabs on phone is a mock inconsistency, not recommended. |
| Learn `(5)` | Brand/account header and centered title; secondary back control; two-by-two grid of wide cards. Two large rows occupy ~65% of content height. Each card has left copy/CTA and right art. Four mode colors appear. | Card/art/CTA reusable. Four-card grid and mode color choices are page-specific. Hero/header alignment should follow shared page header, not duplicate account UI. |
| Social `(4)` | Full top navigation with icon/label tabs plus account cluster. Intro/title upper left. Content uses ~70/30 main feed/sidebar, filters under heading, compact activity rows, right online/trending/weekly summary cards. | Filter, activity row, sidebar panel and stat primitives reusable. Two columns are wide-screen layout; small landscape should prioritize feed and expose secondary summaries as a reachable alternate panel or compact strip. Duplicate bottom tabs in mock is inconsistent. |
| Ghost gameplay `(3)` | Gameplay-only shell. Player/opponent strips top left/right, centered turn status. Central board ~full width and ~60% height. Right-side boneyard/open-end/zoom/audio/home controls; hand tray along bottom ~18% height. | Common game HUD, board, tray and controls; Ghost avatar/accent/status are variant data. The board is the largest area and should not be squeezed by hub navigation. Mock displays a left camera/pill decoration that may be device chrome, not a game control. |
| Today’s Race `(1)` | Brand/account top line, centered page title/subtitle, two feature cards roughly 50/50 side by side (~44% height), then compressed streak/week strip and bottom five-tab navigation. Daily Fritz art left card and puzzle art right. | Header, two feature cards, daily status, streak strip, tabs are composable. Daily card proportions and streak layout are home-specific. Reference makes a compelling hub vertical budget: nav/header ~13%, feature area ~49%, streak ~13%, bottom nav ~12%, remainder margins. |
| Daily Fritz `(2)` | Contextual back + brand and primary area navigation in header; main 43/57 split. Left is Fritz art/opponent and compact streak/deal/set identity; right is Today’s set row, best-of-three game cards, primary result CTA and leaderboard secondary CTA. No bottom tabs. | A focused Daily Fritz shell is appropriate. The game progression, shared-deal context, primary CTA and result facts are page-specific. Header should use contextual back and avoid simultaneously displaying bottom primary tabs. |

## Approximate normalized measurements

Measure the rendered app screen inside the illustrative phone, not the exterior frame. Because these images are independently composed and include fictional device bezels/camera cutouts, treat ratios as bands:

| Region/component | Approximate target band |
|---|---:|
| Safe content inset | 2–4% of screen width per side, with extra edge inset at cutout side |
| Header | 9–12% of screen height; 1px divider/border; logo icon 32–40px, wordmark 18–22px, account glyph 22–28px |
| Page title block | 10–16% height including subtitle; headline 34–42px; body line length 55–85 characters depending alignment |
| Feature CTA | 48–60px high; full card width where focused, or 40–60% card width in text/art card |
| Hub feature cards | Today’s Race ~1.9–2.2:1; Solo ~0.95–1.1:1; Learn ~2.1–2.5:1; Tournament panels ~1.15–1.45:1 |
| Social activity row | ~8–12% screen height, with 32–44px avatar and secondary metadata allowed one compact line |
| Gameplay board viewport | ~2.5–3.0:1 at landscape composition, occupying ~55–65% screen height |
| Daily Fritz left art/context | ~0.95–1.15:1; progression panel ~1.3–1.55:1 |
| Panel corners/border | 14–24px radius / 1px border; selected panel may add restrained 1–2px glow edge |
| Spacing | 8–12px local gap, 14–20px card padding, 12–16px major card gutter |

At 844×390 these ratios are adaptation inputs. Reflow decisions must maintain text and tap targets; if a source card ratio produces unreadable copy/art at the shortest heights, adjust composition (art crop/secondary detail) instead of shrinking all content.

## Mockup consistency audit

| Difference | Assessment | Product rule |
|---|---|---|
| Five text nav links, icon nav, or no top links | generation variation; mode page may need contextual back but not a separate identity | shared header with brand/account; desktop links live in desktop header, phone primary nav lives at bottom only on hub pages |
| Bottom tabs appear on Tournament/Social/Home but not Single Player, Learn, Daily Fritz | likely generated independently; not intentional route affordance | hub-level pages consistently use the Multiplayer / Single Player / Tournament / Social / Learn phone bottom tabs. Home shows the bar with no selected tab; detail/gameplay has contextual back and owns a clear exit path |
| Today’s Race mock highlights Multiplayer while showing Home content | mock-generation selected-state error | Home remains outside the five primary areas; retain Multiplayer as tab 1, but leave all five tabs unselected on Home |
| Back-to-home on Learn/Tournament, Back-to-Single Player on Daily Fritz/Ghost | meaningful hierarchy difference mixed with mockup artifacts | back destination reflects route context: Daily Fritz/Ghost → Single Player (if launched there), or route owner; hub pages may use bottom tabs and not require a back button |
| rating/friends/avatar only on selected screens | mock content inconsistency; account is global but HUD should not consume equal space everywhere | profile is always reachable; rating/friend counts are optional compact account-cluster data at sufficient width |
| centered titles vs left aligned page title | page composition choice, not mode architecture | shared PageHeader supports centered or left alignment variants; do not impose one alignment across all screens |
| icons switch line weight, family, and selected glow/color | generation artifact | standard icon source/size/stroke and selected-state tokens, active color tied to area |
| phone safe edge changes dramatically due device render, including side camera notch | decorative frame differs; app content needs real safe-area insets | shell owns safe-area padding; pages receive safe content bounds |
| rounded card geometry mostly consistent but content-shell width varies | mostly page density, not separate shell taxonomy | common card surface/radius/padding tokens; page grid owns its own columns |

## Proposed rule classification

- **Global:** navy ground, linework intensity, typography roles, focus/pressed behavior, safe-area baseline, 44×44 target minimum where practical, one mobile primary navigation, compact identity/account entry.
- **Shell-specific:** header height/content, bottom-tab presence, page safe inset, bounded page scroll, gameplay viewport ownership, modal sizing.
- **Component-specific:** card border/radius, art clip/focal position, CTA height, stat rows, filter chips, badges, player strip, domino/hand geometry.
- **Page-specific:** Home 2-card daily row and streak, Solo three mode cards, Learn four education modes, Tournament countdown/bracket content, Social feed/sidebar, Daily Fritz set progression, gameplay board/HUD allocation.

References communicate composition and quality, not exact UI content. Dynamic mock values (rating, date, scores, usernames, timer) are fixture values, not fixed design data.
