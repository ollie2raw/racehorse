import fs from 'node:fs';
import path from 'node:path';
import { isNoBrainerHand } from '../src/noBrainer/validator';
import type { Tile } from '../src/game/types';

type RawRow = { hand?: string[]; example?: string[] };

type ValidRow = {
  key: string;
  hand: string[];
  example: string[];
  line?: Array<{ tile: string; position: string }>;
};

type InvalidRow = {
  key: string;
  hand: string[];
  reason: string;
  line?: Array<{ tile: string; position: string }>;
};

function parseTile(raw: string): Tile | null {
  const match = String(raw ?? '')
    .trim()
    .match(/^(\d)\|(\d)$/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

function tileKey(tile: Tile): string {
  return `${tile.low}|${tile.high}`;
}

function handKey(hand: Tile[]): string {
  return hand
    .map(tileKey)
    .sort()
    .join(',');
}

function moveLineToJson(line: any[] | undefined): Array<{ tile: string; position: string }> | undefined {
  if (!Array.isArray(line)) return undefined;
  return line
    .filter((m) => m && m.type === 'play' && m.tile)
    .map((m) => ({
      tile: tileKey(m.tile as Tile),
      position: String((m as { position: unknown }).position),
    }));
}

function loadSourceRows(sourcePath: string): Array<{ hand: Tile[]; example: Tile[] }> {
  const text = fs.readFileSync(sourcePath, 'utf8');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: Array<{ hand: Tile[]; example: Tile[] }> = [];

  for (const line of lines) {
    let parsed: RawRow;
    try {
      parsed = JSON.parse(line) as RawRow;
    } catch {
      continue;
    }
    const hand = (Array.isArray(parsed.hand) ? parsed.hand : [])
      .map(parseTile)
      .filter((t): t is Tile => Boolean(t));
    const example = (Array.isArray(parsed.example) ? parsed.example : [])
      .map(parseTile)
      .filter((t): t is Tile => Boolean(t));
    if (hand.length !== 7) continue;
    rows.push({ hand, example });
  }

  return rows;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const sourcePath = path.join(repoRoot, 'client', 'public', 'no_brainer_hands.jsonl');
  const serverDataDir = path.join(repoRoot, 'server', 'data');
  const clientDataDir = path.join(repoRoot, 'client', 'public', 'data');

  const rawRows = loadSourceRows(sourcePath);
  const dedup = new Map<string, { hand: Tile[]; example: Tile[] }>();
  for (const row of rawRows) {
    dedup.set(handKey(row.hand), row);
  }
  const rows = [...dedup.values()];

  const valid: ValidRow[] = [];
  const invalid: InvalidRow[] = [];

  for (const row of rows) {
    const result = isNoBrainerHand(row.hand, { tilesPerPlayer: 7 });
    const key = handKey(row.hand);
    const hand = row.hand.map(tileKey).sort();
    const lineTiles = Array.isArray(result.line)
      ? result.line.filter((m) => m.type === 'play').map((m) => tileKey((m as any).tile as Tile))
      : [];
    const example = lineTiles.length === 7 ? lineTiles : row.example.map(tileKey);
    const line = moveLineToJson(result.line as any[]);
    if (result.ok) {
      valid.push({ key, hand, example, line });
    } else {
      invalid.push({
        key,
        hand,
        reason: result.reason ?? 'failed_validation',
        line,
      });
    }
  }

  valid.sort((a, b) => a.key.localeCompare(b.key));
  invalid.sort((a, b) => a.key.localeCompare(b.key));

  const validPath = path.join(serverDataDir, 'noBrainers.valid.json');
  const invalidPath = path.join(serverDataDir, 'noBrainers.invalid.json');
  const clientValidPath = path.join(clientDataDir, 'noBrainers.valid.json');

  writeJson(validPath, valid);
  writeJson(invalidPath, invalid);
  writeJson(clientValidPath, valid);

  // eslint-disable-next-line no-console
  console.log(
    `[no-brainer:validate] source=${rows.length} valid=${valid.length} invalid=${invalid.length} ` +
      `=> ${path.relative(repoRoot, validPath)}, ${path.relative(repoRoot, invalidPath)}`,
  );
}

main();
