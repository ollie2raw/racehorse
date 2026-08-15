/**
 * Deterministic Circuit run-plan builder (non-UI).
 */

import type { CircuitScenario } from './circuitScenario';
import certifiedSeed from './circuitCertifiedSeed.json';

const FALLBACK_SCENARIOS = certifiedSeed as unknown as CircuitScenario[];

export type CircuitRunManifestGate =
  | { readonly kind: 'single_gate'; readonly scenarioId: string }
  | { readonly kind: 'checkpoint_hand'; readonly scenarioId: string };

export type CircuitRunPlan = {
  readonly seed: string;
  readonly variant: 'default' | 'control-focus' | 'scoring-focus';
  readonly gates: readonly CircuitRunManifestGate[];
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sortByDifficulty(scenarios: CircuitScenario[]): CircuitScenario[] {
  return scenarios.slice().sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
}

function pickWithoutImmediateDuplicate(
  pool: CircuitScenario[],
  count: number,
  rand: () => number,
  used: Set<string>,
): CircuitScenario[] {
  const available = pool.filter((s) => !used.has(s.id));
  const picked: CircuitScenario[] = [];
  const working = available.slice();
  while (picked.length < count && working.length > 0) {
    const progress = picked.length / Math.max(1, count);
    const idxBias = Math.floor(progress * (working.length - 1));
    const jitter = Math.floor(rand() * Math.min(3, working.length));
    const idx = Math.min(working.length - 1, idxBias + (rand() < 0.5 ? 0 : jitter));
    const [chosen] = working.splice(idx, 1);
    picked.push(chosen!);
    used.add(chosen!.id);
  }
  return picked;
}

export function buildCircuitRunPlan(input?: {
  seed?: string;
  variant?: CircuitRunPlan['variant'];
  scenarios?: readonly CircuitScenario[];
}): CircuitRunPlan {
  const scenarios = input?.scenarios ?? FALLBACK_SCENARIOS;
  const variant = input?.variant ?? 'default';
  const seed = input?.seed ?? `circuit:${variant}:v1`;

  const singles = sortByDifficulty(
    scenarios.filter((s) => s.kind === 'single_gate' && s.certification === 'certified'),
  );
  const checkpoints = sortByDifficulty(
    scenarios.filter((s) => s.kind === 'checkpoint_hand' && s.certification === 'certified'),
  );

  if (singles.length < 10 || checkpoints.length < 2) {
    throw new Error('[Circuit] Bank too small for a 12-gate run');
  }

  if (variant === 'default') {
    return { seed, variant, gates: buildStableDefault(singles, checkpoints) };
  }

  const rand = mulberry32(hashSeed(seed));
  const used = new Set<string>();
  let pool = singles;
  if (variant === 'control-focus') {
    pool = [
      ...singles.filter((s) => s.categories.includes('board_control') || s.categories.includes('blocking')),
      ...singles,
    ];
  } else if (variant === 'scoring-focus') {
    pool = [
      ...singles.filter((s) => s.categories.includes('scoring') || s.categories.includes('tempo')),
      ...singles,
    ];
  }
  const seen = new Set<string>();
  pool = pool.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  const chosenSingles = pickWithoutImmediateDuplicate(sortByDifficulty(pool), 10, rand, used);
  while (chosenSingles.length < 10) {
    const filler = singles.find((s) => !used.has(s.id));
    if (!filler) break;
    chosenSingles.push(filler);
    used.add(filler.id);
  }

  const cp0 = checkpoints[0]!;
  const cp1 = checkpoints[1]!;
  const gates: CircuitRunManifestGate[] = [];
  let si = 0;
  for (let gate = 1; gate <= 12; gate += 1) {
    if (gate === 5) gates.push({ kind: 'checkpoint_hand', scenarioId: cp0.id });
    else if (gate === 10) gates.push({ kind: 'checkpoint_hand', scenarioId: cp1.id });
    else gates.push({ kind: 'single_gate', scenarioId: chosenSingles[si++]!.id });
  }

  return { seed, variant, gates };
}

function buildStableDefault(
  singles: CircuitScenario[],
  checkpoints: CircuitScenario[],
): CircuitRunManifestGate[] {
  const pickSingle = (index: number) => singles[Math.min(index, singles.length - 1)]!;
  const gates: CircuitRunManifestGate[] = [];
  const singleOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let singleCursor = 0;
  for (let gate = 1; gate <= 12; gate += 1) {
    if (gate === 5) gates.push({ kind: 'checkpoint_hand', scenarioId: checkpoints[0]!.id });
    else if (gate === 10) gates.push({ kind: 'checkpoint_hand', scenarioId: checkpoints[1]!.id });
    else {
      gates.push({ kind: 'single_gate', scenarioId: pickSingle(singleOrder[singleCursor]!).id });
      singleCursor += 1;
    }
  }
  return gates;
}

export function buildDefaultCircuitRunManifest(
  scenarios: readonly CircuitScenario[] = FALLBACK_SCENARIOS,
): readonly CircuitRunManifestGate[] {
  return buildCircuitRunPlan({ scenarios, variant: 'default' }).gates;
}
