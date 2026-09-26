import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const homeDir = path.join(clientDir, 'src/assets/home');
const exports = [
  { source: 'newHOMEdailyfritz.webp', output: 'newHOMEdailyfritz-1x.webp', width: 400, height: 420, budget: 90_000 },
  { source: 'newHOMEdailyfritz.webp', output: 'newHOMEdailyfritz-2x.webp', width: 800, height: 840, budget: 90_000 },
  { source: 'homefinalpuzzle.webp', output: 'homefinalpuzzle-1x.webp', width: 420, height: 210, budget: 80_000 },
  { source: 'homefinalpuzzle.webp', output: 'homefinalpuzzle-2x.webp', width: 840, height: 420, budget: 80_000 },
];

const version = execFileSync('cwebp', ['-version'], { encoding: 'utf8' }).trim();
console.log(`cwebp ${version}; fixed quality 85, method 6, resize from approved sources`);
for (const asset of exports) {
  const source = path.join(homeDir, asset.source);
  const output = path.join(homeDir, 'mobile', asset.output);
  execFileSync('cwebp', ['-quiet', '-q', '85', '-m', '6', '-resize', String(asset.width), String(asset.height), source, '-o', output]);
  const bytes = statSync(output).size;
  if (bytes > asset.budget) throw new Error(`${asset.output} exceeds ${asset.budget} bytes: ${bytes}`);
  console.log(`${asset.output}: ${asset.width}x${asset.height}, ${bytes} bytes`);
}
