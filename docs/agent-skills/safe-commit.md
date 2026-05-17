# Racehorse Safe Commit Skill

Use this before every commit or push.

## Goal

Prevent partial commits, missing files, broken builds, accidental unrelated changes, and deploy failures.

## Required checks

Run these commands:

git status --short
git diff --stat
npm run build --prefix server
npm run test --prefix server
npm run build --prefix client

## Review checklist

Before suggesting a commit, answer:

1. What exact feature/fix is this commit for?
2. Which files changed for that feature?
3. Are there untracked files required by imports?
4. Are there migrations that must be committed?
5. Are there unrelated files that should be excluded?
6. Could Vercel fail because a client import points to an uncommitted file?
7. Could Render fail because server build/tests fail?
8. What exact git add command should be used?
9. What commit message should be used?

## Rules

- Never suggest git add . unless the diff has been reviewed and every file is intentional.
- Always include newly created files if existing code imports them.
- Keep unrelated fixes in separate commits.
- If a migration is needed, mention whether it must be applied in Supabase.
- If builds/tests fail, do not recommend committing.
- If unsure whether a file belongs in the commit, call it out.

## Final response format

Safe Commit Review

Purpose:
...

Include:
...

Exclude:
...

Risks:
...

Commands:
git add ...
git commit -m "..."
