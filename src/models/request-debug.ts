/**
 * When `AGENT_SDK_DEBUG_MODEL_REQUEST` is set to `1`, `true`, or `yes` (case-insensitive),
 * model adapters log the JSON request body to stderr before each HTTP call.
 * Use this to verify tools / JSON Schema sent to the provider.
 */
const TRUTHY = /^(1|true|yes)$/i;

export function isModelRequestDebugEnabled(): boolean {
  const raw = process.env.AGENT_SDK_DEBUG_MODEL_REQUEST;
  if (raw === undefined || raw === '') {
    return false;
  }
  return TRUTHY.test(String(raw).trim());
}

/**
 * @param provider - e.g. `openai`, `anthropic`, `ollama`
 * @param path - request path (e.g. `/chat/completions`)
 * @param body - object that will be JSON.stringify’d for the request
 */
export function debugLogModelRequestBody(provider: string, path: string, body: unknown): void {
  if (!isModelRequestDebugEnabled()) {
    return;
  }
  const prefix = `[agent-sdk][model-request][${provider}] ${path}`;
  try {
    const json =
      body !== null && typeof body === 'object'
        ? JSON.stringify(body, null, 2)
        : JSON.stringify(body);
    console.error(`${prefix}\n${json}`);
  } catch {
    console.error(prefix, body);
  }
}
