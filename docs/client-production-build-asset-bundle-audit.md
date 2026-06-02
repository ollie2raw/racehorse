# Client production build, asset, and bundle audit

**Date:** 2026-06-01  
**Scope:** Client only (`client/`). No gameplay, UI redesign, server, or broad architecture changes.

## Executive summary

| Item | Status |
|------|--------|
| Unresolved `ghost-art.webp` / `nobrainer-art.webp` warnings | **Fixed** |
| `npm run build --prefix client` | **Pass** |
| Chunk size warnings (>500 kB) | **Still present** (expected; documented below) |
| Safe first-load win applied | **Lazy-load `SinglePlayerHubScreen`** (~2.1 MB hero PNGs deferred off home) |

---

## 1. Warnings fixed

### Unresolved assets: `ghost-art.webp`, `nobrainer-art.webp`

**Root cause:** `client/src/screens/RacehorseHomeArt.css` referenced WebP files under `client/src/assets/home/` that were never added to the repo. Git history has no record of those files. The selectors `.home-card-art--ghost` and `.home-card-art--nobrainer` were **not used** by any TSX (home uses `--fritz` / `--puzzle` only; Single Player hub uses bundled PNG imports in `SinglePlayerHubScreen.tsx`).

**Fix:** Removed the dead CSS rules (not a visual change—those classes were unreachable).

**Canonical art for Ghost / No Brainer (unchanged):**

| Surface | Mechanism | Assets |
|---------|-----------|--------|
| Single Player hub | Vite `import` | `fritzghost2.png`, `leftfacingfritzNOBRAINER.png`, `fritzwave1.png` |
| Ghost setup | Vite `import` | `ghost/ghostblue.png` |

---

## 2. Files changed

| File | Change |
|------|--------|
| `client/src/screens/RacehorseHomeArt.css` | Removed unused `.home-card-art--ghost` / `--nobrainer` rules with broken WebP URLs |
| `client/src/App.tsx` | `SinglePlayerHubScreen` → `React.lazy` + `Suspense` (defers hub PNGs off initial navigation) |
| `docs/client-production-build-asset-bundle-audit.md` | This report |

---

## 3. Build result

```bash
npm run build --prefix client
```

- **Exit code:** 0  
- **Unresolved asset warnings:** none  
- **Chunk size warnings:** Rollup still reports chunks >500 kB (see §4)

**Representative output (post-fix):**

| Asset / chunk | Size (min) | gzip |
|---------------|------------|------|
| `index-*.js` (main app shell) | ~1,942 kB | ~239 kB |
| `index-*.js` (shared vendor slice) | ~112 kB | ~31 kB |
| `vendor-charts-*.js` (recharts) | ~397 kB | ~116 kB |
| `vendor-supabase-*.js` | ~171 kB | ~45 kB |
| `BotMatchScreen-*.js` | ~167 kB | ~48 kB |
| `SinglePlayerHubScreen-*.js` | ~8 kB | ~3 kB |
| `index-*.css` (global + Tailwind) | ~444 kB | ~75 kB |

---

## 4. Bundle / chunk audit

### Already split well

- **recharts** → `vendor-charts` (~397 kB). Only used from lazy `RatingHistoryPage`.
- **@supabase/supabase-js** → `vendor-supabase` (~171 kB).
- **socket.io-client** → `vendor-socket` (~41 kB).
- **canvas-confetti** → `vendor-confetti` (~11 kB).
- Most mode screens (bot, ghost, daily puzzle/Fritz, learn, stats, friends, feed, admin, etc.) are **`React.lazy`** in `App.tsx`.

### Largest remaining chunks and why

| Chunk | ~Size | Why it’s large |
|-------|-------|----------------|
| **Main `index-*.js`** | **1.94 MB** | `App.tsx` (~3.5k lines) + statically imported **multiplayer path**: `LiveMatchScreen`, `MatchmakingScreen`, `PrivateMatchLobbyScreen`, tournament hub/bracket/result, `useLiveMatchSession` / socket sync, `analyzeMoveLog`, guided-authoring helpers, `HomeScreen`, tournament hooks/API. This is the default shell for home + online play. |
| **vendor-charts** | 397 kB | Recharts; lazy-loaded with rating history only. |
| **vendor-supabase** | 171 kB | Auth/session client. |
| **BotMatchScreen** | 167 kB | Bot engine, coaching, match UI (lazy when entering bot/ghost). |
| **DailyPuzzleScreen** | 78 kB | Puzzle mode + worker wiring (lazy). |

### Non-critical code **not** in the main JS bundle

Charts, stats, social feed, friends, learn player, guided recorder/annotator, admin puzzle tools, No Brainer lab, Play vs Fritz setup, ghost setup—each in separate lazy chunks.

### Non-critical code **still** on the main path (by design today)

- **Live multiplayer:** `LiveMatchScreen`, board components, room transport, match sessions.
- **Tournament UI:** hub, bracket, result screens (static imports; only active in `appMode === 'tournament'`).
- **Matchmaking / private lobby** screens.
- **Home:** `HomeScreen` + `RacehorseHomeArt.css` (expected for default route).

### Safe change applied this pass

- **`SinglePlayerHubScreen` lazy-loaded** — Previously static import pulled **~2.1 MB** of hub hero PNGs (`fritzwave1`, `fritzghost2`, `leftfacingfritzNOBRAINER`) into the same module graph as first paint. Now loaded only when user opens Single Player hub.

### Recommended code-splitting (next pass, ranked)

1. **Lazy tournament cluster** — `TournamentHubScreen`, `TournamentBracketScreen`, `TournamentResultScreen`; remove dead `void TournamentScreen` import. Low risk; wrap existing `appMode === 'tournament'` branch in `Suspense`.
2. **Lazy `MatchmakingScreen` + `PrivateMatchLobbyScreen`** — Only needed for `multiplayer` mode; same Suspense pattern as other modes.
3. **Dynamic import `analyzeMoveLog`** — Used after multiplayer hand ends; can load on first analysis instead of at startup.
4. **Dynamic import guided-authoring** — Only for learn recorder/annotator modes.
5. **manualChunks** — Optional `vendor-react` split for long-term caching (measure gzip + HTTP/2 count first).

**Avoid for now:** Lazy-loading `LiveMatchScreen` or `HomeScreen` without a dedicated loading UX pass (multiplayer recovery and home LCP are sensitive).

---

## 5. Large image audit

### Built / referenced PNGs (production `dist/assets/`)

| File (hashed in dist) | ~Size | Loaded on first paint? | Notes |
|----------------------|-------|------------------------|-------|
| `newnewladderfinal` | 5.6 MB | No (Daily Puzzle ladder lazy route) | Source: `dailyPuzzle/newnewladderfinal.png` (5.4 MB on disk) |
| `ghostblue` | 3.6 MB | No (Ghost setup lazy) | `ghost/ghostblue.png` |
| `learnmodeimages` | 1.9 MB | No (learn CSS in lazy learn bundle) | |
| `homefinalpuzzle` | 1.8 MB | **Yes (home)** | CSS `url()` in `RacehorseHomeArt.css` |
| `newHOMEdailyfritz` | 1.7 MB | **Yes (home)** | CSS `url()` |
| `playvsfritzdone` / `playfritz2png` | 1.35 / 1.21 MB | No (Play vs Fritz lazy) | |
| `leftfacingfritzNOBRAINER` | 1.1 MB | No (SP hub lazy) | |
| `fritzghost2` | 676 kB | No (SP hub lazy) | |
| `fritzwave1` | 357 kB | No (SP hub lazy) | |

### Largest source files on disk (not all in first load)

| Path | ~Size |
|------|-------|
| `client/src/assets/dailyPuzzle/finalLADDERimage.png` | 6.9 MB |
| `client/src/assets/dailyPuzzle/newLADDERfinal.png` | 5.9 MB |
| `client/src/assets/dailyPuzzle/donedoneLADDER.png` | 5.5 MB |
| `client/src/assets/dailyPuzzle/newnewladderfinal.png` | 5.4 MB |
| `client/src/assets/ghost/newGHOSTmode.png` | 4.1 MB |
| `client/src/assets/ghost/ghostblue.png` | 3.5 MB |

Multiple ladder PNG variants exist; only `newnewladderfinal.png` is imported in app code—**candidates for repo cleanup** after confirming no external links.

### Compression strategy (needs design approval for hero art)

1. **Home heroes first (highest LCP impact):** Convert `newHOMEdailyfritz.png` + `homefinalpuzzle.png` to **WebP @ ~85 quality** or AVIF; keep PNG fallbacks only if QA requires. Target **40–60%** byte reduction without changing crop/mask behavior in CSS.
2. **Mode heroes:** `ghostblue`, ladder, Play vs Fritz PNGs—same pipeline; lazy routes make this less urgent than home.
3. **Duplicate ladder assets:** Delete or archive unused ladder PNGs after grep confirms zero references.
4. **`public/` duplicates:** Several ~2 MB Fritz/puzzle PNGs under `client/public/` mirror bundled assets—audit for dead static hosting.
5. **Do not** downscale below current display sizes on retina; prefer modern formats + `srcset` if moving from CSS `background-image` to `<img>` later.

---

## 6. CSS size audit

### Production CSS chunks (gzip)

| Chunk | Raw | gzip | Role |
|-------|-----|------|------|
| `index-*.css` (primary) | ~444 kB | ~75 kB | Tailwind (`index.css` `@tailwind` scans all `src/**/*`) + global imports from `main.tsx` |
| `dailyFritz-*.css` | ~121 kB | ~19 kB | Lazy Daily Fritz screen |
| `index-CRJAOFrg.css` (secondary) | ~86 kB | ~16 kB | Additional global / feature CSS |
| `dailyPuzzle-*.css` | ~73 kB | ~13 kB | Lazy puzzle |
| `guidedMatch…css` | ~68 kB | ~12 kB | Learn guided match |
| `BotMatchScreen-*.css` | ~29 kB | ~6 kB | Lazy bot match |

### Why global CSS is large

| Source | ~Source size | Notes |
|--------|--------------|-------|
| **Tailwind preflight + utilities** | Majority of ~444 kB dist | `content: ['./src/**/*.{tsx,jsx,ts,js}']` includes experimental paths; purging is working but utility surface is wide |
| **`App.css`** | ~100 kB / 4,706 lines | Legacy global layout, multiplayer, modals, welcome—much predates token system |
| **`walnut-live.css`** | ~76 kB | Live board/tile rules (AGENTS.md: do not delete casually) |
| **`main.tsx` chain** | 13 global CSS entry imports | Board, match HUD, premium theme, racehorse background, etc. all load on every route |

### CSS cleanup recommendations (no deletion this pass)

1. **Tailwind:** Narrow `content` globs (exclude deprecated `experimental/` if unused).
2. **`App.css`:** Incremental extraction—move mode-specific blocks into lazy screen CSS (tournament, matchmaking already have partial splits).
3. **Duplicate tokens:** Consolidate `:root` in `App.css` vs `tokens.css` over time.
4. **Measure before purge:** Use coverage in Chrome DevTools on home + live match flows.

---

## 7. Safe next performance pass (ranked)

| Priority | Action | Impact | Risk |
|----------|--------|--------|------|
| P0 | WebP/AVIF for **home** CSS background PNGs | Large LCP win | Low if visual QA on masks/gradients |
| P0 | Lazy tournament + matchmaking screens | ↓ main JS parse | Low with existing `ScreenLoader` |
| P1 | Remove unused ladder PNG duplicates from repo | Repo + confusion | Low after reference check |
| P1 | Dynamic import `analyzeMoveLog` / guided authoring | ↓ main JS | Low |
| P2 | `public/` static asset dedup vs bundled imports | Less duplicate deploy weight | Medium (URL contracts) |
| P2 | Split `vendor-react` for cache longevity | Repeat-visit | Low |
| P3 | `App.css` modularization + Tailwind content tighten | ↓ CSS bytes | Medium (regression surface) |

---

## 8. Remaining risks / gaps

- **Main JS still ~1.94 MB** — acceptable for beta only with HTTP compression; mobile CPU for parse/eval remains the bottleneck.
- **Home still downloads ~3.4 MB PNG** via CSS on first visit—biggest user-visible load after this pass.
- **Chunk size warning** is informational; do not raise `chunkSizeWarningLimit` without improving actual delivery.
- **Server build** not run (no server changes).

---

## 9. Validation checklist

- [x] `npm run build --prefix client` passes
- [x] No unresolved asset warnings
- [x] Chunk warnings documented separately
- [x] Ranked optimization plan for beta
- [ ] Manual smoke: Home → Single Player hub (lazy loader) → Ghost / No Brainer cards show art
- [ ] Manual smoke: Home daily cards (Fritz / Puzzle) unchanged
