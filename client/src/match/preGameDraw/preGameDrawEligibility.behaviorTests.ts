import { isPreGameDrawEligible } from './preGameDrawEligibility.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const baseEligible = {
  mode: 'bot' as const,
  dealSize: 7 as const,
  isGuidedMode: false,
  isAuthoringMode: false,
  isAuthoringV2Mode: false,
  isGuidedV2Mode: false,
  isDailyFritzMode: false,
  hasPersistedDailyFritzMatch: false,
};

function testDealSizeSevenRequired(): void {
  assertEqual(isPreGameDrawEligible(baseEligible), true, '7-tile fritz match eligible');
  assertEqual(
    isPreGameDrawEligible({ ...baseEligible, dealSize: 14 }),
    false,
    '14-tile explicitly excluded at gate',
  );
}

function testExcludedModes(): void {
  assertEqual(
    isPreGameDrawEligible({ ...baseEligible, mode: 'ghost' }),
    false,
    'ghost excluded',
  );
  assertEqual(
    isPreGameDrawEligible({ ...baseEligible, isGuidedMode: true }),
    false,
    'guided excluded',
  );
}

function testDailyFritzBaseEligibility(): void {
  assertEqual(
    isPreGameDrawEligible({
      ...baseEligible,
      mode: 'daily-fritz',
      isDailyFritzMode: true,
    }),
    true,
    'daily fritz eligible at base gate when deal is 7 and match is fresh',
  );
  assertEqual(
    isPreGameDrawEligible({
      ...baseEligible,
      mode: 'daily-fritz',
      isDailyFritzMode: true,
      hasPersistedDailyFritzMatch: true,
    }),
    false,
    'resumed daily fritz mid-match skips draw',
  );
}

function run(): void {
  testDealSizeSevenRequired();
  testExcludedModes();
  testDailyFritzBaseEligibility();
  console.log('preGameDrawEligibility.behaviorTests: all passed');
}

run();
