# Fritz Trust & Guardrails

**Date:** 2026-06-12  
**Branch:** `hardening/fritz-trust-guardrails`  
**Scope:** Regression tests + trust UX only — **no bot strength, scoring, RNG, or Daily Fritz tier changes.**

---

## Fairness state (post PR #2)

| Check | Status |
|-------|--------|
| Fritz does not read hidden human hand | ✅ `toBotVisibleState` / `chooseEndgameMoveSampled` |
| Fritz does not read boneyard stack order | ✅ `estimateDrawCostFromPublicInfo` |
| FIFO boneyard draws | ✅ `const [drawn, ...rest] = boneyard` (client + server) |
| Blocked pip tie → no hand winner | ✅ client + server |
| 0 illegal AI moves in sims | ✅ fairness + honesty test packs |

---

## Calibration anchors (standard proxy vs Fritz, race to 60)

| Matchup | Human win rate |
|---------|----------------|
| Standard vs Rookie | ~74.5% |
| Standard vs Standard | ~50.0% |
| Standard vs Elite | ~32.0% |
| Standard vs Master | ~21.5% |
| Daily Fritz BO3 (Elite proxy) | ~22% set win, ~50% brutal 0–2, ~2.4 games/set |
| Tournament race-to-30 vs Elite | ~43.5% human win |

Full audit: [fritz-calibration-perception-audit.md](./fritz-calibration-perception-audit.md)

---

## Regression test packs

| Pack | Location | Runner |
|------|----------|--------|
| Engine parity (server) | `server/src/game/engineParity.test.ts` | `npm run test --prefix server` |
| Engine parity (client mirror) | `client/src/bot/engineParity.behaviorTests.ts` | `npm run test:bot:parity --prefix client` |
| Bot honesty (client) | `client/src/bot/botHonesty.behaviorTests.ts` | `npm run test:bot:honesty --prefix client` |
| Tournament bot fairness | `server/src/bot/serverBot.fairness.test.ts` | `npm run test --prefix server` |
| Blocked-hand tie | `client/src/bot/botEngine.blockedHand.behaviorTests.ts` | ts-node |
| Public draw cost | `server/src/bot/publicDrawCost.test.ts`, `client/src/bot/publicDrawCost.behaviorTests.ts` | vitest / ts-node |

Golden scenario IDs are aligned between `engineParity.test.ts` and `engineParity.behaviorTests.ts` (prefix `parity-*`).

---

## Remaining drift risks (documented, not fixed in this PR)

| Risk | Severity | Notes |
|------|----------|-------|
| Dual engines (`botEngine.ts` vs `engine.ts`) | P1 | Parity tests catch rule drift; full merge deferred |
| Dual bot brains (`botHeuristics` vs `serverBot`) | P1 | Different `TIER_SELECT`; server has no Rookie tier |
| Tournament race-to-30 vs PVF race-to-60 | P1 | **Intentional** — tournament ends in endgame-defense zone more often |
| Client-only opponent pip inference on human draw | P2 | `opponentKnownMissing` in `botEngine.ts` ~985 |
| Hub doubles / complex board geometry | P2 | Separate test coverage; opening rules duplicated |
| `blockedHandRule` config on server | P2 | Client bot path always uses lowest-pips bonus |

---

## Recommendation

1. **Ship trust UX + tests first** (this PR) — accurate difficulty labels, post-game fairness line, parity/honesty regression packs.
2. **Do not nerf Fritz yet** — Elite/Master calibration is a product decision; sim baselines are documented.
3. **Daily Fritz tier** — stays **Elite** default; revisit only with retention data + explicit product sign-off.
4. **Later** — optional telemetry (endgame scoring rate, defenseMultiplier active), tournament/client bot constant alignment.

---

## Trust copy (UI)

| Surface | Constant / file |
|---------|-----------------|
| Play vs Fritz setup | `FRITZ_DIFFICULTY_FAIRNESS_NOTE` in `fritzTrustCopy.ts` |
| Tier descriptions | `fritzConfig.ts`, `PlayVsFritz.tsx` |
| Daily Fritz hub | `DAILY_FRITZ_EXPECTATION_COPY`, `DailyFritzScreen.tsx` |
| Post-game (PVF / Daily Fritz) | `FRITZ_POSTGAME_TRUST_LINE` in `BotMatchScreen.tsx` |
