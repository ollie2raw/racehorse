import { computePreGameDrawScatterPositions } from './preGameDrawScatter.ts';
import { generateDoubleSixSet } from './preGameDrawLogic.ts';

function assertTrue(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

function testDeterministicForSameOrder(): void {
  const ids = generateDoubleSixSet().map((t) => `${t.low}-${t.high}`);
  const a = computePreGameDrawScatterPositions(ids);
  const b = computePreGameDrawScatterPositions(ids);
  assertTrue(JSON.stringify(a) === JSON.stringify(b), 'scatter is deterministic');
  assertTrue(a.length === 28, '28 positions');
}

function testPositionsStayInsideInset(): void {
  const ids = generateDoubleSixSet().map((t) => `${t.low}-${t.high}`);
  const positions = computePreGameDrawScatterPositions(ids);
  for (const pos of positions) {
    assertTrue(pos.leftPct >= 11 && pos.leftPct <= 89, `left in bounds: ${pos.tileId}`);
    assertTrue(pos.topPct >= 11 && pos.topPct <= 89, `top in bounds: ${pos.tileId}`);
    assertTrue(pos.rotationDeg >= -28 && pos.rotationDeg <= 28, `rotation in bounds: ${pos.tileId}`);
  }
}

function run(): void {
  testDeterministicForSameOrder();
  testPositionsStayInsideInset();
  console.log('preGameDrawScatter.behaviorTests: all passed');
}

run();
