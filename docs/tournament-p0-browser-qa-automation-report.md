# Tournament P0 Browser QA Automation Report

Date: 2026-06-03

## What Was Automated

- Environment preflight for client, server, Supabase env, QA user, and tournament tables
- QA auth bootstrap via saved storage state or normal UI sign-in
- Seed invocation for `waiting_room`, `bracket_lock`, and `assigned_qf`
- Browser verification for TQ-01, TQ-02, TQ-03, TQ-04, TQ-05, TQ-06, TQ-07, TQ-19, TQ-20, TQ-21, TQ-25, and TQ-27
- Screenshot capture for pass/fail states under `docs/qa-artifacts/tournament-p0/`
- Results doc generation for `docs/tournament-p0-browser-qa-results.md`

## Automation Status

- Passed: none
- Failed: none
- Blocked: TQ-01, TQ-02, TQ-03, TQ-04, TQ-05, TQ-06, TQ-07, TQ-19, TQ-20, TQ-21, TQ-25, TQ-27

- TQ-01: Blocked (waiting_room)
- TQ-02: Blocked (waiting_room)
- TQ-03: Blocked (waiting_room)
- TQ-04: Blocked (bracket_lock)
- TQ-05: Blocked (bracket_lock)
- TQ-06: Blocked (assigned_qf)
- TQ-07: Blocked (assigned_qf)
- TQ-19: Blocked (waiting_room)
- TQ-20: Blocked (bracket_lock)
- TQ-21: Blocked (assigned_qf)
- TQ-25: Blocked (assigned_qf)
- TQ-27: Blocked (assigned_qf)

## Exact Rerun Commands

From the repo root:

```bash
npm test --prefix server -- qaSeed
npm test --prefix server -- tournament scheduledTournament registerRoomSessionHandlers.tournament tournamentCompletion tournamentExit
npm run build --prefix server
npm run build --prefix client
TOURNAMENT_QA_APP_URL=http://127.0.0.1:5173 npm run qa:tournament:p0 --prefix client
```

If the runner falls through to a different reachable local frontend, rerun the exact URL used by this pass:

```bash
TOURNAMENT_QA_APP_URL=http://127.0.0.1:4175 npm run qa:tournament:p0 --prefix client
```

## Artifacts

- No screenshots were captured in this run.

## Key Answers

- assigned_qf reached live match: no
- live room repair worked from DB-seeded assigned_qf: not proven
- registered-count mismatch is a real bug: not reproduced in this run
- auth source used: unknown

## Findings

- No extra findings beyond the scenario table.

## Limitations

- Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA.

## Recommended Next Patch Only If Confirmed P0 Exists

No confirmed P0 patch is recommended from this automation pass.
