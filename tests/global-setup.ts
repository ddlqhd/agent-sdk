import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const VITEST_TMP_ROOT = join(process.cwd(), '.vitest-tmp');

function createTestHomeDir(prefix: string): string {
  mkdirSync(VITEST_TMP_ROOT, { recursive: true });
  return mkdtempSync(join(VITEST_TMP_ROOT, prefix));
}

/**
 * Vitest global setup: redirect HOME/USERPROFILE to a temp directory and strip
 * provider base URL env vars so tests never read or write the developer machine.
 */
export default function globalSetup() {
  const testHome = createTestHomeDir('home-');

  process.env.AGENT_SDK_TEST_HOME = testHome;
  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;

  delete process.env.OPENAI_BASE_URL;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OLLAMA_BASE_URL;

  return () => {
    rmSync(testHome, { recursive: true, force: true });
    delete process.env.AGENT_SDK_TEST_HOME;
  };
}

export { createTestHomeDir, VITEST_TMP_ROOT };
