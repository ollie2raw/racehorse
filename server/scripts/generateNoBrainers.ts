import fs from 'node:fs';
import path from 'node:path';
import { isNoBrainerHand } from '../src/noBrainer/validator';
import type { Tile } from '../src/game/types';

type GeneratedRow = {
  key: string;
  hand: string[];
  example: string[];
  line?: Array<{ tile: string; position: string }>;
};

function tileKey(tile: Tile): string {
  return `${tile.low}|${tile.high}`;
}

function handKey(hand: Tile[]): string {
  return hand
    .map(tileKey)
    .sort()
    .join(',');
}

function buildFullSet(maxPips = 6): Tile[] {
  const out: Tile[] = [];
  for (let high = 0; high <= maxPips; high++) {
    for (let low = 0; low <= high; low++) {
      out.push({ low, high });
    }
  }
  return out;
}

function randomHand(pool: Tile[], size = 7): Tile[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, size);
}

function moveLineToJson(line: any[] | undefined): Array<{ tile: string; position: string }> | undefined {
  if (!Array.isArray(line)) return undefined;
  return line
    .filter((m) => m && m.type === 'play' && m.tile)
    .map((m) => ({
      tile: tileKey((m as any).tile as Tile),
      position: String((m as { position: unknown }).position),
    }));
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const target = Math.max(1, Number.parseInt(process.argv[2] ?? '500', 10) || 500);
  const maxAttempts = Math.max(target * 500, 50_000);
  const tilePool = buildFullSet(6);
  const found = new Map<string, GeneratedRow>();
  let attempts = 0;

  while (found.size < target && attempts < maxAttempts) {
    attempts += 1;
    const hand = randomHand(tilePool, 7);
    const key = handKey(hand);
    if (found.has(key)) continue;
    const result = isNoBrainerHand(hand, { tilesPerPlayer: 7 });
    if (!result.ok) continue;

    const lineTiles = Array.isArray(result.line)
      ? result.line.filter((m) => m.type === 'play').map((m) => tileKey((m as any).tile as Tile))
      : [];
    const row: GeneratedRow = {
      key,
      hand: hand.map(tileKey).sort(),
      example: lineTiles.length === 7 ? lineTiles : hand.map(tileKey),
      line: moveLineToJson(result.line as any[]),
    };
    found.set(key, row);
  }

  const rows = [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
  const repoRoot = path.resolve(__dirname, '..', '..');
  const serverOut = path.join(repoRoot, 'server', 'data', 'noBrainers.generated.json');
  const clientOut = path.join(repoRoot, 'client', 'public', 'data', 'noBrainers.generated.json');

  writeJson(serverOut, rows);
  writeJson(clientOut, rows);

  // eslint-disable-next-line no-console
  console.log(
    `[no-brainer:generate] requested=${target} generated=${rows.length} attempts=${attempts} ` +
      `maxAttempts=${maxAttempts} => ${path.relative(repoRoot, serverOut)}`,
  );
}

main();
