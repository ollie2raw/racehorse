import type { Tile } from '../types';

export type PracticeDifficulty = 'random' | 'easy' | 'hard' | 'insane';

export interface NoBrainerHandRecord {
  hand: Tile[];
  example: Tile[];
  difficulty: Exclude<PracticeDifficulty, 'random'>;
  key: string;
}

let cachedDatasetPromise: Promise<NoBrainerHandRecord[]> | null = null;
const DATASET_URLS = ['/data/noBrainers.valid.json', '/data/noBrainers.generated.json'];

function parseTile(raw: string): Tile | null {
  const match = raw.trim().match(/^(\d)\|(\d)$/);
  if (!match) return null;
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (Number.isNaN(low) || Number.isNaN(high)) return null;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function classifyDifficulty(key: string): Exclude<PracticeDifficulty, 'random'> {
  const bucket = hashString(key) % 100;
  if (bucket < 34) return 'easy';
  if (bucket < 70) return 'hard';
  return 'insane';
}

export async function loadNoBrainerDataset(): Promise<NoBrainerHandRecord[]> {
  if (cachedDatasetPromise) return cachedDatasetPromise;

  cachedDatasetPromise = (async () => {
    for (const url of DATASET_URLS) {
      const res = await fetch(url);
      if (!res.ok) continue;
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;

      const rows: NoBrainerHandRecord[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as { hand?: unknown; example?: unknown };
        const handRaw = Array.isArray(rec.hand) ? rec.hand : [];
        const exampleRaw = Array.isArray(rec.example) ? rec.example : [];
        const hand = handRaw.map((value) => parseTile(String(value))).filter((t): t is Tile => Boolean(t));
        const example = exampleRaw
          .map((value) => parseTile(String(value)))
          .filter((t): t is Tile => Boolean(t));
        if (hand.length !== 7) continue;
        const normalizedExample = example.length === 7 ? example : hand;
        const key = hand
          .map((t) => `${t.low}|${t.high}`)
          .sort()
          .join(',');
        rows.push({
          hand,
          example: normalizedExample,
          key,
          difficulty: classifyDifficulty(key),
        });
      }

      if (rows.length > 0) return rows;
    }

    throw new Error(
      'Validated no-brainer dataset is missing. Run: npm --prefix ../server run nobrainer:validate',
    );
  })();

  return cachedDatasetPromise;
}

export function pickNoBrainerHand(
  dataset: NoBrainerHandRecord[],
  difficulty: PracticeDifficulty,
): NoBrainerHandRecord {
  const pool =
    difficulty === 'random' ? dataset : dataset.filter((row) => row.difficulty === difficulty);

  const source = pool.length > 0 ? pool : dataset;
  const index = Math.floor(Math.random() * source.length);
  return source[index];
}
