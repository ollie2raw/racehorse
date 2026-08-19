# Daily Fritz Ground Truth Audit

Audit date: 2026-08-19  
Audited branch: `feat/daily-fritz-platform-phase1`  
Diff base: `main...feat/daily-fritz-platform-phase1`  
PR reference: [PR #16](https://github.com/ollie2raw/racehorse/pull/16)

## 1) Raw test output (no summary)

### Server tests (`server/src/http/routes/dailyFritz*.test.ts`)

```text
> server@1.0.0 test:focused
> vitest run src/http/routes/dailyFritzCheckpoint.test.ts src/http/routes/dailyFritzTranscriptFidelity.test.ts src/http/routes/dailyFritzNeverStrand.test.ts src/http/routes/dailyFritzTieBlockAndDrawDedupClientTranscript.test.ts src/http/routes/dailyFritzTwoSidedBlockClientTranscript.test.ts src/http/routes/dailyFritzHandOverPersistence.test.ts src/http/routes/dailyFritzTodayCompletedRestore.test.ts src/http/routes/dailyFritzDebugDate.test.ts src/http/routes/dailyFritzVerification.test.ts src/http/routes/dailyFritzOperationalRoutes.test.ts src/http/routes/dailyFritzPublishedAuthority.test.ts src/http/routes/dailyFritzMetrics.test.ts src/http/routes/dailyFritzRequestDiagnostics.test.ts src/http/routes/dailyFritzProgress.test.ts

 DEPRECATED  `test.poolOptions` was removed in Vitest 4. All previous `poolOptions` are now top-level options. Please, refer to the migration guide: https://vitest.dev/guide/migration#pool-rework

 RUN  v4.1.10 /Users/olivermorid/racehorse-dominoes/server

{"level":30,"time":1787160121576,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"59a04745-005c-4e17-ba19-7ab965a6cb96","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160121578,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160121591,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"bot","drawPlayerTile":{"low":1,"high":2},"drawFritzTile":{"low":2,"high":4},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160121591,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160121592,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"44c34609-18b1-4588-93e1-30f3461ced14","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160121592,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":50,"time":1787160121592,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":null,"handIndex":0,"verifierCode":"illegal_action","message":"Transcript action 4 (player draw) is illegal: Draw is not legal.","msg":"[daily-fritz] player stranded on Hand Over — non-retryable verification rejection"}
{"level":30,"time":1787160121593,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"930b40ee-61bb-45db-b563-e1af3def8fe2","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160121593,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160121594,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"bot","drawPlayerTile":{"low":1,"high":2},"drawFritzTile":{"low":2,"high":4},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160121594,"pid":41935,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160122027,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"c8c65685-5a02-4a72-b977-691df01b29bf","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122028,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122030,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160122030,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160122031,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","userId":"user-1","date":"2026-08-10","msg":"[daily-fritz:init] request"}
{"level":30,"time":1787160122031,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","runDate":"2026-08-10","gameNumber":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"metadataHasDrawTiles":false,"msg":"[daily-fritz:start] draw package"}
{"level":30,"time":1787160122032,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"50edd2bd-ab33-49a7-b948-d838012b25b7","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122032,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122033,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","userId":"user-1","date":"2026-08-10","msg":"[daily-fritz:init] request"}
{"level":30,"time":1787160122033,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","runDate":"2026-08-10","gameNumber":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"metadataHasDrawTiles":false,"msg":"[daily-fritz:start] draw package"}
{"level":30,"time":1787160122035,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"8faf8137-9ebd-411f-b78b-65105666bac6","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122035,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122038,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"9cbed68d-ca8b-4d6e-a132-f8b2601165df","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122038,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122040,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"331af172-4445-40e4-a807-aafc8e3037a9","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122040,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122040,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"a8322f99-afc2-4c50-b27c-b1a9f326cce1","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122040,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122040,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160122040,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160122040,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"1f4a25ad-7c95-40c7-bdd2-d4bcbf6db75f","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":1,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122040,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":1,"msg":"[daily-fritz-next-hand] current game"}
{"level":50,"time":1787160122041,"pid":41946,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":null,"handIndex":1,"verifierCode":"malformed_transcript","message":"Transcript contains unsupported fields.","msg":"[daily-fritz] player stranded on Hand Over — non-retryable verification rejection"}
{"level":30,"time":1787160122461,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"ffca1422-afe2-44b5-964a-30ce6ab6937a","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122462,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122466,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160122466,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160122467,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"f816dcf4-dc62-46cb-aa33-eff686a27568","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122467,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122469,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"22bcc747-df45-41a1-b3db-ec377867529c","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122469,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122470,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160122470,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160122471,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"f03a55ae-9091-4748-9e39-9825ce125178","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122471,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":50,"time":1787160122471,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":null,"handIndex":0,"verifierCode":"post_terminal_action","message":"Transcript contains an action after hand completion.","msg":"[daily-fritz] player stranded on Hand Over — non-retryable verification rejection"}
{"level":30,"time":1787160122472,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","userId":"user-1","date":"2026-08-10","msg":"[daily-fritz:init] request"}
{"level":30,"time":1787160122472,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","runDate":"2026-08-10","gameNumber":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"metadataHasDrawTiles":false,"msg":"[daily-fritz:start] draw package"}
{"level":30,"time":1787160122472,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"7093cc19-04ce-4c23-a7a4-43dd30c207ce","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122472,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122472,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160122472,"pid":41957,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160122902,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"f6f02841-d35e-4fdd-b01e-aad0c3d21573","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122903,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":50,"time":1787160122904,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","userId":"user-1","gameNumber":1,"handIndex":0,"verifierCode":"illegal_action","message":"Transcript action 0 (player play 0|0 @ left) is illegal: Player player does not have tile [0|0] in hand.","msg":"[daily-fritz] advancing without verification receipt — run is now unranked"}
{"level":30,"time":1787160122905,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160122905,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160122906,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"8e2a895f-9013-4ab1-ab40-fd6623fbb73b","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122906,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":50,"time":1787160122906,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":null,"handIndex":0,"verifierCode":"illegal_action","message":"Transcript action 0 (player play 0|0 @ left) is illegal: Player player does not have tile [0|0] in hand.","msg":"[daily-fritz] player stranded on Hand Over — non-retryable verification rejection"}
{"level":30,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"e77e2f4c-15d2-49f1-9467-d640af98e641","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":0,"msg":"[daily-fritz-next-hand] current game"}
{"level":50,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","userId":"user-1","gameNumber":1,"handIndex":0,"verifierCode":"illegal_action","message":"Transcript action 0 (player play 0|0 @ left) is illegal: Player player does not have tile [0|0] in hand.","msg":"[daily-fritz] advancing without verification receipt — run is now unranked"}
{"level":30,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":false,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3298ad4f-a8db-496c-8602-bba500f73b12","attemptId":"attempt-1","runDateFromClient":"2026-08-10","rawGameNumber":1,"completedHandIndex":0,"msg":"[daily-fritz-next-hand] request"}
{"level":30,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","requestedGameNumber":1,"currentGameNumber":1,"resolvedGameNumber":1,"currentHandIndex":1,"msg":"[daily-fritz-next-hand] current game"}
{"level":30,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","runDate":"2026-08-10","gameNumber":1,"currentHandIndex":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"msg":"[daily-fritz-next-hand] draw package"}
{"level":30,"time":1787160122907,"pid":41968,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","gameNumber":1,"currentHandIndex":1,"replayed":true,"ignored":false,"msg":"[daily-fritz-next-hand] returning hand"}
{"level":30,"time":1787160124111,"pid":41982,"hostname":"Mac.attlocal.net","context":"daily-fritz","attemptId":"attempt-1","checkpointRevision":2,"handIndex":0,"msg":"[daily-fritz:checkpoint] saved"}
{"level":30,"time":1787160124113,"pid":41982,"hostname":"Mac.attlocal.net","context":"daily-fritz","userId":"user-1","date":"2026-08-10","msg":"[daily-fritz:init] request"}
{"level":30,"time":1787160124113,"pid":41982,"hostname":"Mac.attlocal.net","context":"daily-fritz","runDate":"2026-08-10","gameNumber":1,"drawWinner":"you","drawPlayerTile":{"low":2,"high":4},"drawFritzTile":{"low":1,"high":2},"metadataHasDrawTiles":false,"msg":"[daily-fritz:start] draw package"}
{"level":30,"time":1787160124528,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"entry","totalMs":0,"method":"GET","path":"/api/daily-fritz/today","msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"auth","ms":0,"totalMs":1,"authenticated":true,"msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","userId":"user-1","date":"2026-08-10","msg":"[daily-fritz:init] request"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"dateKey","ms":0,"totalMs":1,"runDate":"2026-08-10","usedDebugDate":true,"msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"cacheProbe","ms":0,"totalMs":1,"runDate":"2026-08-10","hadCachedRun":false,"msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"getDailyFritzRunSummary","ms":0,"totalMs":1,"runDate":"2026-08-10","cacheHit":true,"hadCachedRun":false,"msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"getDailyFritzAttempt","ms":0,"totalMs":1,"runDate":"2026-08-10","status":"completed","msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"getDailyFritzStreak","ms":0,"totalMs":1,"runDate":"2026-08-10","streak":0,"msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"userStateCombined","ms":0,"totalMs":1,"runDate":"2026-08-10","msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","userId":"user-1","date":"2026-08-10","phase":"completed","msg":"[daily-fritz:init] loaded-existing"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"buildDailyFritzLeaderboard","ms":0,"totalMs":1,"runDate":"2026-08-10","entryCount":0,"msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"serializeResponse","ms":0,"totalMs":1,"runDate":"2026-08-10","payloadKeys":27,"msg":"[daily-fritz-server] today"}
{"level":30,"time":1787160124529,"pid":41993,"hostname":"Mac.attlocal.net","context":"daily-fritz","requestId":"3b961ed9","label":"response","totalMs":1,"attemptStatus":"completed","runDate":"2026-08-10","hadCachedRun":false,"cacheMiss":true,"msg":"[daily-fritz-server] today"}

 Test Files  14 passed (14)
      Tests  58 passed (58)
   Start at  10:21:44
   Duration  21.24s (transform 675ms, setup 0ms, import 4.70s, tests 14.33s, environment 1ms)
```

### Client tests (`client/src/dailyFritz/*.test.ts`)

```text
> client@0.0.0 test
> vitest run src/dailyFritz/dailyFritzHubViewModel.test.ts src/dailyFritz/apiRetryPolicy.test.ts src/dailyFritz/dailyFritzScreenHelpers.test.ts src/dailyFritz/telemetry.test.ts src/dailyFritz/dailyFritzChallengeIdentity.test.ts src/dailyFritz/dailyFritzMoveEvidence.test.ts src/dailyFritz/dailyFritzNextHandFailurePolicy.test.ts src/dailyFritz/skunk.test.ts src/dailyFritz/buildDailyFritzSetOverlayViewModel.test.ts src/dailyFritz/apiFaultInjection.test.ts src/dailyFritz/dailyFritzTranscript.test.ts


 RUN  v4.1.10 /Users/olivermorid/racehorse-dominoes/client


 Test Files  11 passed (11)
      Tests  90 passed (90)
   Start at  10:22:10
   Duration  3.23s (transform 1.20s, setup 1.39s, import 1.21s, tests 211ms, environment 13.68s)
```

### Skipped tests

- `0` skipped tests in the audited suites.
- Grep for `it.skip`, `test.skip`, `describe.skip`, `xit`, `xdescribe` in `server/src/http/routes/dailyFritz*.test.ts` and `client/src/dailyFritz/*.test.ts` returned no matches.

## 2) `main...feat/daily-fritz-platform-phase1` ground truth

### Raw changed-file diff

```text
A	.worktrees/ci-green
A	.worktrees/df-verifier-divergence
A	.worktrees/fritz-challenge-multi
A	.worktrees/mp-chesscom
A	client/e2e/mobile-390-hub-containment.spec.ts
A	client/e2e/screenshots/mobile-390/chromium-mobile-bot-match-ingame.png
A	client/e2e/screenshots/mobile-390/chromium-mobile-daily-fritz-ingame.png
A	client/e2e/screenshots/mobile-390/chromium-mobile-daily-fritz.png
A	client/e2e/screenshots/mobile-390/chromium-mobile-home.png
A	client/e2e/screenshots/mobile-390/chromium-mobile-multiplayer.png
A	client/e2e/screenshots/mobile-390/chromium-mobile-play-vs-fritz.png
A	client/e2e/screenshots/mobile-390/chromium-mobile-private-mp-ingame.png
A	client/e2e/screenshots/mobile-390/chromium-mobile-social.png
A	client/e2e/screenshots/mobile-390/chromium-mobile-solo-hub.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-bot-match-ingame.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-daily-fritz-ingame.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-daily-fritz.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-home.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-multiplayer.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-play-vs-fritz.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-private-mp-ingame.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-social.png
A	client/e2e/screenshots/mobile-390/webkit-mobile-solo-hub.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-daily-fritz.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-daily-puzzle.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-home.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-multiplayer.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-social.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-solo.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-daily-fritz.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-daily-puzzle.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-home.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-multiplayer.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-social.png
A	client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-solo.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-daily-fritz.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-daily-puzzle.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-home.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-multiplayer.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-social.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-solo.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-daily-fritz.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-daily-puzzle.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-home.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-multiplayer.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-social.png
A	client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-solo.png
M	client/playwright.config.ts
M	client/src/auth/useAuth.ts
A	client/src/components/GlobalNav.authPlaceholder.test.tsx
M	client/src/components/GlobalNav.tsx
M	client/src/dailyFritz/api.ts
M	client/src/dailyFritz/dailyFritz.css
A	client/src/dailyFritz/dailyFritzMutations.ts
A	client/src/dailyFritz/dailyFritzObservability.ts
A	client/src/dailyFritz/dailyFritzRequestIds.ts
M	client/src/dailyFritz/dailyFritzScreenTypes.ts
M	client/src/dailyFritz/useDailyFritzRunController.ts
M	client/src/matchmaking/matchmakingScreen.css
M	client/src/modules/daily/useDailyFritzCompletion.ts
M	client/src/modules/daily/useDailyFritzSessionPersistence.ts
M	client/src/screens/HomeScreen.tsx
M	client/src/screens/RacehorseHomeArt.css
M	client/src/screens/SinglePlayerHubScreen.tsx
M	client/src/screens/SinglePlayerModes.css
M	client/src/styles/_pvf-layout.css
M	client/src/styles/rh-mobile-chrome.css
M	client/src/utils/sound.ts
M	client/tailwind.config.js
A	docs/superpowers/plans/2026-08-18-daily-fritz-chesscom-platform.md
A	dump.rdb
M	server/src/http/routes/dailyFritzCheckpointRoute.ts
A	server/src/http/routes/dailyFritzClientPhase.test.ts
A	server/src/http/routes/dailyFritzClientPhase.ts
M	server/src/http/routes/dailyFritzMetrics.ts
A	server/src/http/routes/dailyFritzMetricsExport.ts
A	server/src/http/routes/dailyFritzRecordGameAdvance.test.ts
M	server/src/http/routes/dailyFritzStartRoute.ts
M	server/src/http/routes/dailyFritzTodayRoute.ts
A	server/tsconfig.tsbuildinfo
```

### File existence / compile / wiring check (all changed files)

Method:
- `exists`: filesystem check.
- `compile_status`: `npm run build --prefix client` and `npm run build --prefix server` both succeeded; code files marked as included.
- `reference_hits_by_stem`: `rg` hits for module stem in other files (rough wiring signal, not semantic proof).

```text
path	exists	kind	compile_status	reference_hits_by_stem
.worktrees/ci-green	yes	asset_or_other	n/a	-
.worktrees/df-verifier-divergence	yes	asset_or_other	n/a	-
.worktrees/fritz-challenge-multi	yes	asset_or_other	n/a	-
.worktrees/mp-chesscom	yes	asset_or_other	n/a	-
client/e2e/mobile-390-hub-containment.spec.ts	yes	code	included_in_successful_builds	0
client/e2e/screenshots/mobile-390/chromium-mobile-bot-match-ingame.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/chromium-mobile-daily-fritz-ingame.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/chromium-mobile-daily-fritz.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/chromium-mobile-home.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/chromium-mobile-multiplayer.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/chromium-mobile-play-vs-fritz.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/chromium-mobile-private-mp-ingame.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/chromium-mobile-social.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/chromium-mobile-solo-hub.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-bot-match-ingame.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-daily-fritz-ingame.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-daily-fritz.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-home.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-multiplayer.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-play-vs-fritz.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-private-mp-ingame.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-social.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-390/webkit-mobile-solo-hub.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-daily-fritz.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-daily-puzzle.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-home.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-multiplayer.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-social.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-landscape-solo.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-daily-fritz.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-daily-puzzle.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-home.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-multiplayer.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-social.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/chromium-mobile-portrait-solo.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-daily-fritz.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-daily-puzzle.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-home.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-multiplayer.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-social.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-landscape-solo.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-daily-fritz.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-daily-puzzle.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-home.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-multiplayer.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-social.png	yes	asset_or_other	n/a	-
client/e2e/screenshots/mobile-hub-containment/webkit-mobile-portrait-solo.png	yes	asset_or_other	n/a	-
client/playwright.config.ts	yes	code	included_in_successful_builds	2
client/src/auth/useAuth.ts	yes	code	included_in_successful_builds	108
client/src/components/GlobalNav.authPlaceholder.test.tsx	yes	code	included_in_successful_builds	0
client/src/components/GlobalNav.tsx	yes	code	included_in_successful_builds	109
client/src/dailyFritz/api.ts	yes	code	included_in_successful_builds	923
client/src/dailyFritz/dailyFritz.css	yes	code	included_in_successful_builds	1579
client/src/dailyFritz/dailyFritzMutations.ts	yes	code	included_in_successful_builds	4
client/src/dailyFritz/dailyFritzObservability.ts	yes	code	included_in_successful_builds	3
client/src/dailyFritz/dailyFritzRequestIds.ts	yes	code	included_in_successful_builds	4
client/src/dailyFritz/dailyFritzScreenTypes.ts	yes	code	included_in_successful_builds	11
client/src/dailyFritz/useDailyFritzRunController.ts	yes	code	included_in_successful_builds	35
client/src/matchmaking/matchmakingScreen.css	yes	code	included_in_successful_builds	12
client/src/modules/daily/useDailyFritzCompletion.ts	yes	code	included_in_successful_builds	7
client/src/modules/daily/useDailyFritzSessionPersistence.ts	yes	code	included_in_successful_builds	19
client/src/screens/HomeScreen.tsx	yes	code	included_in_successful_builds	55
client/src/screens/RacehorseHomeArt.css	yes	code	included_in_successful_builds	32
client/src/screens/SinglePlayerHubScreen.tsx	yes	code	included_in_successful_builds	30
client/src/screens/SinglePlayerModes.css	yes	code	included_in_successful_builds	11
client/src/styles/_pvf-layout.css	yes	code	included_in_successful_builds	28
client/src/styles/rh-mobile-chrome.css	yes	code	included_in_successful_builds	3
client/src/utils/sound.ts	yes	code	included_in_successful_builds	127
client/tailwind.config.js	yes	code	included_in_successful_builds	1
docs/superpowers/plans/2026-08-18-daily-fritz-chesscom-platform.md	yes	asset_or_other	n/a	-
dump.rdb	yes	asset_or_other	n/a	-
server/src/http/routes/dailyFritzCheckpointRoute.ts	yes	code	included_in_successful_builds	3
server/src/http/routes/dailyFritzClientPhase.test.ts	yes	code	included_in_successful_builds	1
server/src/http/routes/dailyFritzClientPhase.ts	yes	code	included_in_successful_builds	4
server/src/http/routes/dailyFritzMetrics.ts	yes	code	included_in_successful_builds	12
server/src/http/routes/dailyFritzMetricsExport.ts	yes	code	included_in_successful_builds	2
server/src/http/routes/dailyFritzRecordGameAdvance.test.ts	yes	code	included_in_successful_builds	1
server/src/http/routes/dailyFritzStartRoute.ts	yes	code	included_in_successful_builds	4
server/src/http/routes/dailyFritzTodayRoute.ts	yes	code	included_in_successful_builds	3
server/tsconfig.tsbuildinfo	yes	asset_or_other	n/a	-
```

### Created-but-not-wired flags

- `client/e2e/mobile-390-hub-containment.spec.ts` has `reference_hits_by_stem=0` (not imported/called in runtime app path; test asset only).
- `client/src/components/GlobalNav.authPlaceholder.test.tsx` has `reference_hits_by_stem=0` (test-only file).
- Most `client/e2e/screenshots/**` and `dump.rdb` are assets/data and are not in runtime import paths.
- New Daily Fritz runtime files from PR 16 are wired:
  - `client/src/dailyFritz/dailyFritzMutations.ts` imported by `client/src/dailyFritz/api.ts`.
  - `client/src/dailyFritz/dailyFritzObservability.ts` imported by `client/src/dailyFritz/useDailyFritzRunController.ts` and `client/src/modules/daily/useDailyFritzSessionPersistence.ts`.
  - `client/src/dailyFritz/dailyFritzRequestIds.ts` imported by `client/src/dailyFritz/api.ts` and `client/src/dailyFritz/dailyFritzMutations.ts`.
  - `server/src/http/routes/dailyFritzClientPhase.ts` imported by both `server/src/http/routes/dailyFritzStartRoute.ts` and `server/src/http/routes/dailyFritzTodayRoute.ts`.
  - `server/src/http/routes/dailyFritzMetricsExport.ts` dynamically imported from `server/src/http/routes/dailyFritzMetrics.ts`.

## 3) Distinct write paths for Daily Fritz results/checkpoints

### A) JSONB upsert / direct table persistence

- `server/src/http/stores/dailyFritzStore.ts:591` — `upsertDailyFritzAttempt(...)` persists attempt row to `/rest/v1/daily_fritz_attempts?on_conflict=id` with `POST` merge.
- `server/src/http/stores/dailyFritzStore.ts:610` — `createDailyFritzAttempt(...)` inserts new attempt row to `/rest/v1/daily_fritz_attempts`.
- `server/src/http/stores/dailyFritzStore.ts:488` — `upsertDailyFritzRun(...)` persists daily run to `/rest/v1/daily_fritz_runs?on_conflict=run_date`.

### B) Transactional RPC command path (authoritative commit path)

- `server/src/http/stores/dailyFritzCommandStore.ts:66` — `startDailyFritzAttemptCommand(...)` calls `/rest/v1/rpc/start_daily_fritz_attempt_command`.
- `server/src/http/stores/dailyFritzCommandStore.ts:116` — `commitDailyFritzAttemptCommand(...)` calls `/rest/v1/rpc/commit_daily_fritz_attempt_command`.
- Route callsites:
  - `server/src/http/routes/dailyFritzStartRoute.ts:203` — start attempt transactional command.
  - `server/src/http/routes/dailyFritzRecordGameRoute.ts:360` — record game transactional command.
  - `server/src/http/routes/dailyFritzCompletionRoutes.ts:171` — complete attempt transactional command.
  - `server/src/http/routes/dailyFritzCompletionRoutes.ts:312` — abandon attempt transactional command.

### C) Legacy/non-transactional score/result persistence path

- `server/src/http/routes/dailyFritzRecordGameRoute.ts:407` — falls back to `upsertDailyFritzAttempt(attempt)` when transactional command is off.
- Legacy score-only acceptance path (when transcript fails but scores are provided):
  - `server/src/http/routes/dailyFritzRecordGameRoute.ts:68`
  - `server/src/http/routes/dailyFritzRecordGameRoute.ts:72`
  - `server/src/http/routes/dailyFritzRecordGameRoute.ts:276`
  - `server/src/http/routes/dailyFritzRecordGameRoute.ts:279`

### D) Checkpoint write paths (server + client)

- Client local checkpoint write:
  - `client/src/modules/daily/dailyFritzSessionStorage.ts:333` — `window.localStorage.setItem(storageKey, JSON.stringify(snapshot))`.
  - `client/src/modules/daily/useDailyFritzSessionPersistence.ts:231` — `persistDailyFritzSnapshot(storageKey, snapshot)`.
  - `client/src/modules/daily/useDailyFritzSessionPersistence.ts:221` — final hand-transition/game-over snapshot persisted.
- Client -> server checkpoint write:
  - `client/src/modules/daily/useDailyFritzSessionPersistence.ts:74` — `saveDailyFritzCheckpoint(...)`.
  - `client/src/dailyFritz/api.ts:493` — `saveDailyFritzCheckpoint(...)` POST `/api/daily-fritz/checkpoint`.
- Server checkpoint persistence into attempt result JSON:
  - `server/src/http/routes/dailyFritzCheckpointRoute.ts:71` — `attempt.result = writeDailyFritzActiveCheckpoint(...)`.
  - `server/src/http/routes/dailyFritzCheckpointRoute.ts:72` — `upsertDailyFritzAttempt(attempt)`.
  - `server/src/http/routes/dailyFritzCheckpointPolicy.ts:92` — writes `active_checkpoint` field into result.

### E) Hand/game receipt writes (duplication inside result payload)

- `server/src/http/routes/dailyFritzRecordGameRoute.ts:298` — `writeVerifiedHand(...)`.
- `server/src/http/routes/dailyFritzRecordGameRoute.ts:270` — `writeUnverifiedDailyFritzHand(...)`.
- `server/src/http/routes/dailyFritzRecordGameRoute.ts:333` — `writeVerifiedGame(...)`.
- `server/src/http/routes/dailyFritzRecordGameRoute.ts:305` — `writeActiveGameProgress(...)`.
- `server/src/http/routes/dailyFritzNextHandRoute.ts:355` — `writeVerifiedHand(...)`.
- `server/src/http/routes/dailyFritzNextHandRoute.ts:368` — `writeUnverifiedDailyFritzHand(...)`.
- `server/src/http/routes/dailyFritzNextHandRoute.ts:216` and `:413` — `writeActiveGameProgress(...)`.

## 4) Read/reconstruct paths on resume and precedence

### A) Local storage and server checkpoint reads

- `client/src/modules/daily/dailyFritzSessionStorage.ts:266` — local checkpoint read (`window.localStorage.getItem(storageKey)`).
- `client/src/modules/daily/dailyFritzSessionStorage.ts:231` — server checkpoint source (`dailyFritzPackage.resume_checkpoint`).
- `client/src/modules/daily/dailyFritzSessionStorage.ts:219` — local load path invoked.
- `client/src/modules/daily/dailyFritzSessionStorage.ts:234` — server checkpoint parsed into snapshot.
- `client/src/modules/daily/dailyFritzSessionStorage.ts:236` — server checkpoint reconciled against authority cursor.
- `client/src/modules/daily/dailyFritzSessionStorage.ts:290` — local checkpoint reconciled against authority cursor.
- `client/src/modules/match/hooks/useBotMatchBootstrap.ts:67` — boot path calls `loadDailyFritzResumeSnapshot(...)`.

### B) Server-side checkpoint read for response shaping

- `server/src/http/routes/dailyFritzStartRoute.ts:334` — `/start` reads checkpoint via `resolveDailyFritzResumeCheckpoint(attempt, runFingerprint)`.
- `server/src/http/routes/dailyFritzStartRoute.ts:375` — `/start` includes `resume_checkpoint` in payload when valid.
- `server/src/http/routes/dailyFritzTodayRoute.ts:197` — `/today` reads active checkpoint.
- `server/src/http/routes/dailyFritzTodayRoute.ts:198` — `/today` only considers resume checkpoint true when cursor/revision match.
- `server/src/http/routes/dailyFritzCheckpointPolicy.ts:201` — server resume checkpoint resolver.

### C) Move-log reconstruction / transcript reconstruction

- `client/src/modules/daily/useDailyFritzSessionPersistence.ts:189` — checkpoint transcript built from current move log via `buildDailyFritzTranscript(...)`.
- `client/src/dailyFritz/useDailyFritzRunController.ts:365` — transcript rebuilt before `recordDailyFritzGame(...)`.
- `client/src/dailyFritz/dailyFritzTranscript.ts:76` — canonical transcript builder implementation.
- `client/src/dailyFritz/dailyFritzMoveEvidence.ts:83` — resumed evidence ordered by `moveNumber`.

### D) If sources disagree, which one wins?

Ground truth precedence in `loadDailyFritzResumeSnapshot(...)`:

- `client/src/modules/daily/dailyFritzSessionStorage.ts:241` — if both local and server snapshots are valid and authority-aligned, winner is `checkpointRevision` max:
  - `local.checkpointRevision >= server.checkpointRevision` => local wins.
  - else server wins and is persisted locally (`:242`).
- If local fails reconciliation, local is removed (`:308`) and server/none wins.
- If server fails reconciliation, server is ignored (`:237`) and local/none wins.
- `/today` does not return checkpoint payload; it only emits `next_action` gating (`server/src/http/routes/dailyFritzTodayRoute.ts:204`).
- `/start` is the authoritative resume payload endpoint (`server/src/http/routes/dailyFritzStartRoute.ts:342`).

## 5) PR #16 claim-by-claim verification

PR body used for comparison is copied below verbatim:

```json
{"body":"## Summary\n- **Unified mutation client** — shared timeout/error taxonomy in `dailyFritzMutations.ts`; all record-game/complete/checkpoint POSTs use consistent abort + failure classification.\n- **Observability** — Sentry alerts for saving timeout, record-game failure, cursor divergence, and transcript build failure; server mirrors high-signal metrics to durable events.\n- **Checkpoint safety** — checkpoint route wrapped in `withDailyFritzAttemptLock` to prevent torn writes.\n- **Server phase hints** — `/start` and `/today` now return `next_action` (`resume_hand`, `between_games`, `finalize_set`, etc.) for Phase 2 overlay collapse.\n- **Journal on completion** — game completion payload includes `officialJournal` for verification evidence.\n- **Advance-first contract test** — record-game accepts legacy scores when transcript verification fails (never strand on Saving…).\n\n## Test plan\n- [x] `dailyFritzClientPhase.test.ts` (5 tests)\n- [x] `dailyFritzRecordGameAdvance.test.ts` (advance-first legacy scores)\n- [x] `dailyFritzCheckpoint.test.ts` (5 tests)\n- [x] Client + server builds pass\n- [ ] Manual: complete a Daily Fritz game end-to-end; confirm Saving overlay clears within 15s\n- [ ] Manual: hard refresh mid-hand; confirm server checkpoint resume works\n\n## Follow-ups (Phase 2)\n- Wire client overlays to `next_action` from start/today\n- Single resume loader + authority cursor merge\n\n\nMade with [Cursor](https://cursor.com)","files":[{"path":"client/src/dailyFritz/api.ts","additions":40,"deletions":63},{"path":"client/src/dailyFritz/dailyFritzMutations.ts","additions":88,"deletions":0},{"path":"client/src/dailyFritz/dailyFritzObservability.ts","additions":23,"deletions":0},{"path":"client/src/dailyFritz/dailyFritzRequestIds.ts","additions":8,"deletions":0},{"path":"client/src/dailyFritz/dailyFritzScreenTypes.ts","additions":2,"deletions":0},{"path":"client/src/dailyFritz/useDailyFritzRunController.ts","additions":32,"deletions":0},{"path":"client/src/modules/daily/useDailyFritzCompletion.ts","additions":2,"deletions":0},{"path":"client/src/modules/daily/useDailyFritzSessionPersistence.ts","additions":12,"deletions":0},{"path":"client/src/utils/sound.ts","additions":1,"deletions":1},{"path":"server/src/http/routes/dailyFritzCheckpointRoute.ts","additions":60,"deletions":64},{"path":"server/src/http/routes/dailyFritzClientPhase.test.ts","additions":75,"deletions":0},{"path":"server/src/http/routes/dailyFritzClientPhase.ts","additions":35,"deletions":0},{"path":"server/src/http/routes/dailyFritzMetrics.ts","additions":5,"deletions":0},{"path":"server/src/http/routes/dailyFritzMetricsExport.ts","additions":26,"deletions":0},{"path":"server/src/http/routes/dailyFritzRecordGameAdvance.test.ts","additions":216,"deletions":0},{"path":"server/src/http/routes/dailyFritzStartRoute.ts","additions":9,"deletions":0},{"path":"server/src/http/routes/dailyFritzTodayRoute.ts","additions":17,"deletions":0}]}
```

Verification status:

- **Unified mutation client**: **Verified true**  
  Evidence: `client/src/dailyFritz/api.ts:31`, `client/src/dailyFritz/api.ts:44` import `dailyFritzMutations`.

- **Observability**: **Partially verified true**  
  - Client alerts present: `client/src/dailyFritz/useDailyFritzRunController.ts:31`, `client/src/modules/daily/useDailyFritzSessionPersistence.ts:15`.
  - Server metric mirror hook present: `server/src/http/routes/dailyFritzMetrics.ts:41` dynamic import of `dailyFritzMetricsExport`.
  - Whether every named alert path fires correctly at runtime is **not fully verified** by this static audit.

- **Checkpoint safety lock**: **Verified true**  
  Evidence: `server/src/http/routes/dailyFritzCheckpointRoute.ts:35` wraps route logic in `withDailyFritzAttemptLock`.

- **`next_action` from `/start` and `/today`**: **Verified true**  
  Evidence: `server/src/http/routes/dailyFritzStartRoute.ts:335` + `:362`; `server/src/http/routes/dailyFritzTodayRoute.ts:204` + `:223`.

- **Journal on completion**: **Partially verified / wording ambiguous**  
  - `officialJournal` included in game-complete callback payload: `client/src/modules/daily/useDailyFritzCompletion.ts:110`.
  - `completeDailyFritz(...)` HTTP payload does **not** include an `officialJournal` field directly: `client/src/dailyFritz/api.ts:795-807`.

- **Advance-first legacy score fallback test**: **Verified true**  
  Evidence: test file exists and passed in suite (`server/src/http/routes/dailyFritzRecordGameAdvance.test.ts`), plus route has fallback logic (`server/src/http/routes/dailyFritzRecordGameRoute.ts:68-73`, `:256-280`).

- **Test plan checkboxes**:
  - `dailyFritzClientPhase.test.ts`: **Verified file exists** and daily-fritz route suite passed.
  - `dailyFritzRecordGameAdvance.test.ts`: **Verified file exists** and suite passed.
  - `dailyFritzCheckpoint.test.ts`: **Verified file exists** and suite passed.
  - “Client + server builds pass”: **Verified in this audit run**.
  - Two manual items: **Not verifiable from static/automated run**.
