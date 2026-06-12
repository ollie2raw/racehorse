# Tournament P0 Browser QA Results

Date: 2026-06-03  
Scope: hands-off Playwright-backed Tournament P0 QA for the currently supported harness states.

## Environment Used

- Local client target: `http://127.0.0.1:4175`
- Local server target: `http://127.0.0.1:3001`
- Browser automation: Playwright `chrome` headless
- QA auth source: unknown
- QA user id: `6a1a9ebf-dc9a-4d6f-b58f-9627a36c9c05`
- QA username target: `tournament_qa`
- Hosted Supabase allowed: yes
- Seeded states available: waiting_room, bracket_lock, assigned_qf, live_qf, near_30_qf, overlay_qf_win (harness not executed without auth)
- Automation artifacts dir: `docs/qa-artifacts/tournament-p0/`

## Browser QA Results Table

| ID | Status | Browser / Environment | Exact Seed State Used | Notes | Evidence | Severity if failed | Suspected files | Recommended next action |
|---|---|---|---|---|---|---|---|---|
| TQ-01 | Blocked | chrome via Playwright | waiting_room | Automation was blocked before waiting_room could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | Partial only: signed-in waiting-room path. | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-02 | Blocked | chrome via Playwright | waiting_room | Automation was blocked before waiting_room could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-03 | Blocked | chrome via Playwright | waiting_room | Automation was blocked before waiting_room could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-04 | Blocked | chrome via Playwright | bracket_lock | Automation was blocked before bracket_lock could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-05 | Blocked | chrome via Playwright | bracket_lock | Automation was blocked before bracket_lock could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-06 | Blocked | chrome via Playwright | assigned_qf | Automation was blocked before assigned_qf could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-07 | Blocked | chrome via Playwright | live_qf | Blocked on QA auth; HUD target-30 check runs via live_qf (and assigned_qf attach path). | - | - | - | Unblock auth and rerun qa:tournament:p0. |
| TQ-08 | Blocked | chrome via Playwright | live_qf | Harness can reach live_qf once auth exists; draw animation is not auto-forced (expected Not Run at runtime). | - | - | - | Add forced-draw fixture or keep manual. |
| TQ-09 | Blocked | chrome via Playwright | live_qf | Blocked on QA auth; live_qf rack sanity check is implemented in harness. | - | - | - | Unblock auth and rerun qa:tournament:p0. |
| TQ-10 | Blocked | chrome via Playwright | overlay_qf_win | Blocked on QA auth; overlay_qf_win fixture is implemented. | - | - | - | Unblock auth and rerun qa:tournament:p0. |
| TQ-11 | Blocked | chrome via Playwright | overlay_qf_win | Blocked on QA auth; overlay persistence check is implemented. | - | - | - | Unblock auth and rerun qa:tournament:p0. |
| TQ-12 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |
| TQ-13 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |
| TQ-14 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |
| TQ-15 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |
| TQ-16 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |
| TQ-17 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |
| TQ-18 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |
| TQ-19 | Blocked | chrome via Playwright | waiting_room | Automation was blocked before waiting_room could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-20 | Blocked | chrome via Playwright | bracket_lock | Automation was blocked before bracket_lock could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-21 | Blocked | chrome via Playwright | assigned_qf | Automation was blocked before assigned_qf could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-22 | Blocked | chrome via Playwright | live_qf | Blocked on QA auth; live reload check is implemented. | - | - | - | Unblock auth and rerun qa:tournament:p0. |
| TQ-23 | Blocked | chrome via Playwright | overlay_qf_win | Blocked on QA auth; reload-during-overlay check is implemented. | - | - | - | Unblock auth and rerun qa:tournament:p0. |
| TQ-24 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |
| TQ-25 | Blocked | chrome via Playwright | assigned_qf | Automation was blocked before assigned_qf could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-26 | Blocked | chrome via Playwright | live_qf | Blocked on QA auth; live disconnect check is implemented. | - | - | - | Unblock auth and rerun qa:tournament:p0. |
| TQ-27 | Blocked | chrome via Playwright | assigned_qf | Automation was blocked before assigned_qf could run. Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA. | - | - | - | Fix the environment blocker, then rerun the hands-off Tournament P0 QA command. |
| TQ-28 | Blocked | chrome via Playwright | near_30_qf | Blocked on QA auth; near-terminal HUD check is implemented. | - | - | - | Unblock auth and rerun qa:tournament:p0. |
| TQ-29 | Not Run | chrome via Playwright | n/a | Current harness pass does not cover this scenario yet. | - | - | - | Requires a later harness state such as live_qf or near_30_qf. |

## P0 Failure Summary

No confirmed P0 failure was reproduced in this automated pass.

## P1 / P2 Findings

No new P1/P2 issue was confirmed in this automated pass.

## Execution Limitations

- Provide QA_TOURNAMENT_EMAIL and QA_TOURNAMENT_PASSWORD, or create /Users/olivermorid/racehorse-dominoes/client/.auth/tournament-qa.json once, before running hands-off Tournament P0 QA.
- Trust UX pass (2026-06-03): `npm run qa:tournament:seed --prefix server -- --state waiting_room` succeeded with existing `server/.env`; Playwright harness still blocked on missing auth file / credentials.

## Verdict

Tournament P0 browser pass incomplete: blocked by QA auth (seed CLI OK)
