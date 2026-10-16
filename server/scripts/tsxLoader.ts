import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * file:// URL of the tsx ESM loader, resolved from THIS repository's dependency tree, for `node --import <url>`.
 * Scripts that spawn the real server from a temporary cwd cannot use the bare specifier `--import tsx`
 * (resolution starts at the cwd), and must not hardcode a developer machine path.
 */
export function tsxLoaderUrl(): string {
  const requireFromServer = createRequire(join(__dirname, '..', 'package.json'));
  return pathToFileURL(join(dirname(requireFromServer.resolve('tsx/package.json')), 'dist', 'loader.mjs')).href;
}
