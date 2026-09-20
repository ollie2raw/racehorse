# Review explanation samples

Generated from the committed recorded self-play corpus with `buildReviewCoachingFacts(evaluation, snapshot, true)` and positional prose explicitly enabled. The default product flag remains off.

Selection: 10 exact-tier, 10 search-tier, and 10 heuristic-tier moves; 16 contested decisions and 10 same-tile-wrong-end decisions.

## 1. exact tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-106; hand 5, turn 172; score 45-43; open ends 0, 2, 5, 5, 0, 4, 6, 6; hand [1-4, 2-4]; boneyard 0 drawable / 2 dead.
- **Played:** 2-4 at right (0 immediate points)
- **Reference:** 2-4 at branch-1-1 (oracle; 0 immediate points)
- **OLD prose:** 2-4, better end -- play it at a branch end, not the right end. 2-4 was the correct tile; it just belongs at a branch end rather than the right end -- worth about 1.2 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 2-4 at a branch end (the engine’s line) over 2-4 at the right end -- biggest gap: end control (12). 2-4 at the right end rates better on end control (by 12); 2-4 at the right end rates better on hand mobility (by 2). Two features separate these moves: end control and hand mobility.
- **Feature values behind new sentences:** headline: endControlScore: played -36, reference -48, delta -12; detail: endControlScore: played -36, reference -48, delta -12; handShapeMobilityScore: played 1, reference -1, delta -2; takeaway: endControlScore: played -36, reference -48, delta -12; handShapeMobilityScore: played 1, reference -1, delta -2.

## 2. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-28; hand 1, turn 43; score 5-6; open ends 5, 5, 2, 2, 3, 3; hand [5-5, 4-4]; boneyard 0 drawable / 2 dead.
- **Played:** 5-5 at left (3 immediate points)
- **Reference:** 5-5 at left (oracle; 3 immediate points)
- **OLD prose:** Only legal play -- 5-5. 5-5 at the left end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 5-5. 5-5 at the left end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 3. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-29; hand 1, turn 44; score 8-6; open ends 5, 5, 2, 2, 3, 3; hand [4-4]; boneyard 0 drawable / 2 dead.
- **Played:** pass (0 immediate points)
- **Reference:** pass (oracle; 0 immediate points)
- **OLD prose:** Only legal option was to pass. No legal play existed here, so passing was forced. Nothing to review here -- there was no real decision to make.
- **NEW prose:** Only legal option was to pass. No legal play existed here, so passing was forced. Nothing to review here -- there was no real decision to make.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 4. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-30; hand 1, turn 45; score 6-8; open ends 5, 5, 2, 2, 3, 3; hand [0-0, 1-1, 6-6, 0-1]; boneyard 0 drawable / 2 dead.
- **Played:** pass (0 immediate points)
- **Reference:** pass (oracle; 0 immediate points)
- **OLD prose:** Only legal option was to pass. No legal play existed here, so passing was forced. Nothing to review here -- there was no real decision to make.
- **NEW prose:** Only legal option was to pass. No legal play existed here, so passing was forced. Nothing to review here -- there was no real decision to make.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 5. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-84; hand 4, turn 134; score 30-35; open ends 5, 5, 3, 4, 1, 5, 3, 3; hand [4-4, 0-1]; boneyard 0 drawable / 2 dead.
- **Played:** 4-4 at branch-0-1 (0 immediate points)
- **Reference:** 4-4 at branch-0-1 (oracle; 0 immediate points)
- **OLD prose:** Solid pick -- 4-4 held up as the strongest option. 4-4 at a branch end didn't score immediately, but it was still the best move available here. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** No meaningful positional difference in the measured features. 4-4 at a branch end and 4-4 at a branch end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 6. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-85; hand 4, turn 135; score 30-35; open ends 5, 5, 3, 4, 1, 5, 3, 3; hand [0-1]; boneyard 0 drawable / 2 dead.
- **Played:** 0-1 at branch-1-0 (0 immediate points)
- **Reference:** 0-1 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** Only legal play -- 0-1. 0-1 at a branch end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 0-1. 0-1 at a branch end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 7. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-104; hand 5, turn 168; score 45-43; open ends 0, 3, 5, 5, 0, 6; hand [1-4, 2-4, 4-6]; boneyard 0 drawable / 2 dead.
- **Played:** 4-6 at branch-1-1 (0 immediate points)
- **Reference:** 4-6 at branch-1-1 (oracle; 0 immediate points)
- **OLD prose:** Only legal play -- 4-6. 4-6 at a branch end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 4-6. 4-6 at a branch end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 8. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-105; hand 5, turn 170; score 43-45; open ends 0, 3, 5, 5, 0, 4, 6, 6; hand [1-1, 4-4, 2-3, 2-2, 3-4]; boneyard 0 drawable / 2 dead.
- **Played:** 2-3 at right (0 immediate points)
- **Reference:** 4-4 at branch-1-1 (oracle; 0 immediate points)
- **OLD prose:** Even on the scoreboard now, costlier over the rest of the hand. This move scored about the same as the best option right now, but it left a position that cost roughly 2.8 points in expected value over the rest of the hand. When two moves score the same immediately, the one that leaves you less exposed afterward is usually the better pick.
- **NEW prose:** 4-4 at a branch end (the engine’s line) over 2-3 at the right end -- biggest gap: unseen tiles matching the open ends (2). 2-3 at the right end rates better on unseen tiles matching the open ends (by 2); 2-3 at the right end rates better on hand mobility (by 2). Two features separate these moves: unseen tiles matching the open ends and hand mobility.
- **Feature values behind new sentences:** headline: opponentOutsLeft: played 2, reference 4, delta 2; detail: opponentOutsLeft: played 2, reference 4, delta 2; handShapeMobilityScore: played 2, reference 0, delta -2; takeaway: opponentOutsLeft: played 2, reference 4, delta 2; handShapeMobilityScore: played 2, reference 0, delta -2.

## 9. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-107; hand 5, turn 174; score 43-45; open ends 0, 4, 5, 5, 0, 4, 6, 6; hand [1-1, 4-4, 2-2, 3-4]; boneyard 0 drawable / 2 dead.
- **Played:** 4-4 at branch-1-1 (0 immediate points)
- **Reference:** 4-4 at branch-1-1 (oracle; 0 immediate points)
- **OLD prose:** Solid pick -- 4-4 held up as the strongest option. 4-4 at a branch end didn't score immediately, but it was still the best move available here. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** No meaningful positional difference in the measured features. 4-4 at a branch end and 4-4 at a branch end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 10. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-108; hand 5, turn 175; score 43-45; open ends 0, 4, 5, 5, 0, 4, 6, 6; hand [1-1, 2-2, 3-4]; boneyard 0 drawable / 2 dead.
- **Played:** 3-4 at right (0 immediate points)
- **Reference:** 3-4 at right (oracle; 0 immediate points)
- **OLD prose:** Only legal play -- 3-4. 3-4 at the right end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 3-4. 3-4 at the right end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 11. search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-101; hand 5, turn 162; score 43-42; open ends 0, 3, 5, 5, 6, 6; hand [1-1, 4-4, 2-3, 3-6, 2-2, 3-4]; boneyard 3 drawable / 2 dead.
- **Played:** 3-6 at branch-1-0 (0 immediate points)
- **Reference:** 3-6 at right (oracle; 0 immediate points)
- **OLD prose:** 3-6, better end -- play it at the right end, not a branch end. 3-6 was the correct tile; it just belongs at the right end rather than a branch end -- worth about 7.3 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 3-6 at the right end (the engine’s line) over 3-6 at a branch end -- biggest gap: end control (24). 3-6 at a branch end rates better on end control (by 24); 3-6 at a branch end rates better on hand mobility (by 4). Fritz would have played 2-3 at the right end instead of 3-6 at the right end here, so this read is contested. Two features separate these moves: end control and hand mobility. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endControlScore: played -12, reference -36, delta -24; detail: endControlScore: played -12, reference -36, delta -24; handShapeMobilityScore: played -1, reference -5, delta -4; takeaway: endControlScore: played -12, reference -36, delta -24; handShapeMobilityScore: played -1, reference -5, delta -4.

## 12. search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:1:move-70; hand 4, turn 110; score 39-44; open ends 1, 1, 6, 4, 4, 4, 0, 0; hand [0-3, 0-1, 1-4]; boneyard 5 drawable / 2 dead.
- **Played:** 1-4 at right (0 immediate points)
- **Reference:** 1-4 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** 1-4, better end -- play it at a branch end, not the right end. 1-4 was the correct tile; it just belongs at a branch end rather than the right end -- worth about 1 point. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 1-4 at a branch end (the engine’s line) over 1-4 at the right end -- biggest gap: end control (12). 1-4 at a branch end rates better on end control (by 12); 1-4 at a branch end rates better on exposure to an immediate reply (by 3). Fritz would have played 1-4 at a branch end instead of 1-4 at a branch end here, so this read is contested. Two features separate these moves: end control and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endControlScore: played -18, reference -6, delta 12; detail: endControlScore: played -18, reference -6, delta 12; endDangerPenalty: played 20.50, reference 17.50, delta -3; takeaway: endControlScore: played -18, reference -6, delta 12; endDangerPenalty: played 20.50, reference 17.50, delta -3.

## 13. search tier — contested — same tile, wrong end

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:0:move-102; hand 7, turn 166; score 42-42; open ends 1, 6, 0, 3, 5, 5; hand [1-2, 1-5, 5-6, 4-5, 0-4, 2-6]; boneyard 11 drawable / 2 dead.
- **Played:** 5-6 at branch-1-0 (0 immediate points)
- **Reference:** 5-6 at right (oracle; 0 immediate points)
- **OLD prose:** 5-6, better end -- play it at the right end, not a branch end. 5-6 was the correct tile; it just belongs at the right end rather than a branch end -- worth about 3.1 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 5-6 at the right end (the engine’s line) over 5-6 at a branch end -- biggest gap: end control (12). 5-6 at the right end rates better on end control (by 12); 5-6 at the right end rates better on exposure to an immediate reply (by 8.2). Fritz would have played 1-5 at the left end instead of 5-6 at the right end here, so this read is contested. Two features separate these moves: end control and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endControlScore: played 6, reference 18, delta 12; detail: endControlScore: played 6, reference 18, delta 12; endDangerPenalty: played 26.80, reference 18.61, delta -8.18; takeaway: endControlScore: played 6, reference 18, delta 12; endDangerPenalty: played 26.80, reference 18.61, delta -8.18.

## 14. search tier — contested — same tile, wrong end

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:3:move-89; hand 4, turn 141; score 39-21; open ends 2, 0, 6, 6; hand [3-6, 0-3]; boneyard 10 drawable / 2 dead.
- **Played:** 3-6 at branch-0-1 (0 immediate points)
- **Reference:** 3-6 at branch-0-0 (oracle; 0 immediate points)
- **OLD prose:** 3-6, better end -- play it at a branch end, not a branch end. 3-6 was the correct tile; it just belongs at a branch end rather than a branch end -- worth about 0.9 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 3-6 at a branch end and 3-6 at a branch end have no feature difference above the reporting threshold. Fritz would have played 0-3 at the right end instead of 3-6 at a branch end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 15. search tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:1:move-83; hand 5, turn 130; score 65-39; open ends 4, 1, 2, 2, 6, 5; hand [1-4, 1-2]; boneyard 12 drawable / 2 dead.
- **Played:** 1-4 at right (0 immediate points)
- **Reference:** 1-4 at left (oracle; 0 immediate points)
- **OLD prose:** 1-4, better end -- play it at the left end, not the right end. 1-4 was the correct tile; it just belongs at the left end rather than the right end -- worth about 2.1 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 1-4 at the left end (the engine’s line) over 1-4 at the right end -- biggest gap: end control (12). 1-4 at the left end rates better on end control (by 12); 1-4 at the left end rates better on exposure to an immediate reply (by 10). Two features separate these moves: end control and exposure to an immediate reply.
- **Feature values behind new sentences:** headline: endControlScore: played -24, reference -12, delta 12; detail: endControlScore: played -24, reference -12, delta 12; endDangerPenalty: played 48, reference 38, delta -10; takeaway: endControlScore: played -24, reference -12, delta 12; endDangerPenalty: played 48, reference 38, delta -10.

## 16. search tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:4:move-29; hand 2, turn 47; score 12-9; open ends 6, 4, 3, 3; hand [0-4, 1-5, 4-6, 1-1]; boneyard 7 drawable / 2 dead.
- **Played:** 4-6 at left (0 immediate points)
- **Reference:** 4-6 at right (oracle; 0 immediate points)
- **OLD prose:** 4-6, better end -- play it at the right end, not the left end. 4-6 was the correct tile; it just belongs at the right end rather than the left end -- worth about 1.1 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 4-6 at the right end (the engine’s line) over 4-6 at the left end -- biggest gap: exposure to an immediate reply (5). 4-6 at the right end rates better on exposure to an immediate reply (by 5); 4-6 at the left end rates better on hand mobility (by 2). Two features separate these moves: exposure to an immediate reply and hand mobility.
- **Feature values behind new sentences:** headline: endDangerPenalty: played 21, reference 16, delta -5; detail: endDangerPenalty: played 21, reference 16, delta -5; handShapeMobilityScore: played -1, reference -3, delta -2; takeaway: endDangerPenalty: played 21, reference 16, delta -5; handShapeMobilityScore: played -1, reference -3, delta -2.

## 17. search tier — same tile, wrong end

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:0:move-87; hand 6, turn 142; score 39-35; open ends 4, 6, 1, 5; hand [1-3, 4-6, 2-5, 2-4]; boneyard 12 drawable / 2 dead.
- **Played:** 4-6 at left (0 immediate points)
- **Reference:** 4-6 at right (oracle; 0 immediate points)
- **OLD prose:** 4-6, better end -- play it at the right end, not the left end. 4-6 was the correct tile; it just belongs at the right end rather than the left end -- worth about 0.3 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 4-6 at the right end (the engine’s line) over 4-6 at the left end -- biggest gap: exposure to an immediate reply (20). 4-6 at the right end rates better on exposure to an immediate reply (by 20); 4-6 at the right end rates better on end control (by 12). Two features separate these moves: exposure to an immediate reply and end control.
- **Feature values behind new sentences:** headline: endDangerPenalty: played 36.25, reference 16.25, delta -20; detail: endDangerPenalty: played 36.25, reference 16.25, delta -20; endControlScore: played -12, reference 0, delta 12; takeaway: endDangerPenalty: played 36.25, reference 16.25, delta -20; endControlScore: played -12, reference 0, delta 12.

## 18. search tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-68; hand 4, turn 109; score 24-20; open ends 2, 5, 5, 3; hand [4-4, 0-6, 2-5]; boneyard 9 drawable / 2 dead.
- **Played:** 2-5 at left (0 immediate points)
- **Reference:** 2-5 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** Only legal play -- 2-5. 2-5 at the left end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 2-5. 2-5 at the left end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: endControlScore: played -36, reference -24, delta 12; detail: endControlScore: played -36, reference -24, delta 12; endDangerPenalty: played 32, reference 20, delta -12; takeaway: endControlScore: played -36, reference -24, delta 12; endDangerPenalty: played 32, reference 20, delta -12.

## 19. search tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:1:move-74; hand 4, turn 116; score 55-39; open ends 1, 4, 6, 5, 4, 4, 0, 0, 4, 4; hand [3-4]; boneyard 3 drawable / 2 dead.
- **Played:** 3-4 at branch-4-0 (0 immediate points)
- **Reference:** 3-4 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** Only legal play -- 3-4. 3-4 at a branch end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 3-4. 3-4 at a branch end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 20. search tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:3:move-88; hand 5, turn 151; score 51-32; open ends 1, 6, 4, 5, 3, 3, 2, 3, 6, 6, 2, 2; hand [1-3]; boneyard 1 drawable / 2 dead.
- **Played:** 1-3 at left (0 immediate points)
- **Reference:** 1-3 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** Only legal play -- 1-3. 1-3 at the left end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 1-3. 1-3 at the left end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: endDangerPenalty: played 32, reference 28, delta -4; detail: endDangerPenalty: played 32, reference 28, delta -4; opponentOutsLeft: played 3, reference 4, delta 1; takeaway: endDangerPenalty: played 32, reference 28, delta -4; opponentOutsLeft: played 3, reference 4, delta 1.

## 21. heuristic tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-95; hand 5, turn 152; score 41-38; open ends 0, 5, 5, 0; hand [6-6, 3-5, 1-5, 1-4]; boneyard 4 drawable / 2 dead.
- **Played:** 1-5 at branch-1-0 (0 immediate points)
- **Reference:** 1-5 at right (Fritz's read; 0 immediate points)
- **OLD prose:** Solid pick -- 1-5 held up as the strongest option by the engine's early read. 1-5 at a branch end didn't score immediately, but it was still the best move available here, by the engine's early read. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 1-5 at a branch end and 1-5 at the right end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 1-5 at a branch end instead of 1-5 at the right end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 22. heuristic tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-91; hand 5, turn 145; score 38-36; open ends 5, 5, 0, 0; hand [6-6, 3-5, 4-5, 5-6, 1-5, 1-4]; boneyard 5 drawable / 2 dead.
- **Played:** 5-6 at left (0 immediate points)
- **Reference:** 5-6 at right (Fritz's read; 0 immediate points)
- **OLD prose:** 5-6, better end -- play it at the right end, not the left end. 5-6 was the correct tile; it just belongs at the right end rather than the left end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 5-6 at the right end (Fritz's read) over 5-6 at the left end -- biggest gap: end control (30). 5-6 at the right end rates better on end control (by 30). The largest measured difference here is end control.
- **Feature values behind new sentences:** headline: endControlScore: played -10, reference 20, delta 30; detail: endControlScore: played -10, reference 20, delta 30; takeaway: endControlScore: played -10, reference 20, delta 30.

## 23. heuristic tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-112; hand 6, turn 183; score 43-48; open ends 4, 2; hand [1-1, 5-5, 2-4, 6-6, 1-5, 3-3, 1-6]; boneyard 12 drawable / 2 dead.
- **Played:** 2-4 at right (0 immediate points)
- **Reference:** 2-4 at right (Fritz's read; 0 immediate points)
- **OLD prose:** Only legal play -- 2-4. 2-4 at the right end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 2-4. 2-4 at the right end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 24. heuristic tier — contested

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:1:move-83; hand 6, turn 136; score 36-33; open ends 3, 2; hand [5-5, 4-6, 2-3, 4-4, 1-4, 1-1]; boneyard 12 drawable / 2 dead.
- **Played:** 2-3 at right (0 immediate points)
- **Reference:** 2-3 at right (Fritz's read; 0 immediate points)
- **OLD prose:** Only legal play -- 2-3. 2-3 at the right end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 2-3. 2-3 at the right end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 25. heuristic tier — contested

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:2:move-97; hand 7, turn 154; score 54-40; open ends 1, 2, 4, 6; hand [2-4, 0-4, 4-4, 0-3]; boneyard 12 drawable / 2 dead.
- **Played:** 2-4 at branch-0-0 (1 immediate points)
- **Reference:** 2-4 at branch-0-0 (Fritz's read; 1 immediate points)
- **OLD prose:** 2-4, better end -- play it at the right end, not a branch end. 2-4 was the correct tile; it just belongs at the right end rather than a branch end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 2-4 at a branch end and 2-4 at a branch end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 2-4 at the right end instead of 2-4 at a branch end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 26. heuristic tier — contested

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:3:move-79; hand 4, turn 127; score 16-34; open ends 1, 5, 6, 6; hand [1-3, 0-6, 2-2, 0-1, 1-5]; boneyard 12 drawable / 2 dead.
- **Played:** 1-5 at left (2 immediate points)
- **Reference:** 1-5 at left (Fritz's read; 2 immediate points)
- **OLD prose:** 1-5, better end -- play it at the right end, not the left end. 1-5 was the correct tile; it just belongs at the right end rather than the left end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 1-5 at the left end and 1-5 at the left end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 1-5 at the right end instead of 1-5 at the left end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 27. heuristic tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-3; hand 1, turn 3; score 3-0; open ends 4, 1; hand [1-4, 1-5, 2-2, 2-5, 3-6]; boneyard 12 drawable / 2 dead.
- **Played:** 1-5 at right (0 immediate points)
- **Reference:** 1-4 at left (Fritz's read; 0 immediate points)
- **OLD prose:** Solid pick -- 1-5 held up as the strongest option by the engine's early read. 1-5 at the right end didn't score immediately, but it was still the best move available here, by the engine's early read. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** Contested: 1-4 at the left end (Fritz's read) over 1-5 at the right end -- biggest gap: unseen tiles matching the open ends (5). 1-4 at the left end rates better on unseen tiles matching the open ends (by 5); 1-4 at the left end rates better on exposure to an immediate reply (by 2.5). the Review Engine's heuristic would have played 1-5 at the right end instead of 1-4 at the left end here, so this read is contested. Two features separate these moves: unseen tiles matching the open ends and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: opponentOutsLeft: played 9, reference 4, delta -5; detail: opponentOutsLeft: played 9, reference 4, delta -5; endDangerPenalty: played 12.50, reference 10, delta -2.50; takeaway: opponentOutsLeft: played 9, reference 4, delta -5; endDangerPenalty: played 12.50, reference 10, delta -2.50.

## 28. heuristic tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-31; hand 2, turn 47; score 11-6; open ends -1; hand [4-6, 0-4, 0-5, 4-5, 0-0, 1-1, 2-3]; boneyard 12 drawable / 2 dead.
- **Played:** 4-6 at left (2 immediate points)
- **Reference:** 2-3 at left (Fritz's read; 1 immediate points)
- **OLD prose:** Top score available, likely -- 4-6 for 2 points. Playing 4-6 at the left end was the strongest option here, by the engine's early read, scoring 2 points on the spot. Keep scanning the board for the highest-scoring line before you commit -- you found it this time.
- **NEW prose:** Contested: 2-3 at the left end (Fritz's read) over 4-6 at the left end -- biggest gap: end control (22). 4-6 at the left end rates better on end control (by 22); 4-6 at the left end rates better on exposure to an immediate reply (by 8.4). 2-3 at the left end scores 1 fewer point immediately. the Review Engine's heuristic would have played 4-6 at the left end instead of 2-3 at the left end here, so this read is contested. Two features separate these moves: end control and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endControlScore: played -2, reference -24, delta -22; detail: endControlScore: played -2, reference -24, delta -22; endDangerPenalty: played 15.64, reference 24, delta 8.36; immediatePoints: played 2, reference 1, delta -1; takeaway: endControlScore: played -2, reference -24, delta -22; endDangerPenalty: played 15.64, reference 24, delta 8.36.

## 29. heuristic tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-34; hand 2, turn 52; score 13-6; open ends 0, 1; hand [0-5, 4-5, 0-0, 1-1, 2-3]; boneyard 12 drawable / 2 dead.
- **Played:** 0-5 at left (0 immediate points)
- **Reference:** 0-0 at left (Fritz's read; 0 immediate points)
- **OLD prose:** Solid pick -- 0-5 held up as the strongest option by the engine's early read. 0-5 at the left end didn't score immediately, but it was still the best move available here, by the engine's early read. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** Contested: 0-0 at the left end (Fritz's read) over 0-5 at the left end -- biggest gap: double/hub exposure risk (109). 0-5 at the left end rates better on double/hub exposure risk (by 109); 0-0 at the left end rates better on exposure to an immediate reply (by 1.3). the Review Engine's heuristic would have played 0-5 at the left end instead of 0-0 at the left end here, so this read is contested. Two features separate these moves: double/hub exposure risk and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: doubleHubOpeningRisk: played 0, reference 109, delta 109; detail: doubleHubOpeningRisk: played 0, reference 109, delta 109; endDangerPenalty: played 12.50, reference 11.25, delta -1.25; takeaway: doubleHubOpeningRisk: played 0, reference 109, delta 109; endDangerPenalty: played 12.50, reference 11.25, delta -1.25.

## 30. heuristic tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-45; hand 3, turn 72; score 6-15; open ends 6, 6; hand [3-4, 0-3, 1-2, 3-5, 3-6, 2-4]; boneyard 12 drawable / 2 dead.
- **Played:** 3-6 at left (3 immediate points)
- **Reference:** 3-6 at right (Fritz's read; 3 immediate points)
- **OLD prose:** Only legal play -- 3-6. 3-6 at the left end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **NEW prose:** Only legal play -- 3-6. 3-6 at the left end was the only legal move on the board -- there was nothing else to weigh. Nothing to review here -- this move plays itself.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

