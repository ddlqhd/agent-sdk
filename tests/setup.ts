import { beforeEach } from 'vitest';

/**
 * Per-worker/per-file reinforcement: keep session/skill paths off the real home dir
 * and prevent shell OPENAI_* / ANTHROPIC_* overrides from leaking into unit tests.
 */
beforeEach(() => {
  const testHome = process.env.AGENT_SDK_TEST_HOME;
  if (testHome) {
    process.env.HOME = testHome;
    process.env.USERPROFILE = testHome;
  }

  delete process.env.OPENAI_BASE_URL;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OLLAMA_BASE_URL;
});
