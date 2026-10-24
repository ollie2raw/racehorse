# Visual proof

Baseline is a disposable `git archive` of
`0bb1b2203e94fbbe2feb382116898bff02c56c74`, served locally on port 5200.
Exploration is served on port 5199. Both use the same frontend-only fixture,
viewport (1440 × 900), and deterministic displayed state. No backend is required.
The fixture control strip is test tooling, not product UI.

- [Before: your turn](before-your-turn.png) / [After: your turn](after-your-turn.png)
- [Before: score](before-score.png) / [After: score](after-score.png)
- [Fritz thinking](after-fritz-thinking.png)
- [Selected tile](after-selected.png)
- [Placement](after-placement.png)
- [Draw](after-draw.png)
- [Hand end](after-hand-end.png)
- [Phone landscape selected tile](after-phone-selected.png)
- [Motion demo](after-demo.webm)

Screenshots show the stable result; the video and browser assertions cover motion.

To run the fixture and assertions from this worktree:

```sh
cd client
npx playwright test --config=playwright.game-feel.config.ts
```

The isolated config starts Vite on 5199 (or reuses it locally). Visit
`http://127.0.0.1:5199/e2e/harness/game-feel.html` for manual state controls.
The fixture mounts the real multiplayer screen and shared presentation components;
Fritz's actual turn label is separately mounted through the real solo flow.
The fixture cannot validate network recovery, production performance, or native haptics.
