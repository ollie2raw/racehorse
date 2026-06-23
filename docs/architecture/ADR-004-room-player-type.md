# ADR-004: RoomPlayer Single Source of Truth

**Status:** Accepted  
**Date:** 2026-06

## Context
`RoomPlayer` type was defined in multiple files with slight variations, causing silent type mismatches between multiplayer state projections.

## Decision
`src/multiplayer/multiplayerRuntime.ts` is the single source of truth for:
- `RoomPlayer` type definition
- `normalizeRoomPlayers` function
- All room state normalization logic

## Consequences
- Import `RoomPlayer` from `multiplayerRuntime.ts` only — never redefine it
- `normalizeRoomPlayers` is tested in `multiplayerRuntime.test.ts`
