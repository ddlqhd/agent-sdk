import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(pkgDir, '..', 'package.json');

/** Published CLI package version, read from this package's `package.json`. */
export const PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }
).version;
