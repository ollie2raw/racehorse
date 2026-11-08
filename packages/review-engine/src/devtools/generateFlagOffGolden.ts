/** Prints the flag-off golden rows as JSON (see flagOffGoldenLib.ts). Run on the commit before the bounded path to produce the committed golden file. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { goldenRows } from './flagOffGoldenLib';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
process.stdout.write(`${JSON.stringify(goldenRows(dir), null, 1)}\n`);
