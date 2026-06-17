# Racehorse Journey — Scale & Playability Audit

**Date:** June 2026  
**Scope:** Read-only audit of Journey at **108 nodes / 6 playable chapters**  
**Audience:** Product + engineering before expanding toward 150+ nodes  
**Runtime code:** Not modified in this pass

---

## 1. Executive summary

Racehorse Journey is **architecturally ready to scale** (multi-chapter registry, v2 progress, content validator, horizontal chapter rail, per-chapter content pattern started in Ch6). The mode **reads as one connected premium tactical campaign** on paper: Fritz Trail → High Line → Long March → Pressure Circuit → Iron Mile → Master Table is a coherent difficulty arc.

However, at **108 nodes the mode is larger than it is varied**. The late chapters (especially Ch4 and Ch5) feel like **the same 24-node template repeated with swapped nouns**. Puzzle content converges on a single correct-answer shape (**“deny the swing / take the safe line / close the end”**), and **46 of 47 puzzles** mark choice **B** as correct—players who notice this will trivialize half the Journey. Fritz trials are mechanically identical (**7-tile deal, race to 60, same tiers reused**), so Ch5–Ch6 risk **Master-tier fatigue** even when copy says “mastery.”

**Verdict:** Journey is a credible **MVP long-form mode**, not yet a **premium long-term platform** like NYT Games or Chess.com lesson paths. **Do not add Chapter 7 until Ch4–Ch6 content patterns are diversified and puzzle/boss templates are de-duplicated.** Infrastructure scaling (content files, validator, rail UI) is ahead of **content craft and player-facing polish**.

**Top risk if we only add nodes:** node count grows, perceived depth does not.

---

## 2. Current content inventory

| Ch | ID | Title | Nodes | Checkpoint | Puzzle | Match | Boss | Final reward |
|----|-----|-------|------:|-----------:|-------:|------:|-----:|--------------|
| 1 | `ch1-fritz-trail` | The Fritz Trail | 12 | 2 | 3 | 6 | 1 | Fritz Trail Conqueror |
| 2 | `ch2-high-line` | The High Line | 12 | 2 | 5 | 4 | 1 | High Line Crest |
| 3 | `ch3-long-march` | The Long March | 20 | 4 | 9 | 6 | 1 | Long March Seal |
| 4 | `ch4-pressure-circuit` | The Pressure Circuit | 24 | 4 | 12 | 7 | 1 | Pressure Circuit Crest |
| 5 | `ch5-iron-mile` | The Iron Mile | 24 | 4 | 12 | 7 | 1 | Iron Mile Crest |
| 6 | `ch6-master-table` | The Master Table | 16 | 3 | 7 | 5 | 1 | Master Table Crest |
| **Total** | | | **108** | **19** | **48** | **35** | **6** | |

**Auxiliary content**

- **Briefings:** 19 checkpoint nodes (Ch1–5 in `journeyBriefings.ts`, Ch6 in `ch6MasterTable.content.ts`)
- **Puzzles:** 48 nodes (Ch1–5 in `journeyPuzzles.ts` ~760 lines, Ch6 in `ch6MasterTable.content.ts`)
- **Bot trials:** 41 nodes (35 match + 6 boss); all use `dealSize: 7`, `winningScore: 60`
- **Fritz tiers used:** rookie (2), standard (10), elite (10), master (23 match/boss nodes)

**Discoverability**

- Journey entry: **Single Player Hub only** (`SinglePlayerHubScreen` → “Enter Trail”)
- **Not** on homepage daily card row; no global progress teaser

**Progress**

- `rh_journey_progress_v1`, v2 chapter-scoped `localStorage` only
- No Supabase / cross-device sync

---

## 3. Chapter-by-chapter quality review

### Chapter 1 — The Fritz Trail (12 nodes) · **Strong**

- **Identity:** Onboarding + first contact with Fritz tiers (rookie → master).
- **Strengths:** Clear pacing; mix of matches and puzzles; “First Grandmaster Trial” sets boss expectation; tone is mature tactical, not mobile fluff.
- **Weaknesses:** Ch1 already introduces **Master Fritz** before Ch2 resets to standard—intentional spike, but can feel early. Node title “The First Grandmaster Trial” vs actual `fritzTier: 'master'` (not a distinct Grandmaster tier) is **naming drift**.
- **Rewards:** Varied (`First Blood`, `Ice Veins`, `Elite Crest`)—good.

### Chapter 2 — The High Line (12 nodes) · **Strong**

- **Identity:** Tactical reads, free-end denial, board tightness.
- **Strengths:** Distinct from Ch1; puzzle count rises appropriately; elite/master finish feels earned after Ch1.
- **Weaknesses:** None critical at this length.

### Chapter 3 — The Long March (20 nodes) · **Good**

- **Identity:** Endurance, recovery, mid-race pressure—first “long” chapter.
- **Strengths:** Checkpoint rhythm (4 briefings) breaks the march; denial/swing puzzles teach real Racehorse concepts.
- **Weaknesses:** Some puzzle scenarios echo Ch2 (deny swing, double trap). Still acceptable as **spiral curriculum**.

### Chapter 4 — The Pressure Circuit (24 nodes) · **Adequate but repetitive**

- **Identity:** Sustained pressure, squeeze, denial—**clear on paper**.
- **Strengths:** Tier ramp (standard → elite → master) is logical; checkpoint cadence matches length.
- **Weaknesses:** Becomes a **formula**: briefing → puzzle → match → puzzle → puzzle → match → checkpoint → repeat. Many puzzles are **reskins** of Ch3 beats (`Take Five or Deny Ten`, boss prep gate, 58–58 gate). Player who completed Ch3 feels déjà vu by node 10.

### Chapter 5 — The Iron Mile (24 nodes) · **Adequate but redundant with Ch4**

- **Identity:** Endgame control, closeout, recovery—**different theme, same skeleton as Ch4**.
- **Strengths:** Elite opens mile (Ch4 used standard early)—slight step up; master density appropriate for “late game.”
- **Weaknesses:** **Near-isomorphic structure to Ch4** (24 nodes, 4 checkpoints, 12 puzzles, 7 matches). Shared node names/concepts: `No Gifts`, `Final Brief`, `Gate One/Two`, `Control Trial I/II`, `Final Table`. Reads like **Chapter 4.5**, not a new mile.

### Chapter 6 — The Master Table (16 nodes) · **Good concept, thin execution**

- **Identity:** Master-only table, patience, clean closeouts—**best late-chapter fantasy**.
- **Strengths:** Shorter chapter is right for mastery capstone; **Seat 1–4** framing is memorable; all-master is coherent; per-chapter content file proves the pipeline.
- **Weaknesses:** Only **7 puzzles** but several duplicate Ch4/5 templates (`No Gifts`, safe road, clean hands boss gate). Description meta line **“pushes Racehorse Journey past one hundred nodes”** breaks immersion—players should not see node-count milestones in copy. Puzzle count low relative to seats—players may feel **match-heavy** (6 master trials in 16 nodes).

---

## 4. Difficulty curve assessment

| Phase | Chapters | Intended role | Assessment |
|-------|----------|---------------|------------|
| Onboard | Ch1 | Learn modes, rookie → master taste | **Works** |
| Sharpen | Ch2 | Tactical denial | **Works** |
| Endure | Ch3 | Long chapter, recovery | **Works** |
| Pressure | Ch4 | Repeated squeeze | **Flat emotionally** after Ch3 |
| Closeout | Ch5 | Endgame control | **Difficulty OK, novelty low** |
| Mastery | Ch6 | Master table | **Hard but samey trials** |

**Spikes**

- Ch1 boss/master before Ch2 standard drop: acceptable if framed as “preview.”
- Ch4→Ch5: **no real step down or sideways**—both 24-node gauntlets.

**Flat spots**

- **Ch4 mid → Ch5 mid:** puzzle scenarios and correct answers feel interchangeable.
- **Ch6:** difficulty is high but **not deeper**—same master match repeated with seat labels.

**Recommendation:** Future chapters should vary **challenge type**, not just tier label—e.g. puzzle-only gates, back-to-back matches with briefing breather, or “win from behind” themed trials (still same bot logic, different copy/deal context if ever supported).

---

## 5. Node-type balance table

| Chapter | Nodes | CP % | Puzzle % | Match % | Boss % | Max same-type streak |
|---------|------:|-----:|---------:|--------:|-------:|---------------------|
| 1 | 12 | 17 | 25 | 50 | 8 | 3 matches |
| 2 | 12 | 17 | 42 | 33 | 8 | 2 puzzles |
| 3 | 20 | 20 | 45 | 30 | 5 | 2 puzzles |
| 4 | 24 | 17 | 50 | 29 | 4 | 2 puzzles |
| 5 | 24 | 17 | 50 | 29 | 4 | 2 puzzles |
| 6 | 16 | 19 | 44 | 31 | 6 | 2 puzzles |
| **Total** | **108** | **18** | **44** | **32** | **6** | — |

**Overall mix:** ~44% puzzles, ~32% bot trials, ~18% briefings—reasonable for a **strategy curriculum**.

**Ideal ratio for future 20–30 node chapters (recommendation)**

| Type | Target share | Notes |
|------|-------------|-------|
| Checkpoint | 15–20% | 3–4 briefings per 24 nodes |
| Puzzle | 40–45% | Never >2 puzzles in a row without a match or checkpoint |
| Match | 28–35% | Tier ramp within chapter |
| Boss | 1 node | Always preceded by prep puzzle |

**Flags**

- Ch1 is **match-heavy** (50%)—fine for onboarding.
- Ch4–5 are **puzzle-heavy** (50%) with similar MCQ voice—**fatigue risk**.
- No chapter exceeds 2 identical types in a row—**good structural guardrail**.

---

## 6. Puzzle quality review

### Inventory

- **48 puzzles** total; **1** uses correct answer **C** (`ch1-n08` Puzzle Gate); **47** use **B**.
- **Meta-exploit severity: P0.** A player who learns “B is almost always correct” will bypass the pedagogical intent of ~98% of puzzles.

### Strong patterns to reuse

1. **Deny-before-score swing math** (when framed with specific pip/end)—teaches real Racehorse denial.
2. **Double/trap identification** (Fritz owns both replies)—distinct skill.
3. **Pip count / quiet Fritz** reads—good midgame literacy.
4. **Last-tile sequencing** (`Save the Five`, `The Last Five`, `Count the Exit`)—good endgame framing.
5. **Ch1-n08 (answer C)**—multi-concept gate; **more puzzles should look like this**.

### Patterns to retire or heavily limit

1. **Boss prep clone** — nearly identical MCQ in `ch3-n19`, `ch4-n23`, `ch5-n23`, `ch6-n14`:
   - Correct: *“Close the dangerous end, preserve reply, and take the safe line to 60.”*
   - Players who’ve seen it once will auto-complete forever.
2. **“Pass twice and force Fritz to break”** as wrong-answer filler—overused decoy (8+ puzzles).
3. **“Press for max score / aggression”** as wrong answer A—predictable pairing with B correct.
4. **58–58 / 59–57 gate** scenarios duplicated across Ch4–6.

### Wording / pedagogy

- Copy is **mature and tactical**—not childish; avoids casino tone. **Good.**
- Many scenarios are **abstract** (no board diagram, no tile notation)—acceptable for MCQ, but limits “premium strategy platform” feel vs Daily Puzzle ladder.
- Explanations are **repetitive in structure** (“X means Y—not Z”)—fine individually, dull in bulk.

### Recommendations

- **Rotate correct answers** across A/B/C/D (validator could warn if >60% one letter).
- Cap **template reuse** to one appearance per chapter for boss-prep / gate puzzles.
- Introduce **2–3 new puzzle archetypes** before Ch7: e.g. pass-vs-play tempo, boneyard discipline with counts, “which end is live” without scoring language.

---

## 7. Briefing quality review

### Inventory

- **19 briefings**, typically **5 trail notes** + intro paragraph.
- Tone: **premium tactical**, references to “many more chapters”—appropriate.

### Strengths

- Checkpoints anchor chapter themes before difficulty spikes.
- Consistent eyebrow/title/rewardLabel structure.
- Good explicit line: boss/chapter crest **≠ end of Journey**.

### Weaknesses

1. **Structural sameness:** intro + 5 bullets repeats across all chapters—predictable.
2. **Redundant bullets** across chapters (“Speed is not the goal”, “Review checkpoints”, “Many more chapters lie beyond”)—copy-paste fatigue.
3. **Length:** fine for 19 briefings; will **bloat** at 50+ checkpoints without a tighter template.
4. **Ch6 intro** mentions internal milestone (100 nodes)—**remove from player-facing copy**.

### Tighter briefing template (recommendation)

```
Eyebrow · Theme
Intro (2 sentences max: what this checkpoint tests + why it matters now)
Trail notes (3 bullets):
  - One tactical rule
  - One warning about upcoming node type/tier
  - One forward teaser (next chapter or boss gate)
Reward label
```

---

## 8. Fritz trial progression review

### Tier distribution by chapter (match + boss nodes)

| Chapter | Rookie | Standard | Elite | Master |
|---------|-------:|---------:|------:|-------:|
| 1 | 2 | 2 | 1 | 2 |
| 2 | 0 | 2 | 1 | 2 |
| 3 | 0 | 2 | 2 | 3 |
| 4 | 0 | 2 | 2 | 4 |
| 5 | 0 | 0 | 2 | 6 |
| 6 | 0 | 0 | 0 | 6 |

**Ramp:** Sensible through Ch5. **Ch6 all-master** is coherent for “Master Table.”

**Problems**

1. **Mechanical sameness:** Every trial = win one 7-tile race to 60 vs Fritz. No deal-size variation, no “win 2 of 3” framing (would be UI/copy only), no handicap narrative.
2. **Master repetition:** 23 master trials total; late Journey is **mostly the same BotMatch** with different node titles (`Seat One`, `Control Trial II`, `Final Table`).
3. **Ch1 master before Ch2 standard:** Pedagogically odd but not broken.

### Future trial modifiers (no bot logic change yet)

| Modifier | Implementation | Purpose |
|----------|----------------|---------|
| **Seat label + briefing** | Copy only | Already used in Ch6—extend with pre-match briefing line |
| **Deal size 14** | Node action field | “Long hand” endurance trials |
| **Win-from-behind seed** | Future: fixed opening position in journey launch | Themed recovery trials |
| **No second chances copy** | UI string | Raises stakes without code |
| **Elite-only chapter opener** | Tier choice | Ch5 already does this—good |

---

## 9. Reward / achievement review

### Chapter completion rewards

| Ch | Final reward | Type |
|----|--------------|------|
| 1 | Fritz Trail Conqueror | Title/conqueror |
| 2 | High Line Crest | Crest |
| 3 | Long March Seal | Seal |
| 4 | Pressure Circuit Crest | Crest |
| 5 | Iron Mile Crest | Crest |
| 6 | Master Table Crest | Crest |

**Crest inflation:** Four of six chapters end in **Crest**—diminishing distinctiveness.

### Per-node `rewardText` patterns

- **Markers:** Trail Marker, Line Marker, March Marker, Circuit Marker, Mile Marker, Table Marker
- **Keys/Gates:** Gate Key, Gate One, Boss Key, Clean Hands
- **Seats (Ch6 only):** Seat One–Four, Final Seat Pass—**best taxonomy**
- **Repeated labels:** `Final Brief`, `Gate One/Two`, `Trap Avoided`, `No Gifts`, `Five Saved` across chapters

**Meaningfulness today:** Rewards are **flavor text only**—no inventory, profile badge, or home display. Players may stop reading them by Ch4.

### Recommended taxonomy (future)

| Tier | Examples | When |
|------|----------|------|
| **Marker** | Trail Marker, Mile Marker | Chapter start / first checkpoint |
| **Read** | Denial Read, Pip Read | Puzzle completion |
| **Pass** | Seat One, First Mile Pass | Match completion |
| **Crest / Seal** | Chapter final reward | Chapter complete modal only |
| **Rank** (future) | Table Regular, Circuit Veteran | Cross-chapter meta—needs persistence UI |

Do not add inventory until Supabase/profile surface exists.

---

## 10. UI scalability review

### Current (6 chapters)

- **Horizontal scroll rail** (~220px cards, scroll-snap, brass scrollbar)—works at 6 chapters on desktop and 390px width (smoke verified).
- **Header stack:** hero + progress + chapter rail + optional complete banner + map/detail grid.
- **Map panel** remains primary focus—**good**.

### Projected limits

| Chapters | Rail alone | Recommendation |
|----------|------------|----------------|
| 6–10 | OK with scroll | Keep rail; add chapter number pills or “Ch 7 of 12” |
| 10–20 | Tedious scroll | **Chapter drawer** or collapsible “All chapters” panel |
| 20–50 | Poor | **World/season selector** → rail shows season only (5–8 chapters) |
| 50+ | Insufficient | Season map + search/filter by status (locked/available/completed) |

### Known UI debt (P1)

- **Chapter complete banner** still says *“this is only the first march”* for **every** chapter—including Ch6 (`RacehorseJourneyScreen.tsx`). Undermines long-mode credibility.
- **JourneyChapterCompleteModal** says *“opening march”*—same issue.
- **Ch6 chapter description** references “one hundred nodes”—internal milestone, not player fantasy.

### Rail triggers for redesign

- **~12+ chapters** in one season: add drawer or grouped rail sections.
- **Locked chapter discovery:** scrolling past 8+ cards to see “Coming Soon” is weak—use season teaser card instead.

---

## 11. Content architecture review

### Current split

| Content | Location |
|---------|----------|
| Ch1–5 nodes | `chapters/ch{N}*.nodes.ts` |
| Ch6 nodes | `ch6MasterTable.nodes.ts` |
| Ch1–5 briefings/puzzles | `journeyBriefings.ts`, `journeyPuzzles.ts` (~1000 lines combined) |
| Ch6 briefings/puzzles | `ch6MasterTable.content.ts` |
| Lookup | `journeyContentIndex.ts` merges global + `CHAPTER_*_REGISTRIES[]` |
| Validation | Uses index helpers; still references global files implicitly |

### Strengths

- Node definitions already per-chapter—**good**.
- Ch6 pattern is **exactly** what scaling needs.
- Validator + `qa:journey-content` CLI scales linearly.

### Risks at 150+ nodes

1. **`journeyPuzzles.ts` monolith**—merge conflicts, slow authoring, hard review.
2. **Manual registry array** in `journeyContentIndex.ts`—easy to forget Ch7 registry (human error).
3. **Authoring guide outdated**—still tells authors to append to global briefings/puzzles only.
4. **Circular re-export** (`journeyBriefings.ts` → `journeyContentIndex.ts` → `journeyBriefings.ts`)—works today but fragile.

### Migration recommendation

| When | Action |
|------|--------|
| **Now (before Ch7)** | Update authoring guide for `*.content.ts` + index registration |
| **Ch7** | Add `ch7*.content.ts`; do **not** append to global files |
| **Ch4–5 retrofit** | Optional batch move when touching those chapters—low urgency |
| **Ch1–3 retrofit** | Defer until 100+ nodes or dedicated cleanup sprint |
| **Future** | Auto-discover: `import.meta.glob('./chapters/*.content.ts')` in Vite—reduces registry mistakes |

### JSON authoring

- **Not needed yet** at 108 nodes if TS content files stay per-chapter.
- Consider JSON/YAML **when non-engineers author** or when localization arrives.

---

## 12. Testing strategy review

### Current smoke (`journeyPhase1Smoke.mjs`)

- **~126 assertions** / **~100 `record()` calls**
- Grows ~**18–22 checks per new chapter** (lock states, unlock flow, node1, puzzle wrong, match launch, prior-chapter review, rail scroll)
- Full run ~**55–65s** headless—still acceptable

### Problems

- **Linear cost:** Ch10 could mean **200+ checks** and brittle maintenance.
- **Duplication:** Each chapter repeats the same unlock/play script with different IDs.
- **No content-quality tests:** Answer-letter bias, duplicate puzzle stems, tier ramp—validator ignores these.

### Scalable QA pattern (recommendation)

| Layer | What | When |
|-------|------|------|
| **Content validator** | Schema, IDs, aux content presence, forbidden copy | Every commit (today) |
| **Content linter (new)** | Answer distribution, duplicate scenario hash, tier ramp rules | Extend validator |
| **Smoke core** | Ch1 flow, routing, 720px node clicks, rail scroll | Fixed ~40 checks |
| **Smoke chapter matrix** | Parameterized: `[latestChapter, previousChapter]` only | 2 chapters per run |
| **Optional nightly** | Full all-chapter unlock matrix | CI scheduled |

**Do not** add full Ch7 parity (+20 checks) without refactoring smoke to parameterized helpers.

---

## 13. Persistence / server-readiness review

### MVP (today)

- **localStorage v2** is acceptable for solo progression, QA, and content iteration.
- Migration from v1 preserved; chapter-scoped records clean.

### When Supabase becomes necessary

| Trigger | Why |
|---------|-----|
| Cross-device play | Users expect Journey progress on phone + desktop |
| Homepage / social proof | “Chapter 4 in progress” on profile |
| Paid / premium positioning | Loss of local-only progress feels cheap |
| Leaderboards / Journey ranks | Needs server truth |
| Content A/B or remote chapter flags | Needs server config |

### Implementation sketch (do not build yet)

1. Table: `journey_progress(user_id, version, active_chapter_id, chapters_json, updated_at)`
2. Merge strategy: **server wins** or **max(completed nodes)** per chapter on login
3. Client: hydrate from Supabase after auth; write-through on `markJourneyNodeCompleted`
4. Keep localStorage as offline cache with sync timestamp
5. **No change** to node IDs or chapter IDs when adding server—v2 shape maps cleanly

**Until then:** warn in UI that Journey progress is **device-local** (small line in Journey hero)—optional P2.

---

## 14. P0 / P1 / P2 recommendations

### P0 — Fix before Chapter 7

1. **Puzzle answer distribution** — break “always B” meta; add validator warning.
2. **De-duplicate boss prep / gate puzzles** — one template per Journey, not per chapter.
3. **D differentiate Ch4 vs Ch5** — retheme or restructure one chapter so they don’t feel like clones (content edit pass, not code).
4. **Fix stale chapter-complete copy** — banner/modal should reflect chapter number / season, not “first march.”

### P1 — Polish & scale infrastructure

5. Migrate **new chapters** to `*.content.ts` only; update authoring guide.
6. Auto-register content registries in `journeyContentIndex` (glob or explicit manifest file).
7. Extend validator: duplicate scenario detection, answer-letter stats, consecutive puzzle warnings.
8. Refactor smoke to **parameterized chapter tests** (latest + previous chapter only).
9. Vary puzzle **wrong-answer personas** (not always “aggressive score now”).

### P2 — Product growth

10. Home-screen Journey discoverability (progress chip, continue node).
11. Supabase progress sync for authenticated users.
12. Profile display of chapter crests / Master Table seats.
13. Season/world selector when chapter count > 10.
14. Trial variety via `dealSize: 14` nodes in late chapters.

---

## 15. Recommended next 3 implementation passes

### Pass 1 — **Content polish sprint (Ch4–Ch6 + global puzzles)** · ~1 focused session

- Reword/rewrite duplicate puzzles (boss prep, gates, No Gifts).
- Rotate correct answers; add 3–5 puzzles with non-B answers.
- Fix chapter-complete banner + modal copy.
- Remove meta “100 nodes” line from Ch6 description.
- **No new chapters.** Validator linter rules for answer bias.

### Pass 2 — **Content architecture + QA scaling** · ~1 session

- `ch4*.content.ts`, `ch5*.content.ts` migration (move copy out of globals).
- `journeyContentIndex` manifest or glob auto-load.
- Update `docs/racehorse-journey-content-authoring.md`.
- Refactor smoke to parameterized chapter matrix.
- **Still no Ch7.**

### Pass 3 — **Chapter 7 OR discoverability (pick one)**

**Recommended: Chapter 7** (~20 nodes, new theme—e.g. “The Closing Line” or “The Brass Table”) **only after Pass 1–2**.

Alternative if product priority is acquisition: **home-screen Journey card with continue CTA** (no new nodes).

**Not recommended next:** Supabase persistence before content polish—server would sync a repetitive 108-node experience.

---

## Direct answer: what should we do next?

| Option | Verdict |
|--------|---------|
| Add Chapter 7 immediately | **No** — repetition risk outweighs node count |
| Polish Ch1–6 first | **Yes — P0** |
| Home-screen discoverability | **Yes — P2** after polish, or parallel if growth is blocked |
| Supabase progress | **Defer** until cross-device is a stated product goal |

Journey at 108 nodes proves **the pipeline works**. The next win is making those nodes **feel like 108 distinct tactical beats**, not 24 templates copied four times.

---

*End of audit.*
