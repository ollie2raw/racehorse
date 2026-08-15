# Guest identity trust boundary

## Decision

Unauthenticated multiplayer users may provide a bounded identifier in the
`guest_` namespace. The server treats that value only as an unranked continuity
hint. It is not an account identity and cannot authorize profile, ranking,
friend, tournament, or authenticated persistence operations.

Accepted format:

```text
^guest_[A-Za-z0-9_-]{8,96}$
```

All account identity continues to come from a bearer token verified through
Supabase Auth. UUID-shaped claims and arbitrary non-UUID strings are discarded
for room joins and rejected by matchmaking.

## Blast radius

- Authenticated users are unchanged.
- Current clients and Playwright fixtures already generate `guest_` identities.
- Legacy unauthenticated clients that send arbitrary identifiers such as
  `player-1` lose identity continuity and must update to the current guest-ID
  contract.
- Guest continuity is still not cryptographic. A party that learns a guest ID
  may claim it. Guest play must therefore remain unranked and must never grant
  access to account-owned resources.

## Regression controls

- `server/src/platform/auth/guestIdentity.test.ts` enforces the accepted namespace.
- `server/src/platform/auth/authBoundaryGuardrails.test.ts` prevents the
  unverified synchronous JWT decoder from being promoted beyond rate-limit
  bucketing.
- Multiplayer state masking and spectator projection tests protect private game
  information independently of identity type.
