import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const noOpCatch = /catch\s*\{\s*\}|\.catch\(\(\)\s*=>\s*\{\s*\}\)|\.catch\(\(\)\s*=>\s*undefined\)/s;

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

describe('non-blocking operational failure guardrails', () => {
  it('keeps the four audited gameplay secondary failures observable', async () => {
    const expectations = [
      ['server/src/multiplayer/disconnectGrace.ts', 'multiplayer.disconnect_rejoin_room_lookup'],
      ['server/src/http/routes/dailyPuzzle.ts', 'daily_puzzle.activity_write'],
      ['server/src/http/routes/dailyFritz.ts', 'daily_fritz.activity_write'],
      ['client/src/multiplayer/MultiplayerGameShell.tsx', 'multiplayer.post_match_recording'],
    ] as const;

    for (const [file, scope] of expectations) {
      const contents = await source(file);
      expect(contents, file).toContain(scope);
      expect(contents, file).not.toMatch(noOpCatch);
    }
  });
});
