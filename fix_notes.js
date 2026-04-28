const fs = require('fs');

const file = fs.readFileSync('client/src/learn/guidedLessonNotes.ts', 'utf8');

// Extract the big object
const match = file.match(/export const GUIDED_LESSON_COACHING_BY_EVENT_INDEX: Record<number, string> = (\{[\s\S]*?\n\});/);
if (!match) throw new Error("Could not find object");

let objStr = match[1];

// We want to create an array of these values.
// But evaluating the string directly might be tricky due to TypeScript or backticks.
// Let's just do a simple replacement.
const newCode = file.replace(
  /export const GUIDED_LESSON_COACHING_BY_EVENT_INDEX: Record<number, string> = \{[\s\S]*?\n\};/,
  `const RAW_NOTES_FROM_MARKDOWN: Record<number, string> = ${objStr};\n\nexport const GUIDED_LESSON_COACHING_BY_VISIBLE_STEP: string[] = Object.entries(RAW_NOTES_FROM_MARKDOWN)\n  .sort((a, b) => Number(a[0]) - Number(b[0]))\n  .map(entry => entry[1]);`
);

let newHelper = `export function applyGuidedLessonCoachingText<
  T extends { events?: Array<{ eventIndex?: number; actor?: string; action?: string; coachingText?: string }> }
>(lesson: T): T {
  if (!lesson?.events) return lesson;

  let visibleCoachStep = 0;
  let appliedCount = 0;

  const nextLesson = {
    ...lesson,
    events: lesson.events.map((event) => {
      if (event.actor === 'player' && event.action === 'play') {
        const note = GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[visibleCoachStep];
        visibleCoachStep++;
        
        if (note) {
          appliedCount++;
          return { ...event, coachingText: note };
        }
      }
      return event;
    }),
  };

  console.log('[guided-notes] applied', appliedCount, 'of', GUIDED_LESSON_COACHING_BY_VISIBLE_STEP.length, 'coaching notes to visible steps');

  // Phase 4: Validation against actual expected/best move tile
  if (appliedCount > 0 && typeof window !== 'undefined') {
    nextLesson.events.forEach((event) => {
      if (event.actor === 'player' && event.action === 'play' && event.coachingText) {
        const match = event.coachingText.match(/Play:?\\s*(\\d-\\d)/i) || event.coachingText.match(/Start with\\s*(\\d-\\d)/i);
        if (match && event.tile) {
          const noteTile = match[1];
          // Simple normalize "4-3" vs "3-4"
          const n1 = noteTile.split('-').sort().join('|');
          const e1 = event.tile.split('|').sort().join('|');
          if (n1 !== e1) {
            console.warn('[guided-note-align] mismatch', {
              eventIndex: event.eventIndex,
              notePlayLine: match[0],
              actualBestMove: event.tile,
            });
          }
        }
      }
    });
  }

  return nextLesson;
}`;

const finalCode = newCode.replace(/export function applyGuidedLessonCoachingText[\s\S]*$/, newHelper);
fs.writeFileSync('client/src/learn/guidedLessonNotes.ts', finalCode);
console.log("Notes file updated successfully.");
