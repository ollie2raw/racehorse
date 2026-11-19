# RESUME (design/tile-board-exploration) - design exploration only, nothing wired to production

Branch: design/tile-board-exploration (from origin/main ebd5e0b9). Everything lives under design-lab/ plus this file. No app source touched.

## Done
- design-lab/analysis/colorLab.mjs + color-report.md + palettes.json: CVD sim (Machado) + dE2000 + WCAG
- design-lab/themes/{current,tiles,boards,hud-v2}.css: current-look port + variants (tiles A/B/C/SEL, boards A/B/C, HUD v2)
- design-lab/gallery/scene.html (query: tiles,board,hud,hand,state); design-lab/perf/shotScenes.mjs -> design-lab/png/ (42 PNGs, 3 viewports)
- design-lab/ref/: real-app captures (desktop+phone) with measured sizes

## Left
- gallery/index.html overview + details.html (boneyard/Fritz count/markers) + motion.html (deliverable 4)
- KEY.md (blind key), perf harness + runs (wait until no other agent's browser is running), THEME-PROPOSAL.md, MOTION-PROPOSAL.md, REPORT.md
- final: `gh run list --branch main --workflow CI --limit 2` for the report; push branch (never main), no PR

## Notes
- dist build of the app (for perf) is in the session scratchpad (vite build --outDir .../scratchpad/dist), served with client/scripts/perf/staticServer.mjs on port 5611.
- Shots: `NODE_PATH=<repo>/node_modules node design-lab/perf/shotScenes.mjs file://<worktree>/design-lab design-lab/png`
