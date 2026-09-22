# Game Review explanation voice — product-owner review packet (10 samples)

**Status:** PENDING — PRODUCT OWNER VOICE SIGN-OFF

This packet is for human review only. An agent must not mark Ship Gate 2 complete.

**Canonical full corpus:** `docs/review-explanation-samples.md` (30 samples; positional prose force-enabled for generation; `REVIEW_POSITIONAL_EXPLANATIONS_ENABLED` remains `false` in product).

**Also available:** `docs/review-true-equal-prose-samples.md`, `docs/review-value-gap-fallback-samples.md`.

**Review ask:** Read these 10 NEW prose samples. Say which read like a strong player wrote them, and approve/reject the voice for admin-cohort enablement of positional explanations.

---

## Packet sample 1 — exact tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-106; hand undefined, turn undefined; score 45-43; open ends 0, 2, 5, 5, 0, 4, 6, 6; hand [1-4, 2-4]; boneyard 0 drawable / 2 dead.
- **Played:** 2-4 at right (0 immediate points)
- **Reference:** 2-4 at branch-1-1 (oracle; 0 immediate points)
- **OLD prose:** 2-4, better end -- play it at a branch end, not the right end. 2-4 was the correct tile; it just belongs at a branch end rather than the right end -- worth about 1.2 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 2-4 at a branch end (the engine’s line) over 2-4 at the right end -- biggest gap: unseen tiles matching the open ends (1). 2-4 at a branch end rates better on unseen tiles matching the open ends (by 1); 2-4 at a branch end rates better on exposure to an immediate reply (by 1). Two features separate these moves: unseen tiles matching the open ends and exposure to an immediate reply.
- **Feature values behind new sentences:** headline: opponentOutsLeft: played 2, reference 1, delta -1; detail: opponentOutsLeft: played 2, reference 1, delta -1; endDangerPenalty: played 5, reference 4, delta -1; takeaway: opponentOutsLeft: played 2, reference 1, delta -1; endDangerPenalty: played 5, reference 4, delta -1.

---

## Packet sample 2 — exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-28; hand undefined, turn undefined; score 5-6; open ends 5, 5, 2, 2, 3, 3; hand [5-5, 4-4]; boneyard 0 drawable / 2 dead.
- **Played:** 5-5 at left (3 immediate points)
- **Reference:** 5-5 at left (oracle; 3 immediate points)
- **OLD prose:** Top score available -- 5-5 for 3 points. Playing 5-5 at the left end was the strongest option here, scoring 3 points on the spot. Keep scanning the board for the highest-scoring line before you commit -- you found it this time.
- **NEW prose:** No meaningful positional difference in the measured features. 5-5 at the left end and 5-5 at the left end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

---

## Packet sample 3 — exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-105; hand undefined, turn undefined; score 43-45; open ends 0, 3, 5, 5, 0, 4, 6, 6; hand [1-1, 4-4, 2-3, 2-2, 3-4]; boneyard 0 drawable / 2 dead.
- **Played:** 2-3 at right (0 immediate points)
- **Reference:** 4-4 at branch-1-1 (oracle; 0 immediate points)
- **OLD prose:** Even on the scoreboard now, costlier over the rest of the hand. This move scored about the same as the best option right now, but it left a position that cost roughly 2.8 points in expected value over the rest of the hand. When two moves score the same immediately, the one that leaves you less exposed afterward is usually the better pick.
- **NEW prose:** No meaningful positional difference in the measured features. 2-3 at the right end and 4-4 at a branch end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

---

## Packet sample 4 — search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-68; hand undefined, turn undefined; score 24-20; open ends 2, 5, 5, 3; hand [4-4, 0-6, 2-5]; boneyard 9 drawable / 2 dead.
- **Played:** 2-5 at left (0 immediate points)
- **Reference:** 2-5 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** 2-5, better end -- play it at a branch end, not the left end. 2-5 was the correct tile; it just belongs at a branch end rather than the left end -- worth about 1.9 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 2-5 at a branch end (the engine’s line) over 2-5 at the left end -- biggest gap: end control (12). 2-5 at a branch end rates better on end control (by 12); 2-5 at a branch end rates better on exposure to an immediate reply (by 12). Fritz would have played 2-5 at the left end instead of 2-5 at a branch end here, so this read is contested. Two features separate these moves: end control and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endControlScore: played -36, reference -24, delta 12; detail: endControlScore: played -36, reference -24, delta 12; endDangerPenalty: played 32, reference 20, delta -12; takeaway: endControlScore: played -36, reference -24, delta 12; endDangerPenalty: played 32, reference 20, delta -12.

---

## Packet sample 5 — search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-101; hand undefined, turn undefined; score 43-42; open ends 0, 3, 5, 5, 6, 6; hand [1-1, 4-4, 2-3, 3-6, 2-2, 3-4]; boneyard 3 drawable / 2 dead.
- **Played:** 3-6 at branch-1-0 (0 immediate points)
- **Reference:** 3-6 at right (oracle; 0 immediate points)
- **OLD prose:** 3-6, better end -- play it at the right end, not a branch end. 3-6 was the correct tile; it just belongs at the right end rather than a branch end -- worth about 7.3 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 3-6 at the right end (the engine’s line) over 3-6 at a branch end -- biggest gap: unseen tiles matching the open ends (2). 3-6 at the right end rates better on unseen tiles matching the open ends (by 2). Fritz would have played 2-3 at the right end instead of 3-6 at the right end here, so this read is contested. The largest measured difference here is unseen tiles matching the open ends. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: opponentOutsLeft: played 5, reference 3, delta -2; detail: opponentOutsLeft: played 5, reference 3, delta -2; takeaway: opponentOutsLeft: played 5, reference 3, delta -2.

---

## Packet sample 6 — search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:4:move-35; hand undefined, turn undefined; score 11-12; open ends 4, 4, 3, 3, 4, 6; hand [0-0, 1-2, 2-5, 3-4]; boneyard 5 drawable / 2 dead.
- **Played:** 3-4 at branch-0-0 (0 immediate points)
- **Reference:** 3-4 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** 3-4, better end -- play it at a branch end, not a branch end. 3-4 was the correct tile; it just belongs at a branch end rather than a branch end -- worth about 0.6 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 3-4 at a branch end and 3-4 at a branch end have no feature difference above the reporting threshold. Fritz would have played 3-4 at the left end instead of 3-4 at a branch end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

---

## Packet sample 7 — heuristic tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-45; hand undefined, turn undefined; score 6-15; open ends 6, 6; hand [3-4, 0-3, 1-2, 3-5, 3-6, 2-4]; boneyard 12 drawable / 2 dead.
- **Played:** 3-6 at left (3 immediate points)
- **Reference:** 3-6 at right (fritz; 3 immediate points)
- **OLD prose:** Top score available, likely -- 3-6 for 3 points. Playing 3-6 at the left end was the strongest option here, by the engine's early read, scoring 3 points on the spot. Keep scanning the board for the highest-scoring line before you commit -- you found it this time.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 3-6 at the left end and 3-6 at the right end have no feature difference above the reporting threshold. The Review Engine's heuristic would have played 3-6 at the left end instead of 3-6 at the right end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

---

## Packet sample 8 — heuristic tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-58; hand undefined, turn undefined; score 14-18; open ends 2, 0; hand [0-2, 5-5, 4-4, 3-3, 1-6, 3-6]; boneyard 12 drawable / 2 dead.
- **Played:** 0-2 at right (0 immediate points)
- **Reference:** 0-2 at left (fritz; 0 immediate points)
- **OLD prose:** Solid pick -- 0-2 held up as the strongest option by the engine's early read. 0-2 at the right end didn't score immediately, but it was still the best move available here, by the engine's early read. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 0-2 at the right end and 0-2 at the left end have no feature difference above the reporting threshold. The Review Engine's heuristic would have played 0-2 at the right end instead of 0-2 at the left end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

---

## Packet sample 9 — True displayed-reference equality (from docs/review-true-equal-prose-samples.md)

## 1. search

- Decision ID: self-play:demo-ordinary-pvf-1:1:move-31
- Position: ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl
- Played: 2-4 at branch-2-1
- Displayed reference: 2-4 at branch-0-1
- referenceExpectedPointDifferential: 0
- Immediate delta: 0
- Contested: false
- Previous prose: No meaningful positional difference in the measured features.
- New prose: The review rates these two moves even overall.

---

## Packet sample 10 — Value-gap fallback (from docs/review-value-gap-fallback-samples.md)

## 1. search

- Position: ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl; hand 4; decision self-play:demo-ordinary-pvf-1:0:move-66; score 20-19; hand 3; boneyard 13.
- Played: 1-5 at branch-1-0 (0 immediate points)
- Reference: 1-5 at right (0 immediate points)
- Fallback: The engine’s line is worth about 1.4 more points overall, including the immediate score.
- Value gaps: expectedPointDifferential 1.4; immediatePoints 0.

---
