# Racehorse Rules Skill

Use this whenever changing game logic, legal moves, scoring, forced draw, pass behavior, bots, multiplayer actions, tournament matches, Daily Fritz, Daily Puzzle, tutorials, or anything involving move validation.

## Goal

Protect the Racehorse dominoes ruleset across every mode.

Racehorse is not standard dominoes. Do not assume standard draw/pass rules.

## Core rules

1. There is no manual draw.
2. There is no manual pass.
3. Drawing only happens when forced.
4. Passing only happens when the player is blocked and the boneyard is locked/empty.
5. If it is your turn and you have a legal playable tile, you must play.
6. If it is your turn and you have no playable tile, you must draw until:
   - you get a playable tile, or
   - the boneyard is locked/empty.
7. If the boneyard is locked/empty and you still have no playable tile, you pass automatically.
8. Playing a scoring tile continues your turn.
9. Playing a double continues your turn.
10. If your turn continues and you have no playable tile, forced draw begins.
11. Opening a hand requires the first tile to be a double or scoring tile.
12. If the player has no valid opener, forced draw begins until a valid opener appears or the boneyard locks.
13. Last-tile scoring/double placements are legal.
14. If the last tile scores or is a double and drawable boneyard tiles exist, the player plays it, scores if applicable, then forced-draws and continues.
15. If the last tile scores or is a double and the boneyard is locked/empty, the hand can end.
16. Never hide a legal placement just because it scores or is a double.
17. Boneyard locked means the final 2 dead tiles are not drawable.

## Required audit questions

Before changing rules or related UI, answer:

1. Does this affect legal move generation?
2. Does this affect forced draw?
3. Does this affect pass behavior?
4. Does this affect opening move requirements?
5. Does this affect last-tile scoring/double behavior?
6. Does this affect both server engine and client bot engine?
7. Does this affect multiplayer/tournament server authority?
8. Does this affect Daily Fritz or Daily Puzzle local logic?
9. Does this require new invariant tests?
10. Does any lesson/copy need updating?

## Files to inspect

Server:
- server/src/game/engine.ts
- server/src/game/__tests__/racehorse-invariants.test.ts
- server/src/game/__tests__/engine.test.ts
- server/src/rooms.ts
- server/src/multiplayer/registerRoomSessionHandlers.ts

Client/local:
- client/src/bot/botEngine.ts
- client/src/App.tsx
- client/src/bot/BotMatchScreen.tsx
- client/src/dailyFritz/*
- client/src/dailyPuzzle/*
- client/src/learn/*

## Tests expected

When relevant, add or update tests for:

- no manual draw when playable tile exists
- no manual pass when playable tile exists
- forced draw when no playable tile exists
- forced draw stops when playable tile appears
- auto-pass only when blocked and boneyard locked
- opening move must be double or scoring
- opening forced draw until valid opener or locked boneyard
- scoring play continues turn
- double play continues turn
- last-tile scoring/double with drawable boneyard triggers forced draw
- last-tile scoring/double with locked boneyard ends hand
- legal move generation never hides scoring/double placements

## Rules for agents

- Do not introduce manual draw.
- Do not introduce manual pass.
- Do not block or hide scoring/double placements.
- Do not change server and client engines independently without checking parity.
- Do not assume standard dominoes rules.
- If unsure, stop and ask.
- Any rules change needs tests.

## Final report format

Racehorse Rules Review

What changed:
...

Rules affected:
...

Server/client parity:
...

Tests added/updated:
...

Risks:
...

Build/test result:
...
