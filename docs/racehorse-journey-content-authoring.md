# Racehorse Journey — Content Authoring Guide

This guide explains how to add Journey chapters and nodes safely. Journey is **localStorage-only** today—no server or Supabase persistence. Gameplay, Fritz tiers, and BotMatch logic are **not** changed when adding content.

## File map

| Purpose | Location |
|--------|----------|
| Chapter node arrays | `client/src/journey/chapters/ch{N}*.nodes.ts` |
| Chapter registry (playable metadata) | `client/src/journey/journeyChapters.ts` |
| Checkpoint briefings | `client/src/journey/journeyBriefings.ts` |
| Puzzle MCQ content | `client/src/journey/journeyPuzzles.ts` |
| Types / schema | `client/src/journey/journeyTypes.ts` |
| Content validation | `client/src/journey/journeyContentValidation.ts` |
| QA CLI | `npm run qa:journey-content --prefix client` |
| **Example template (not live)** | `client/src/journey/chapters/chapterTemplate.example.ts` |
| Browser smoke | `client/scripts/journeyPhase1Smoke.mjs` |

Only chapters listed in `JOURNEY_CHAPTER_DEFINITIONS` (`journeyChapters.ts`) ship to players. Example/template files are **never imported** there.

---

## How to add a new chapter (checklist)

1. **Copy the template**  
   Duplicate `chapterTemplate.example.ts` → `ch4YourName.nodes.ts`. Replace ids, titles, and all 20+ nodes.

2. **Add chapter id**  
   Add `JOURNEY_CHAPTER_4_ID = 'ch4-your-slug'` to `journeyTypes.ts` (or `journeyChapterIds.ts` if you prefer the existing Ch2/Ch3 pattern).

3. **Export nodes**  
   Export `CH4_*_NODES` from your new file. Add to `chapters/index.ts` `JOURNEY_CHAPTER_NODES_BY_ID` when wired up.

4. **Register the chapter**  
   Append a block to `JOURNEY_CHAPTER_DEFINITIONS` in `journeyChapters.ts`:
   - `releaseStatus: 'playable'` when ready
   - `unlockRequiresChapterId` pointing at the previous chapter
   - `totalNodes: CH4_*_NODES.length`
   - `nodes: CH4_*_NODES`

5. **Auxiliary content**  
   - Every **checkpoint** node → entry in `journeyBriefings.ts` keyed by **node id**  
   - Every **puzzle** node → entry in `journeyPuzzles.ts` keyed by **node id**

6. **Validate**  
   ```bash
   npm run qa:journey-content --prefix client
   npm run build --prefix client
   JOURNEY_SMOKE_BASE=http://127.0.0.1:4177 node client/scripts/journeyPhase1Smoke.mjs
   ```

7. **Smoke spot-checks** (when chapter is playable)  
   Add locked/unlock, node 1 complete, puzzle wrong-answer, match launch, and prior-chapter review checks to `journeyPhase1Smoke.mjs`.

---

## ID conventions

| Item | Pattern | Example |
|------|---------|---------|
| Chapter id | `ch{N}-{kebab-slug}` | `ch4-iron-pass` |
| Node id | `ch{N}-n{NN}` (zero-padded) | `ch4-n07` |
| Node order | `1 … N` contiguous | no gaps |
| Puzzle record key | **same as node id** | `ch4-n03` |
| Briefing record key | **same as node id** | `ch4-n01` |
| `puzzleId` in action | descriptive slug (optional) | `ch4-tempo-gate` |

Node ids must share the chapter prefix (`ch4-` for chapter 4). Never reuse ids across chapters.

---

## Node types

| `nodeType` | Player action | Required aux content | `action` |
|------------|---------------|----------------------|----------|
| `checkpoint` | Open Briefing → Complete Briefing | `journeyBriefings.ts` | `{ kind: 'placeholder' }` |
| `puzzle` | Open Challenge → MCQ → Complete Puzzle | `journeyPuzzles.ts` | `{ kind: 'puzzle', puzzleId: '...' }` |
| `match` | Begin Trial → win BotMatch | none | `{ kind: 'botMatch', fritzTier, dealSize, winningScore? }` |
| `boss` | Same as match; boss styling | none | `{ kind: 'botMatch', fritzTier: 'master', ... }` |

**Fritz tiers allowed:** `rookie`, `standard`, `elite`, `master` only. No new tiers.  
**Deal sizes allowed:** `7` or `14`. Default winning score: `60`.

---

## Checkpoint / briefing nodes

Add to `journeyBriefings.ts`:

```ts
'ch4-n01': {
  nodeId: 'ch4-n01',
  eyebrow: 'Briefing · …',
  title: '…',
  intro: 'One short paragraph.',
  trailNotes: ['Bullet 1', 'Bullet 2', '…'],
  rewardLabel: 'Same as node rewardText',
},
```

Copy rules: do **not** say "Journey Complete" or imply the whole Journey ends at this boss.

---

## Puzzle nodes

Add to `journeyPuzzles.ts` (key = node id):

```ts
'ch4-n02': {
  nodeId: 'ch4-n02',
  eyebrow: 'Puzzle · …',
  title: '…',
  scenario: 'Board/race context.',
  prompt: 'Question?',
  choices: [
    { id: 'a', label: '…' },
    { id: 'b', label: '…' },
  ],
  correctChoiceId: 'b',
  explanation: 'Why b is correct.',
  rewardLabel: '…',
},
```

Wrong answers never show **Complete Puzzle**. Only the correct choice unlocks completion.

---

## Match / boss nodes

```ts
{
  nodeType: 'match', // or 'boss'
  action: {
    kind: 'botMatch',
    fritzTier: 'standard', // rookie | standard | elite | master
    dealSize: 7,
    winningScore: 60,
  },
  completionCriteria: 'Win a match vs Standard Fritz.',
}
```

Boss nodes use `nodeType: 'boss'`, optional `badgeText: 'BOSS'`, and copy that says **chapter** milestone—not final Journey end.

---

## Chapter metadata fields

```ts
{
  chapterId: 'ch4-iron-pass',
  chapterNumber: 4,
  title: 'The Iron Pass',
  subtitle: 'Chapter 4 · …',
  description: 'One sentence for the Journey hero.',
  totalNodes: CH4_IRON_PASS_NODES.length,
  finalReward: 'Iron Pass Seal',
  nextChapterCopy: 'Teaser for next chapter or completion modal.',
  releaseStatus: 'playable', // or 'coming_soon' | 'locked_teaser'
  unlockRequiresChapterId: JOURNEY_CHAPTER_3_ID,
  nodes: CH4_IRON_PASS_NODES,
}
```

`totalNodes` must equal `nodes.length`. Previous chapter must be fully complete before this chapter unlocks (runtime + `setJourneyActiveChapter`).

---

## Validation commands

```bash
# Full validation + content summary (default)
npm run qa:journey-content --prefix client

# Summary only — planning / inventory (no failure on copy rules if you add a dry-run later)
npm run qa:journey-content:summary --prefix client
```

Success output includes:

- chapter count and playable count  
- total node count  
- per-chapter node count and type breakdown (`checkpoint`, `puzzle`, `match`, `boss`)

---

## Common validator errors

| Error | Fix |
|-------|-----|
| `[ch4-…] ch4-n03: missing puzzle content` | Add puzzle keyed by node id |
| `[ch4-…] ch4-n01: missing briefing content` | Add briefing keyed by node id |
| `[ch4-…] totalNodes (20) !== nodes.length (19)` | Fix `totalNodes` or add missing node |
| `[ch4-…] node order gap/duplicate` | Renumber `order` 1…N contiguous |
| `duplicate node id "ch4-n02"` | Id used in two chapters |
| `briefing ch3-n01 has no matching journey node` | Orphan briefing—remove or add node |
| `must not say "Journey Complete"` | Chapter-scoped copy only |
| `invalid fritzTier` | Use rookie/standard/elite/master only |

Errors are prefixed with `[chapterId]` and `nodeId` when applicable.

---

## Optional CSV / JSON authoring (future)

For 50–100+ nodes, prefer planning in a spreadsheet or JSON **before** pasting into `.nodes.ts`:

```json
{
  "chapterId": "ch4-iron-pass",
  "nodes": [
    {
      "id": "ch4-n01",
      "order": 1,
      "nodeType": "checkpoint",
      "title": "Iron Pass Briefing",
      "difficulty": "intro",
      "rewardText": "Pass Marker"
    }
  ]
}
```

A codegen script can be added later (`node scripts/generateJourneyChapter.mjs`). Today, TypeScript chapter files remain the source of truth—validation ensures they stay consistent.

---

## Example mini-chapter (3 nodes)

See `client/src/journey/chapters/chapterTemplate.example.ts` for a working TypeScript snippet (checkpoint → puzzle → boss). It is **not** registered and does not affect node totals.

```ts
// Minimal pattern — do not import into journeyChapters.ts until ready.
export const EXAMPLE_CHAPTER_NODES: JourneyNode[] = [
  { id: 'ch9-n01', nodeType: 'checkpoint', order: 1, action: { kind: 'placeholder' }, /* … */ },
  { id: 'ch9-n02', nodeType: 'puzzle', order: 2, action: { kind: 'puzzle', puzzleId: '…' }, /* … */ },
  { id: 'ch9-n03', nodeType: 'boss', order: 3, action: { kind: 'botMatch', fritzTier: 'master', dealSize: 7 }, /* … */ },
];
```

---

## What not to change in a content pass

- `rh_journey_progress_v1` localStorage key or v2 progress shape  
- Existing Ch1–Ch3 node ids  
- BotMatch, scoring, RNG, Fritz fairness  
- App.tsx routing  
- Server / Supabase  

---

## Current scale (reference)

After Chapter 3: **44 nodes** across **3 playable chapters** (12 + 12 + 20). Chapter 4 is the next expansion target—recommended **20–24 nodes**, harder than The Long March, endurance/tactical theme TBD.
