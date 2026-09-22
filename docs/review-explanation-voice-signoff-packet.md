# Game Review explanation voice — product-owner review packet (10 samples)

**Status:** PENDING — PRODUCT OWNER VOICE SIGN-OFF

This packet is for human review only. An agent must not mark Ship Gate 2 complete.

**Voice pass:** `feat/review-coaching-voice-quality` — coaching translation of structured facts (no oracle/feature/D1–D4 changes).

**Product flag:** `REVIEW_POSITIONAL_EXPLANATIONS_ENABLED` remains `false`. Samples force-enable positional prose for review only.

**Selection:** deterministic predeclared decision IDs in `packages/review-engine/src/devtools/writeVoiceSignoffPacket.ts` (`VOICE_SIGNOFF_DECISION_IDS`).

**Review ask:** Read these 10 NEW prose samples. Approve or reject the voice for admin-cohort enablement of positional explanations.

---

## Packet sample 1 — exact — same tile / wrong end (positional outs)

- **Decision ID:** `self-play:demo-ordinary-pvf-1:0:move-106`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 45-43; hand [1-4, 2-4]; boneyard 0 drawable / 2 dead.
- **Played:** 2-4 at right (0 immediate points)
- **Displayed reference:** 2-4 at branch-1-1 (oracle; 0 immediate points)
- **Classification / evidence:** missKind=`same_tile_wrong_end`; tier=`exact`; display=`Exact analysis`
- **Contested:** no
- **referenceExpectedPointDifferential:** 1.2000000000000002
- **Player-facing NEW prose:**
  - Headline: Right tile, wrong end.
  - Why: Play it at a branch end, not the right end — that placement leaves your opponent only 1 matching reply instead of 2.
  - Takeaway: You found the right tile — check every legal end before placing it.
- **Supporting structured facts (audit):** endControlScore: played -36, reference -48, delta -12; handShapeMobilityScore: played 1, reference -1, delta -2; opponentOutsLeft: played 2, reference 1, delta -1; endDangerPenalty: played 5, reference 4, delta -1; immediateΔ=0; expectedΔ=1.2000000000000002.

## Packet sample 2 — exact — played == reference (scoring)

- **Decision ID:** `self-play:demo-ordinary-pvf-1:0:move-28`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 5-6; hand [5-5, 4-4]; boneyard 0 drawable / 2 dead.
- **Played:** 5-5 at left (3 immediate points)
- **Displayed reference:** 5-5 at left (oracle; 3 immediate points)
- **Classification / evidence:** missKind=`correct`; tier=`exact`; display=`Exact analysis`
- **Contested:** no
- **referenceExpectedPointDifferential:** 0
- **Player-facing NEW prose:**
  - Headline: Best move.
  - Why: You found 5-5 for 3 points, matching the Review Engine.
  - Takeaway: (none)
- **Supporting structured facts (audit):** no supported feature delta above reporting threshold; immediateΔ=0; expectedΔ=0.

## Packet sample 3 — exact — value gap without supporting features

- **Decision ID:** `self-play:demo-ordinary-pvf-1:0:move-105`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 43-45; hand [1-1, 4-4, 2-3, 2-2, 3-4]; boneyard 0 drawable / 2 dead.
- **Played:** 2-3 at right (0 immediate points)
- **Displayed reference:** 4-4 at branch-1-1 (oracle; 0 immediate points)
- **Classification / evidence:** missKind=`reply_risk`; tier=`exact`; display=`Exact analysis`
- **Contested:** no
- **referenceExpectedPointDifferential:** 2.833333333333333
- **Player-facing NEW prose:**
  - Headline: The Review Engine prefers 4-4 by about 2.8 points overall.
  - Why: Both moves score the same immediately, but we don't have a reliable single positional reason for the gap.
  - Takeaway: (none)
- **Supporting structured facts (audit):** opponentOutsLeft: played 2, reference 4, delta 2; handShapeMobilityScore: played 2, reference 0, delta -2; endDangerPenalty: played 3.0681818181818183, reference 4.318181818181818, delta 1.25; handShapeOrphanCount: played 1, reference 2, delta 1; immediateΔ=0; expectedΔ=2.833333333333333.

## Packet sample 4 — search contested — same tile / wrong end

- **Decision ID:** `self-play:demo-ordinary-pvf-1:0:move-68`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 24-20; hand [4-4, 0-6, 2-5]; boneyard 9 drawable / 2 dead.
- **Played:** 2-5 at left (0 immediate points)
- **Displayed reference:** 2-5 at branch-1-0 (oracle; 0 immediate points)
- **Classification / evidence:** missKind=`same_tile_wrong_end`; tier=`search`; display=`Review Engine search`
- **Contested:** yes
- **referenceExpectedPointDifferential:** 1.88
- **Player-facing NEW prose:**
  - Headline: Right tile, wrong end.
  - Why: The Review Engine prefers the branch placement, while Fritz prefers 2-5 at the left end. The branch placement keeps more control of the open ends, and leaves fewer easy replies for your opponent.
  - Takeaway: You found the right tile — check every legal end before placing it.
- **Supporting structured facts (audit):** endControlScore: played -36, reference -24, delta 12; endDangerPenalty: played 32, reference 20, delta -12; immediateΔ=0; expectedΔ=1.88.

## Packet sample 5 — search contested — outs translation

- **Decision ID:** `self-play:demo-ordinary-pvf-1:0:move-101`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 43-42; hand [1-1, 4-4, 2-3, 3-6, 2-2, 3-4]; boneyard 3 drawable / 2 dead.
- **Played:** 3-6 at branch-1-0 (0 immediate points)
- **Displayed reference:** 3-6 at right (oracle; 0 immediate points)
- **Classification / evidence:** missKind=`same_tile_wrong_end`; tier=`search`; display=`Review Engine search`
- **Contested:** yes
- **referenceExpectedPointDifferential:** 7.34
- **Player-facing NEW prose:**
  - Headline: Right tile, wrong end.
  - Why: The Review Engine prefers 3-6 at the right end, while Fritz prefers 2-3 at the right end. The right-end placement leaves your opponent only 3 matching replies instead of 5.
  - Takeaway: You found the right tile — check every legal end before placing it.
- **Supporting structured facts (audit):** endControlScore: played -12, reference -36, delta -24; handShapeMobilityScore: played -1, reference -5, delta -4; endDangerPenalty: played 11.454545454545453, reference 14, delta 2.5454545454545467; opponentOutsLeft: played 5, reference 3, delta -2; immediateΔ=0; expectedΔ=7.34.

## Packet sample 6 — search contested — branch vs branch

- **Decision ID:** `self-play:demo-ordinary-pvf-1:4:move-35`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 11-12; hand [0-0, 1-2, 2-5, 3-4]; boneyard 5 drawable / 2 dead.
- **Played:** 3-4 at branch-0-0 (0 immediate points)
- **Displayed reference:** 3-4 at branch-1-0 (oracle; 0 immediate points)
- **Classification / evidence:** missKind=`same_tile_wrong_end`; tier=`search`; display=`Review Engine search`
- **Contested:** yes
- **referenceExpectedPointDifferential:** 0.5699999999999998
- **Player-facing NEW prose:**
  - Headline: Right tile, wrong branch.
  - Why: The Review Engine prefers the other branch, while Fritz prefers 3-4 at the left end. The Review Engine prefers the other branch by about 0.6 more points overall.
  - Takeaway: You found the right tile — check every legal end before placing it.
- **Supporting structured facts (audit):** no supported feature delta above reporting threshold; immediateΔ=0; expectedΔ=0.5699999999999998.

## Packet sample 7 — heuristic contested — Fritz primary

- **Decision ID:** `self-play:demo-ordinary-pvf-1:0:move-45`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 6-15; hand [3-4, 0-3, 1-2, 3-5, 3-6, 2-4]; boneyard 12 drawable / 2 dead.
- **Played:** 3-6 at left (3 immediate points)
- **Displayed reference:** 3-6 at right (fritz; 3 immediate points)
- **Classification / evidence:** missKind=`same_tile_wrong_end`; tier=`heuristic`; display=`Heuristic estimate`
- **Contested:** yes
- **referenceExpectedPointDifferential:** unavailable
- **Player-facing NEW prose:**
  - Headline: This one is close.
  - Why: Fritz prefers 3-6 at the right end, while the Review Engine's heuristic prefers 3-6 at the left end.
  - Takeaway: (none)
- **Supporting structured facts (audit):** no supported feature delta above reporting threshold; immediateΔ=0; expectedΔ=0.

## Packet sample 8 — heuristic contested — close placement

- **Decision ID:** `self-play:demo-ordinary-pvf-1:0:move-58`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 14-18; hand [0-2, 5-5, 4-4, 3-3, 1-6, 3-6]; boneyard 12 drawable / 2 dead.
- **Played:** 0-2 at right (0 immediate points)
- **Displayed reference:** 0-2 at left (fritz; 0 immediate points)
- **Classification / evidence:** missKind=`same_tile_wrong_end`; tier=`heuristic`; display=`Heuristic estimate`
- **Contested:** yes
- **referenceExpectedPointDifferential:** unavailable
- **Player-facing NEW prose:**
  - Headline: This one is close.
  - Why: Fritz prefers 0-2 at the left end, while the Review Engine's heuristic prefers 0-2 at the right end. The Review Engine's measured positional features favor 0-2 at the right end, while Fritz prefers the displayed reference.
  - Takeaway: (none)
- **Supporting structured facts (audit):** endControlScore: played -24, reference -48, delta -24; endDangerPenalty: played 16, reference 36, delta 20; opponentOutsLeft: played 4, reference 9, delta 5; immediateΔ=0; expectedΔ=0.

## Packet sample 9 — search — true displayed-reference equality

- **Decision ID:** `self-play:demo-ordinary-pvf-1:1:move-31`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 34-19; hand [2-4]; boneyard 6 drawable / 2 dead.
- **Played:** 2-4 at branch-2-1 (0 immediate points)
- **Displayed reference:** 2-4 at branch-0-1 (oracle; 0 immediate points)
- **Classification / evidence:** missKind=`same_tile_wrong_end`; tier=`search`; display=`Review Engine search`
- **Contested:** no
- **referenceExpectedPointDifferential:** 0
- **Player-facing NEW prose:**
  - Headline: The review rates these two moves even overall.
  - Why: (none)
  - Takeaway: (none)
- **Supporting structured facts (audit):** endControlScore: played -36, reference -48, delta -12; endDangerPenalty: played 28, reference 36, delta 8; opponentOutsLeft: played 7, reference 8, delta 1; immediateΔ=0; expectedΔ=0.

## Packet sample 10 — search — value-gap fallback

- **Decision ID:** `self-play:demo-ordinary-pvf-1:0:move-66`
- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl`; score 20-19; hand [0-4, 0-0, 1-5]; boneyard 11 drawable / 2 dead.
- **Played:** 1-5 at branch-1-0 (0 immediate points)
- **Displayed reference:** 1-5 at right (oracle; 0 immediate points)
- **Classification / evidence:** missKind=`same_tile_wrong_end`; tier=`search`; display=`Review Engine search`
- **Contested:** no
- **referenceExpectedPointDifferential:** 1.4299999999999997
- **Player-facing NEW prose:**
  - Headline: The Review Engine prefers the right end by about 1.4 points overall.
  - Why: Both moves score the same immediately, but we don't have a reliable single positional reason for the gap.
  - Takeaway: (none)
- **Supporting structured facts (audit):** endDangerPenalty: played 30, reference 50, delta 20; endControlScore: played -24, reference -36, delta -12; opponentOutsLeft: played 9, reference 12, delta 3; immediateΔ=0; expectedΔ=1.4299999999999997.
