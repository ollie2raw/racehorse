# Review explanation samples

Generated from the committed recorded self-play corpus with `buildReviewCoachingFacts(evaluation, snapshot, true)` and positional prose explicitly enabled. The default product flag remains off.

Selection: 10 exact-tier, 10 search-tier, and 10 heuristic-tier moves; 16 contested decisions and 18 same-tile-wrong-end decisions.

## 1. exact tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-106; hand 5, turn 172; score 45-43; open ends 0, 2, 5, 5, 0, 4, 6, 6; hand [1-4, 2-4]; boneyard 0 drawable / 2 dead.
- **Played:** 2-4 at right (0 immediate points)
- **Reference:** 2-4 at branch-1-1 (oracle; 0 immediate points)
- **OLD prose:** 2-4, better end -- play it at a branch end, not the right end. 2-4 was the correct tile; it just belongs at a branch end rather than the right end -- worth about 1.2 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 2-4 at a branch end (the engine’s line) over 2-4 at the right end -- biggest gap: unseen tiles matching the open ends (1). 2-4 at a branch end rates better on unseen tiles matching the open ends (by 1); 2-4 at a branch end rates better on exposure to an immediate reply (by 1). Two features separate these moves: unseen tiles matching the open ends and exposure to an immediate reply.
- **Feature values behind new sentences:** headline: opponentOutsLeft: played 2, reference 1, delta -1; detail: opponentOutsLeft: played 2, reference 1, delta -1; endDangerPenalty: played 5, reference 4, delta -1; takeaway: opponentOutsLeft: played 2, reference 1, delta -1; endDangerPenalty: played 5, reference 4, delta -1.

## 2. exact tier

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-28; hand 1, turn 43; score 5-6; open ends 5, 5, 2, 2, 3, 3; hand [5-5, 4-4]; boneyard 0 drawable / 2 dead.
- **Played:** 5-5 at left (3 immediate points)
- **Reference:** 5-5 at left (oracle; 3 immediate points)
- **OLD prose:** Top score available -- 5-5 for 3 points. Playing 5-5 at the left end was the strongest option here, scoring 3 points on the spot. Keep scanning the board for the highest-scoring line before you commit -- you found it this time.
- **NEW prose:** No meaningful positional difference in the measured features. 5-5 at the left end and 5-5 at the left end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
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
- **NEW prose:** No meaningful positional difference in the measured features. 2-3 at the right end and 4-4 at a branch end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

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
- **OLD prose:** Solid pick -- 3-4 held up as the strongest option. 3-4 at the right end didn't score immediately, but it was still the best move available here. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** No meaningful positional difference in the measured features. 3-4 at the right end and 3-4 at the right end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 11. search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-68; hand 4, turn 109; score 24-20; open ends 2, 5, 5, 3; hand [4-4, 0-6, 2-5]; boneyard 9 drawable / 2 dead.
- **Played:** 2-5 at left (0 immediate points)
- **Reference:** 2-5 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** 2-5, better end -- play it at a branch end, not the left end. 2-5 was the correct tile; it just belongs at a branch end rather than the left end -- worth about 1.9 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 2-5 at a branch end (the engine’s line) over 2-5 at the left end -- biggest gap: end control (12). 2-5 at a branch end rates better on end control (by 12); 2-5 at a branch end rates better on exposure to an immediate reply (by 12). Fritz would have played 2-5 at the left end instead of 2-5 at a branch end here, so this read is contested. Two features separate these moves: end control and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endControlScore: played -36, reference -24, delta 12; detail: endControlScore: played -36, reference -24, delta 12; endDangerPenalty: played 32, reference 20, delta -12; takeaway: endControlScore: played -36, reference -24, delta 12; endDangerPenalty: played 32, reference 20, delta -12.

## 12. search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-101; hand 5, turn 162; score 43-42; open ends 0, 3, 5, 5, 6, 6; hand [1-1, 4-4, 2-3, 3-6, 2-2, 3-4]; boneyard 3 drawable / 2 dead.
- **Played:** 3-6 at branch-1-0 (0 immediate points)
- **Reference:** 3-6 at right (oracle; 0 immediate points)
- **OLD prose:** 3-6, better end -- play it at the right end, not a branch end. 3-6 was the correct tile; it just belongs at the right end rather than a branch end -- worth about 7.3 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 3-6 at the right end (the engine’s line) over 3-6 at a branch end -- biggest gap: unseen tiles matching the open ends (2). 3-6 at the right end rates better on unseen tiles matching the open ends (by 2). Fritz would have played 2-3 at the right end instead of 3-6 at the right end here, so this read is contested. The largest measured difference here is unseen tiles matching the open ends. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: opponentOutsLeft: played 5, reference 3, delta -2; detail: opponentOutsLeft: played 5, reference 3, delta -2; takeaway: opponentOutsLeft: played 5, reference 3, delta -2.

## 13. search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:1:move-70; hand 4, turn 110; score 39-44; open ends 1, 1, 6, 4, 4, 4, 0, 0; hand [0-3, 0-1, 1-4]; boneyard 5 drawable / 2 dead.
- **Played:** 1-4 at right (0 immediate points)
- **Reference:** 1-4 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** 1-4, better end -- play it at a branch end, not the right end. 1-4 was the correct tile; it just belongs at a branch end rather than the right end -- worth about 1 point. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 1-4 at a branch end (the engine’s line) over 1-4 at the right end -- biggest gap: end control (12). 1-4 at a branch end rates better on end control (by 12); 1-4 at a branch end rates better on exposure to an immediate reply (by 3). Fritz would have played 1-4 at a branch end instead of 1-4 at a branch end here, so this read is contested. Two features separate these moves: end control and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endControlScore: played -18, reference -6, delta 12; detail: endControlScore: played -18, reference -6, delta 12; endDangerPenalty: played 20.50, reference 17.50, delta -3; takeaway: endControlScore: played -18, reference -6, delta 12; endDangerPenalty: played 20.50, reference 17.50, delta -3.

## 14. search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:1:move-74; hand 4, turn 116; score 55-39; open ends 1, 4, 6, 5, 4, 4, 0, 0, 4, 4; hand [3-4]; boneyard 3 drawable / 2 dead.
- **Played:** 3-4 at branch-4-0 (0 immediate points)
- **Reference:** 3-4 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** 3-4, better end -- play it at a branch end, not a branch end. 3-4 was the correct tile; it just belongs at a branch end rather than a branch end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 3-4 at a branch end and 3-4 at a branch end have no feature difference above the reporting threshold. Fritz would have played 3-4 at a branch end instead of 3-4 at a branch end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 15. search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:3:move-88; hand 5, turn 151; score 51-32; open ends 1, 6, 4, 5, 3, 3, 2, 3, 6, 6, 2, 2; hand [1-3]; boneyard 1 drawable / 2 dead.
- **Played:** 1-3 at left (0 immediate points)
- **Reference:** 1-3 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** 1-3, better end -- play it at a branch end, not the left end. 1-3 was the correct tile; it just belongs at a branch end rather than the left end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 1-3 at a branch end (the engine’s line) over 1-3 at the left end -- biggest gap: exposure to an immediate reply (4). 1-3 at a branch end rates better on exposure to an immediate reply (by 4). Fritz would have played 1-3 at a branch end instead of 1-3 at a branch end here, so this read is contested. The largest measured difference here is exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endDangerPenalty: played 32, reference 28, delta -4; detail: endDangerPenalty: played 32, reference 28, delta -4; takeaway: endDangerPenalty: played 32, reference 28, delta -4.

## 16. search tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:4:move-35; hand 2, turn 56; score 11-12; open ends 4, 4, 3, 3, 4, 6; hand [0-0, 1-2, 2-5, 3-4]; boneyard 5 drawable / 2 dead.
- **Played:** 3-4 at branch-0-0 (0 immediate points)
- **Reference:** 3-4 at branch-1-0 (oracle; 0 immediate points)
- **OLD prose:** 3-4, better end -- play it at a branch end, not a branch end. 3-4 was the correct tile; it just belongs at a branch end rather than a branch end -- worth about 0.6 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 3-4 at a branch end and 3-4 at a branch end have no feature difference above the reporting threshold. Fritz would have played 3-4 at the left end instead of 3-4 at a branch end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 17. search tier — contested — same tile, wrong end

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:0:move-39; hand 2, turn 65; score 13-19; open ends 5, 0, 3, 2; hand [2-3]; boneyard 5 drawable / 2 dead.
- **Played:** 2-3 at branch-0-1 (0 immediate points)
- **Reference:** 2-3 at branch-0-0 (oracle; 0 immediate points)
- **OLD prose:** 2-3, better end -- play it at a branch end, not a branch end. 2-3 was the correct tile; it just belongs at a branch end rather than a branch end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 2-3 at a branch end (the engine’s line) over 2-3 at a branch end -- biggest gap: unseen tiles matching the open ends (1). 2-3 at a branch end rates better on unseen tiles matching the open ends (by 1). Fritz would have played 2-3 at a branch end instead of 2-3 at a branch end here, so this read is contested. The largest measured difference here is unseen tiles matching the open ends. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: opponentOutsLeft: played 6, reference 5, delta -1; detail: opponentOutsLeft: played 6, reference 5, delta -1; takeaway: opponentOutsLeft: played 6, reference 5, delta -1.

## 18. search tier — contested — same tile, wrong end

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:0:move-102; hand 7, turn 166; score 42-42; open ends 1, 6, 0, 3, 5, 5; hand [1-2, 1-5, 5-6, 4-5, 0-4, 2-6]; boneyard 11 drawable / 2 dead.
- **Played:** 5-6 at branch-1-0 (0 immediate points)
- **Reference:** 5-6 at right (oracle; 0 immediate points)
- **OLD prose:** 5-6, better end -- play it at the right end, not a branch end. 5-6 was the correct tile; it just belongs at the right end rather than a branch end -- worth about 3.1 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: 5-6 at the right end (the engine’s line) over 5-6 at a branch end -- biggest gap: end control (12). 5-6 at the right end rates better on end control (by 12); 5-6 at the right end rates better on exposure to an immediate reply (by 8.2). Fritz would have played 1-5 at the left end instead of 5-6 at the right end here, so this read is contested. Two features separate these moves: end control and exposure to an immediate reply. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: endControlScore: played 6, reference 18, delta 12; detail: endControlScore: played 6, reference 18, delta 12; endDangerPenalty: played 26.80, reference 18.61, delta -8.18; takeaway: endControlScore: played 6, reference 18, delta 12; endDangerPenalty: played 26.80, reference 18.61, delta -8.18.

## 19. search tier — contested — same tile, wrong end

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:0:move-138; hand 9, turn 226; score 62-63; open ends 4, 0, 0, 6, 1, 2; hand [3-3, 0-4]; boneyard 6 drawable / 2 dead.
- **Played:** 0-4 at branch-0-0 (0 immediate points)
- **Reference:** 0-4 at left (oracle; 0 immediate points)
- **OLD prose:** 0-4, better end -- play it at the left end, not a branch end. 0-4 was the correct tile; it just belongs at the left end rather than a branch end -- worth about 0 points. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 0-4 at a branch end and 0-4 at the left end have no feature difference above the reporting threshold. Fritz would have played 0-4 at a branch end instead of 0-4 at the left end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 20. search tier — contested — same tile, wrong end

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:2:move-50; hand 3, turn 77; score 21-24; open ends 5, 0, 2, 1, 3, 3; hand [0-2]; boneyard 7 drawable / 2 dead.
- **Played:** 0-2 at right (0 immediate points)
- **Reference:** 0-2 at branch-0-0 (oracle; 0 immediate points)
- **OLD prose:** 0-2, better end -- play it at a branch end, not the right end. 0-2 was the correct tile; it just belongs at a branch end rather than the right end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 0-2 at the right end and 0-2 at a branch end have no feature difference above the reporting threshold. Fritz would have played 0-2 at the right end instead of 0-2 at a branch end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 21. heuristic tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-45; hand 3, turn 72; score 6-15; open ends 6, 6; hand [3-4, 0-3, 1-2, 3-5, 3-6, 2-4]; boneyard 12 drawable / 2 dead.
- **Played:** 3-6 at left (3 immediate points)
- **Reference:** 3-6 at right (Fritz's read; 3 immediate points)
- **OLD prose:** Top score available, likely -- 3-6 for 3 points. Playing 3-6 at the left end was the strongest option here, by the engine's early read, scoring 3 points on the spot. Keep scanning the board for the highest-scoring line before you commit -- you found it this time.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 3-6 at the left end and 3-6 at the right end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 3-6 at the left end instead of 3-6 at the right end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 22. heuristic tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-58; hand 4, turn 94; score 14-18; open ends 2, 0; hand [0-2, 5-5, 4-4, 3-3, 1-6, 3-6]; boneyard 12 drawable / 2 dead.
- **Played:** 0-2 at right (0 immediate points)
- **Reference:** 0-2 at left (Fritz's read; 0 immediate points)
- **OLD prose:** Solid pick -- 0-2 held up as the strongest option by the engine's early read. 0-2 at the right end didn't score immediately, but it was still the best move available here, by the engine's early read. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 0-2 at the right end and 0-2 at the left end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 0-2 at the right end instead of 0-2 at the left end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 23. heuristic tier — contested — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-95; hand 5, turn 152; score 41-38; open ends 0, 5, 5, 0; hand [6-6, 3-5, 1-5, 1-4]; boneyard 4 drawable / 2 dead.
- **Played:** 1-5 at branch-1-0 (0 immediate points)
- **Reference:** 1-5 at right (Fritz's read; 0 immediate points)
- **OLD prose:** Solid pick -- 1-5 held up as the strongest option by the engine's early read. 1-5 at a branch end didn't score immediately, but it was still the best move available here, by the engine's early read. Not every good move scores right away -- this one set up the position correctly.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 1-5 at a branch end and 1-5 at the right end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 1-5 at a branch end instead of 1-5 at the right end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 24. heuristic tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-91; hand 5, turn 145; score 38-36; open ends 5, 5, 0, 0; hand [6-6, 3-5, 4-5, 5-6, 1-5, 1-4]; boneyard 5 drawable / 2 dead.
- **Played:** 5-6 at left (0 immediate points)
- **Reference:** 5-6 at right (Fritz's read; 0 immediate points)
- **OLD prose:** 5-6, better end -- play it at the right end, not the left end. 5-6 was the correct tile; it just belongs at the right end rather than the left end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 5-6 at the right end (Fritz's read) over 5-6 at the left end -- biggest gap: end control (30). 5-6 at the right end rates better on end control (by 30). The largest measured difference here is end control.
- **Feature values behind new sentences:** headline: endControlScore: played -10, reference 20, delta 30; detail: endControlScore: played -10, reference 20, delta 30; takeaway: endControlScore: played -10, reference 20, delta 30.

## 25. heuristic tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:3:move-35; hand 3, turn 58; score 18-14; open ends 6, 1; hand [3-3, 0-4, 1-6, 3-4, 0-2]; boneyard 12 drawable / 2 dead.
- **Played:** 1-6 at right (0 immediate points)
- **Reference:** 1-6 at left (Fritz's read; 0 immediate points)
- **OLD prose:** 1-6, better end -- play it at the left end, not the right end. 1-6 was the correct tile; it just belongs at the left end rather than the right end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** No meaningful positional difference in the measured features. 1-6 at the right end and 1-6 at the left end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 26. heuristic tier — same tile, wrong end

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:4:move-22; hand 2, turn 35; score 10-9; open ends 3, 2; hand [0-6, 0-4, 6-6, 1-5, 4-6, 4-5, 1-1, 2-3]; boneyard 8 drawable / 2 dead.
- **Played:** 2-3 at right (0 immediate points)
- **Reference:** 2-3 at left (Fritz's read; 0 immediate points)
- **OLD prose:** 2-3, better end -- play it at the left end, not the right end. 2-3 was the correct tile; it just belongs at the left end rather than the right end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** No meaningful positional difference in the measured features. 2-3 at the right end and 2-3 at the left end have no feature difference above the reporting threshold. The measured features do not explain a preference between these moves.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 27. heuristic tier — same tile, wrong end

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:3:move-54; hand 3, turn 84; score 23-10; open ends 1, 4, 2, 2; hand [3-6, 3-5, 1-2]; boneyard 12 drawable / 2 dead.
- **Played:** 1-2 at branch-0-0 (0 immediate points)
- **Reference:** 1-2 at left (Fritz's read; 0 immediate points)
- **OLD prose:** 1-2, better end -- play it at the left end, not a branch end. 1-2 was the correct tile; it just belongs at the left end rather than a branch end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** 1-2 at the left end (Fritz's read) over 1-2 at a branch end -- biggest gap: exposure to an immediate reply (8). 1-2 at the left end rates better on exposure to an immediate reply (by 8); 1-2 at the left end rates better on unseen tiles matching the open ends (by 4). Two features separate these moves: exposure to an immediate reply and unseen tiles matching the open ends.
- **Feature values behind new sentences:** headline: endDangerPenalty: played 38, reference 30, delta -8; detail: endDangerPenalty: played 38, reference 30, delta -8; opponentOutsLeft: played 13, reference 9, delta -4; takeaway: endDangerPenalty: played 38, reference 30, delta -8; opponentOutsLeft: played 13, reference 9, delta -4.

## 28. heuristic tier — contested

- **Position:** `ordinary-pvf-tier--tier-standard--seed-demo-ordinary-pvf-1--games-5.jsonl` · self-play:demo-ordinary-pvf-1:0:move-112; hand 6, turn 183; score 43-48; open ends 4, 2; hand [1-1, 5-5, 2-4, 6-6, 1-5, 3-3, 1-6]; boneyard 12 drawable / 2 dead.
- **Played:** 2-4 at right (0 immediate points)
- **Reference:** 2-4 at right (Fritz's read; 0 immediate points)
- **OLD prose:** 2-4, better end -- play it at the left end, not the right end. 2-4 was the correct tile; it just belongs at the left end rather than the right end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 2-4 at the right end and 2-4 at the right end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 2-4 at the left end instead of 2-4 at the right end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 29. heuristic tier — contested

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:1:move-83; hand 6, turn 136; score 36-33; open ends 3, 2; hand [5-5, 4-6, 2-3, 4-4, 1-4, 1-1]; boneyard 12 drawable / 2 dead.
- **Played:** 2-3 at right (0 immediate points)
- **Reference:** 2-3 at right (Fritz's read; 0 immediate points)
- **OLD prose:** 2-3, better end -- play it at the left end, not the right end. 2-3 was the correct tile; it just belongs at the left end rather than the right end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 2-3 at the right end and 2-3 at the right end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 2-3 at the left end instead of 2-3 at the right end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

## 30. heuristic tier — contested

- **Position:** `strong-policy-top-tier--tier-master--seed-demo-strong-policy-1--games-5.jsonl` · self-play:demo-strong-policy-1:2:move-97; hand 7, turn 154; score 54-40; open ends 1, 2, 4, 6; hand [2-4, 0-4, 4-4, 0-3]; boneyard 12 drawable / 2 dead.
- **Played:** 2-4 at branch-0-0 (1 immediate points)
- **Reference:** 2-4 at branch-0-0 (Fritz's read; 1 immediate points)
- **OLD prose:** 2-4, better end -- play it at the right end, not a branch end. 2-4 was the correct tile; it just belongs at the right end rather than a branch end. Once you know the tile, check both ends before you place it -- the end matters as much as the tile.
- **NEW prose:** Contested: No meaningful positional difference in the measured features. 2-4 at a branch end and 2-4 at a branch end have no feature difference above the reporting threshold. the Review Engine's heuristic would have played 2-4 at the right end instead of 2-4 at a branch end here, so this read is contested. The measured features do not explain a preference between these moves. The engines disagree on the reference move.
- **Feature values behind new sentences:** headline: no supported feature delta; detail: no supported feature delta; takeaway: no supported feature delta.

