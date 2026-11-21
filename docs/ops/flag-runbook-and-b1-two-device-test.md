# Flags off by default: exact enable / rollback steps, and the B1 two-device test

Nothing here is switched on. **Status: written from the code, NOT yet run end to end on two devices** (the stub-latency trigger in section 2 is the least proven part: do steps 1-4 once on a laptop with two browser windows before using a phone).

## 1. The flags (all default OFF)

| Flag | Where | Enable | Check it is on | Roll back |
|---|---|---|---|---|
| **B1** `VITE_ENABLE_HAND_READY_RETRY` (client build flag, exactly `true`) | Vercel project env (Production), and the iOS build env | add `VITE_ENABLE_HAND_READY_RETRY=true`, then **redeploy** (it is read at build time); rebuild the iOS app | only behaviourally (the toast text ships either way): run the section 2 test against the deployed site | remove the variable, redeploy (iOS: rebuild) |
| **C1/C2** `REVIEW_YIELD_FIXES_ENABLED` (server, exactly `true`) | Render service env | set `true`, **restart** | `GET /health` after a game longer than 10 min with a queued review: `reviewYield.starvationSlices` rises AND a review job moves; log line `review decision held for live play` then evaluations | unset, restart |
| `RUM_RETENTION_ENABLED` (server, exactly `true`) | Render env | set `true` BEFORE ever turning `RUM_SUPABASE_APPEND_ENABLED` off | the daily delete runs (`rum_hourly retention` warnings absent; rows older than 12 months disappear) | unset |
| C3 (review pass stops on shutdown, #548) | no flag | merges as code | during a deploy the log shows no `review decision evaluated` after SIGTERM | revert the commit |

Order I would use: B1 only after section 2 passes; C1/C2 only on a quiet evening, watching `/health` `reviewYield`.

## 2. B1 two-device test (about 15 minutes)

**What it proves:** when the server refuses `hand:ready` (`uncertain` after a failed new-hand write), the client resends with backoff and the hand starts, instead of waiting for a reconnect.

**Setup (laptop = server; stub Supabase so the persistence can be made slow on purpose)**
1. In a checkout of main: `npm run build -w @racehorse/game-core && npm run build -w @racehorse/review-engine && npm run build --prefix server`.
2. Terminal A (stub): `node client/scripts/perf/supabaseStub.mjs 54399 0 /tmp/tl.jsonl`
3. Terminal B (server): `cd server && NODE_ENV=development PORT=3001 SUPABASE_URL=http://127.0.0.1:54399 SUPABASE_SERVICE_KEY=stub E2E_AUTH_SHIM=1 MP_PRIVATE_CERT_MODE=1 REVIEW_SWEEP_ENABLED=false node dist/index.js` (flag `MP_HAND_BOUNDARY_FAST` stays unset).
4. Build two clients pointing at the laptop's LAN IP (`<IP>`): `VITE_SERVER_URL=http://<IP>:3001 VITE_LEGAL_LEGAL_ENTITY_NAME=x VITE_LEGAL_SUPPORT_EMAIL=a@b.invalid VITE_LEGAL_MINIMUM_AGE=13 VITE_LEGAL_POLICY_EFFECTIVE_DATE=2026-01-01 VITE_LEGAL_POSTHOG_LOCATION=discarded npx vite build --outDir dist-off` and the same with `VITE_ENABLE_HAND_READY_RETRY=true --outDir dist-on`. Serve them: `node client/scripts/perf/staticServer.mjs dist-off 5601` and `... dist-on 5602`.
5. Devices: Device 1 = laptop Chrome, Device 2 = iPhone Safari (Develop menu, to run a console) or a second browser profile. On each, open `http://<IP>:5601` (flag OFF) and in the console set a distinct guest identity, then reload: Device 1 `localStorage.setItem('racehorse_guest_identity_v1','guest_a'); localStorage.setItem('racehorse_guest_display_name_v1','Guest 1111')`, Device 2 the same with `guest_b` / `Guest 2222`.
6. Device 1: Multiplayer, Private, Create lobby (note the code). Device 2: Private, Join lobby, enter the code. Device 1: Start Match. Play until a hand ends (a few tiles).

**The trigger (makes the next hand's write time out, like a slow database).** In Terminal C, started before the last tile: `tail -f /tmp/tl.jsonl | grep --line-buffered '"handOver":true' | head -1 && curl -s "http://127.0.0.1:54399/__lat?ms=20000"`. It fires when the hand-ending write has landed; the ready marks and the new-hand write then hang past the server's 15 s timeout, so the server answers `uncertain`. After 25 seconds restore: `curl -s "http://127.0.0.1:54399/__lat?ms=0"`.

**A. Flag OFF (`:5601`), expected = the bug.** After both players tap Continue (or the 5 s countdown) with latency 20000: both devices stay on the hand-over view. After restoring latency 0 the hand still does NOT start for at least 60 s. Toggling one device's Wi-Fi off/on (a new connection) starts it. Record: yes / no.

**B. Flag ON (`:5602`), repeat 5-6 and the trigger. Expected:** a toast "Still trying to start the next hand..." after the 3rd refusal (about 7 s), and within about 15 s of restoring latency 0 the new hand is dealt on BOTH devices with no reconnect. The server log shows several `hand:ready` calls, then one that starts the hand.

**C. Controls (flag ON).** (i) No fault injected: the next hand starts as usual, exactly one `hand:ready` per player (watch the server log). (ii) Latency left at 20000 for 3 minutes: the retries slow to every 15 s and keep failing; nothing else breaks (leave the room, rejoin works). (iii) Leave Room during the backoff: no error toast afterwards.

**Pass:** A fails to start (reproduces the bug), B starts without reconnect on both devices, C (i) shows one send per player. **Fail / stop and tell me:** B never starts after latency 0 (that would be the B3 case: a room left degraded by an earlier failed write; check the server log for `degraded` before the boundary), or the hand starts on one device only.

**Not covered by this test:** production Supabase failure shapes, iOS native shell (Capacitor) behaviour, a server restart during the retry.

## 3. Enable steps for B1 in production (only after section 2 passes)
1. Vercel -> Project -> Settings -> Environment Variables -> add `VITE_ENABLE_HAND_READY_RETRY` = `true` (Production only) -> Redeploy.
2. Play a private match with a friend on the deployed site; the default path must look unchanged (section 2 C(i)).
3. Rollback at any sign of trouble: delete the variable, redeploy (about 2 minutes). The iOS app needs a rebuild; until then it keeps the old behaviour only if it was built without the variable.
