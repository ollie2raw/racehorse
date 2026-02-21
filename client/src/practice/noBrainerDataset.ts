import type { Tile } from "../types";

export type PracticeDifficulty = "random" | "easy" | "hard" | "insane";

export interface NoBrainerHandRecord {
  hand: Tile[];
  example: Tile[];
  difficulty: Exclude<PracticeDifficulty, "random">;
  key: string;
}

let cachedDatasetPromise: Promise<NoBrainerHandRecord[]> | null = null;

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

function classifyDifficulty(key: string): Exclude<PracticeDifficulty, "random"> {
  const bucket = hashString(key) % 100;
  if (bucket < 34) return "easy";
  if (bucket < 70) return "hard";
  return "insane";
}

export async function loadNoBrainerDataset(): Promise<NoBrainerHandRecord[]> {
  if (cachedDatasetPromise) return cachedDatasetPromise;

  cachedDatasetPromise = fetch("/no_brainer_hands.jsonl")
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Unable to load dataset: ${res.status}`);
      }
      const text = await res.text();
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const rows: NoBrainerHandRecord[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { hand?: string[]; example?: string[] };
          const handRaw = Array.isArray(parsed.hand) ? parsed.hand : [];
          const exampleRaw = Array.isArray(parsed.example) ? parsed.example : [];
          const hand = handRaw.map(parseTile).filter((t): t is Tile => Boolean(t));
          const example = exampleRaw.map(parseTile).filter((t): t is Tile => Boolean(t));
          if (hand.length !== 7 || example.length !== 7) continue;
          const key = hand.map(t => `${t.low}|${t.high}`).sort().join(",");
          rows.push({
            hand,
            example,
            key,
            difficulty: classifyDifficulty(key),
          });
        } catch {
          // Skip malformed lines.
        }
      }

      if (rows.length === 0) {
        throw new Error("Dataset is empty or malformed.");
      }

      return rows;
    });

  return cachedDatasetPromise;
}

export function pickNoBrainerHand(
  dataset: NoBrainerHandRecord[],
  difficulty: PracticeDifficulty
): NoBrainerHandRecord {
  const pool = difficulty === "random"
    ? dataset
    : dataset.filter(row => row.difficulty === difficulty);

  const source = pool.length > 0 ? pool : dataset;
  const index = Math.floor(Math.random() * source.length);
  return source[index];
}
