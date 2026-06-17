import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatJourneyContentSummary,
  formatJourneyContentValidationReport,
  summarizeJourneyContent,
  validateJourneyContent,
  type JourneyContentValidationResult,
} from '../src/journey/journeyContentValidation.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const journeySrcDir = path.resolve(scriptDir, '../src/journey');

const summaryOnly = process.argv.includes('--summary-only');

function validateUiCopy(errors: string[]): void {
  const uiChecks = [
    {
      fileName: 'JourneyChapterCompleteModal.tsx',
      forbidden: [/\bJourney Complete\b/i],
      required: ['Chapter ${chapter.chapterNumber} Complete', 'Chapter Reward'],
    },
    {
      fileName: 'RacehorseJourneyScreen.tsx',
      forbidden: [/\bJourney Complete\b/i],
      required: ['Chapter {activeChapter.chapterNumber} Complete'],
    },
  ] as const;

  for (const check of uiChecks) {
    const source = fs.readFileSync(path.join(journeySrcDir, check.fileName), 'utf8');
    for (const pattern of check.forbidden) {
      if (pattern.test(source)) {
        errors.push(`${check.fileName}: must not match forbidden copy ${pattern}`);
      }
    }
    for (const snippet of check.required) {
      if (!source.includes(snippet)) {
        errors.push(`${check.fileName}: missing required copy snippet "${snippet}"`);
      }
    }
  }
}

if (summaryOnly) {
  console.log(formatJourneyContentSummary(summarizeJourneyContent()));
  process.exit(0);
}

const result: JourneyContentValidationResult = validateJourneyContent();
validateUiCopy(result.errors);
result.ok = result.errors.length === 0;

console.log(formatJourneyContentValidationReport(result));

if (!result.ok) {
  process.exit(1);
}
