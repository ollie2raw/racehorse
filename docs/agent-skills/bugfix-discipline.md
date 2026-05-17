# Racehorse Bugfix Discipline Skill

Use this for every bug fix before editing code.

## Goal

Fix the true root cause with the smallest safe change, add regression coverage, and avoid breaking unrelated Racehorse systems.

## Core rule

Do not patch symptoms. First prove the bug path.

## Required process

Before editing code, answer:

1. What is the exact user-visible bug?
2. What is the expected behavior?
3. What is the actual behavior?
4. Which mode(s) are affected?
5. Which mode(s) must not be affected?
6. What exact file/function is likely responsible?
7. What evidence proves the root cause?
8. Is this frontend, backend, DB state, socket state, or CSS/layout?
9. What is the smallest safe fix?
10. What regression test or manual check proves it?

## Investigation checklist

Check logs, state, and code before editing:

- Browser console
- Network requests
- Socket events
- Server logs
- Supabase rows if DB-backed
- localStorage/sessionStorage if recovery-related
- Current git diff
- Existing tests around the touched area

## Rules

- Do not broad rewrite.
- Do not mix unrelated fixes.
- Do not change game rules unless the bug is game rules.
- Do not change tournament lifecycle unless the bug is tournament lifecycle.
- Do not change global CSS unless the bug is global CSS.
- Do not use `git add .`.
- Do not claim fixed until build/tests pass.
- If a visual bug, require screenshot/manual verification.
- If a socket/recovery bug, test refresh/reconnect behavior.
- If a DB-backed bug, inspect actual DB state before guessing.
- If the fix touches shared code, list all affected modes.

## Regression protection

For every fix, decide whether to add:

- unit test
- integration test
- socket handler test
- DB/recovery test
- visual manual test checklist
- console/log assertion
- smoke script

If no automated test is added, explain why.

## Final report format

Bugfix Review

Bug:
...

Expected:
...

Actual:
...

Root cause:
...

Evidence:
...

Fix:
...

Files changed:
...

Modes affected:
...

Modes verified unaffected:
...

Tests added/updated:
...

Manual verification needed:
...

Build/test result:
...
