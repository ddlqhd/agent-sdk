import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_PACKAGE_NAME = '@ddlqhd/agent-sdk-cli';

/**
 * Walk up from `fromUrl` until the CLI package root (`package.json` name match).
 * Works from `src/web/*.ts` in development and from `dist/*.js` after tsup.
 */
export function resolveCliPackageRoot(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const name = JSON.parse(readFileSync(pkgPath, 'utf-8')).name as string;
        if (name === CLI_PACKAGE_NAME) {
          return dir;
        }
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate ${CLI_PACKAGE_NAME} package root from ${fromUrl}`);
}

/** Built Vite client (written after tsup by `vite build`). */
export function resolveWebClientDist(fromUrl: string = import.meta.url): string {
  return join(resolveCliPackageRoot(fromUrl), 'dist', 'web-client');
}
