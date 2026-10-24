# Production test accounts and live moderation check

Two disposable, owner-controlled production accounts used to prove report and
block work in production (Guideline 1.2) before App Review. Run after the
moderation migrations and code are live in production
([`../moderation-rollout/README.md`](../moderation-rollout/README.md)).

## Accounts

| | Suggested handle | Email | Notes |
|---|---|---|---|
| A | `racehorse_test_a` | `<owner-controlled address A>` | Reporter / blocker |
| B | `racehorse_test_b` | `<owner-controlled address B>` | Reported / blocked |

- Check the handles are free first (signup shows "taken"; pick
  `racehorse_qa_a` / `_b` or similar if so). Handles must pass the username
  policy.
- Emails must be inboxes the owner controls (plus-addressing on the owner's
  mailbox is fine if the provider supports it). Never a reviewer's or a
  stranger's address.
- Passwords: owner's password manager only. Never in the repo, chat or docs.
- These are **not** the App Review demo account unless the owner deliberately
  chooses one of them (then it must not be blocked or reported at submission).
- Use two devices (e.g. the two device-matrix iPhones), or one iPhone + the
  website in a private window.

## Live moderation checklist

Do the steps in order. Report categories are fixed
(`client/src/moderation/moderationTypes.ts`): Inappropriate username,
Harassment / abusive behavior, Cheating, Other.

| # | Check | How | Expected | Result (PASS/FAIL, notes) |
|---|---|---|---|---|
| 1 | A reports B | A → B's profile (`/players/racehorse_test_b`) → Report | Report submits; confirmation shown | |
| 2 | Fixed categories | Same dialog | Exactly the four categories above | |
| 3 | No free text | Same dialog | No text field anywhere in the report flow | |
| 4 | A blocks B | B's profile → Block → confirm (first make A and B friends, and have a pending invite path ready for 6–7) | Block confirmed | |
| 5 | Friendship / request removed | Both accounts → Friends | B no longer in A's friends (and vice versa); any pending request gone | |
| 6 | New friend request refused | B sends A a friend request | Refused: "You can't send a friend request to this player." | |
| 7 | Invite not delivered | B invites A to a game (if B can still target A) | A receives nothing; B sees the same answer as for an offline friend | |
| 8 | Quick Match doesn't pair | A and B join Quick Match at the same time (no one else searching) | They are never paired | |
| 9 | B can't take a new seat in A's private room | A creates a private room; B enters the code | "Room not found." | |
| 10 | A's seated reconnect still works | A in a private room match with a third account or set up before the block; A toggles airplane mode 10 s | A reclaims the seat and the game continues | |
| 11 | B hidden from A's activity feed | B finishes a game; A opens Social | B's activity doesn't appear for A | |
| 12 | Unblock restores | A → B's profile → Unblock; repeat 6 and 8 | Friend request allowed; Quick Match can pair | |
| 13 | Profile controls | Any profile that isn't your own | Block and Report visible; absent on your own profile | |
| 14 | In-match Report | During a live match, the in-match reactions/menu → Report opponent | Same four categories, no text, submits | |

Run date: ______  Build / web release: ______  Tester: ______

Afterwards, the owner can confirm the reports landed (Supabase table
`user_reports`, read-only query in the SQL editor) and should then mark or
delete those test rows per the moderation runbook.

## Cleanup

1. A unblocks B if still blocked; remove friendships.
2. Delete each account in the app: **Settings → Delete account** → type the
   username → confirm. This deletes the auth user and cascades their data.
3. Confirm sign-in with each email now fails.
4. Delete the test report rows if they weren't removed by the cascade.
