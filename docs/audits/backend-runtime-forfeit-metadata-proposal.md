> Historical proposal, superseded by the implemented [disconnect-forfeit rating recovery remediation](disconnect-forfeit-rating-recovery.md). The continuation explicitly authorized creating and validating the migration locally; no production operation was performed.

# Deferred R1: preserve forfeit policy across rating recovery

This is a design proposal, not a migration. No SQL, production operation, historical reconciliation, or rating-policy change is authorized by this document.

## Reproduction and impact

`server/src/multiplayer/roomForfeit.ts` chooses `0.5` for disconnect timeout and `1.0` for manual forfeit, but sends the multiplier only to `processRealtimeMultiplayerGame`. Both persist `game_type=multiplayer` using the same ranked-game payload shape. `processRatingPeriod` and periodic catch-up cannot distinguish them. After the inline RPC fails or the process restarts, recovery applies scale 1. With the same profiles, scores and persisted `outcome=loss`, the local diagnostic `server/src/ranking/forfeitRecoveryMetadata.test.ts` measures exactly twice the intended inline delta.

The existing `outcome` field also ships behind `RANKED_GAMES_OUTCOME_COLUMN_ENABLED`. When that flag is OFF, a forfeiting player who led on points can receive a recovered win. Production flag state was not read; this is a conditional additional failure, not a claim that production currently has the flag OFF.

## Proposed persistence contract

- Store the authoritative multiplier and policy version on each ranked game at insertion, alongside its authoritative outcome and stable source-match key.
- Validate new multipliers against the existing accepted policy values; do not change their values or Glicko equations.
- Have inline and recovery paths read the same stored values, and keep the existing row-lock/profile-CAS/unique-period transaction.
- Confirm the existing outcome column is present before removing its write gate; do not set production environment values in this branch.
- Keep new metadata nullable for historical rows until an explicit legacy policy is chosen. Do not assume NULL means manual/full-weight: historical disconnects and manual forfeits are indistinguishable in the current ranked row.
- Determine whether old pending rows can be corroborated from durable, authoritative source records. If not, choose an operator-reviewed quarantine/disposition rather than fabricate policy or reapply already committed ratings.

A schema migration would be needed for the new metadata and possibly a rollout fence for older binaries. None has been created or applied. Index changes are independent of this correctness issue.

## Required validation before integration

Inline == recovery delta for manual forfeit, disconnect forfeit, ordinary match, and a forfeit while ahead. Test a lost RPC response, a restart between insertion and commit, one participant committed/one pending, overlapping catch-up/foreground callbacks, legacy ambiguous metadata, and outcome-write gate mismatch. Continue asserting one atomic rating period per ranked-game identity. Replace the current diagnostic mismatch assertion with an equality regression once the persistence contract is implemented.
