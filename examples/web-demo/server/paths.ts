import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const serverDir = dirname(fileURLToPath(import.meta.url));

/** examples/web-demo */
export const WEB_DEMO_ROOT = join(serverDir, '..');

/** agent-sdk repository root (parent of examples/) */
export const SDK_ROOT = join(WEB_DEMO_ROOT, '..', '..');

export const DEMO_FIXTURES = join(WEB_DEMO_ROOT, 'demo-fixtures');

export const CLIENT_DIST = join(WEB_DEMO_ROOT, 'client', 'dist');
