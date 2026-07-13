import type { JourneyAuthoredLessonBundle } from './journeyAuthoredLessonBundle.ts';
import { OPEN_END_DISCIPLINE_BUNDLE } from './lessons/openEndDiscipline/openEndDisciplineBundle.ts';
import { COUNTING_WHATS_LEFT_BUNDLE } from './lessons/countingWhatsLeft/countingWhatsLeftBundle.ts';
import { DOUBLES_ARENT_FREE_BUNDLE } from './lessons/doublesArentFree/doublesArentFreeBundle.ts';

export const PRODUCTION_AUTHORED_LESSON_BUNDLES: ReadonlyArray<JourneyAuthoredLessonBundle> = [OPEN_END_DISCIPLINE_BUNDLE, COUNTING_WHATS_LEFT_BUNDLE, DOUBLES_ARENT_FREE_BUNDLE];
const BUNDLES_BY_CONTENT_ID = new Map(PRODUCTION_AUTHORED_LESSON_BUNDLES.map((bundle) => [String(bundle.contentId), bundle]));

if (BUNDLES_BY_CONTENT_ID.size !== PRODUCTION_AUTHORED_LESSON_BUNDLES.length) throw new Error('Duplicate authored Journey lesson bundle content IDs.');

export function getJourneyAuthoredLessonBundle(contentId: string): JourneyAuthoredLessonBundle | null {
  return BUNDLES_BY_CONTENT_ID.get(contentId) ?? null;
}

export function resolveJourneyAuthoredVariant(bundle: JourneyAuthoredLessonBundle, variantSetId: string, previouslyUsedScenarioIds: string[]) {
  const scenario = Object.values(bundle.scenarios).filter((entry) => entry.variantSetId === variantSetId).sort((a, b) => a.id.localeCompare(b.id)).find((entry) => !previouslyUsedScenarioIds.includes(entry.id));
  return scenario ? { kind: 'resolved' as const, scenario } : { kind: 'exhausted' as const, variantSetId };
}
