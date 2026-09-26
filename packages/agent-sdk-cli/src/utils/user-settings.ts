import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizeHttpBaseUrl } from './http-base-url.js';
import type { ModelProvider } from '../web/shared/ws-protocol.js';

const SETTINGS_FILENAME = 'agent-sdk-settings.json';
const MODEL_PROVIDERS = new Set<ModelProvider>(['openai', 'anthropic', 'ollama']);

export interface AgentDefaultModelSettings {
  provider?: ModelProvider;
  model?: string;
  /** Model API base URL (http/https). */
  baseUrl?: string;
  /** Model API key, stored in plaintext. */
  apiKey?: string;
  temperature?: number;
  thinking?: boolean;
  thinkingLevel?: 'low' | 'medium' | 'high';
}

export interface AgentBehaviorSettings {
  memory?: boolean;
  contextManagement?: boolean;
  contextLength?: number;
  mcpConfigPath?: string;
}

export interface WebSettingsSection {
  storage?: 'memory' | 'jsonl';
  safeToolsOnly?: boolean;
}

export interface UserSettings {
  version: 1;
  agentDefaultModel?: AgentDefaultModelSettings;
  agent?: AgentBehaviorSettings;
  web?: WebSettingsSection;
}

/** Patch fields: `null` deletes a previously persisted key. */
export interface AgentDefaultModelPatch {
  provider?: ModelProvider | null;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  temperature?: number | null;
  thinking?: boolean | null;
  thinkingLevel?: 'low' | 'medium' | 'high' | null;
}

export interface AgentBehaviorPatch {
  memory?: boolean | null;
  contextManagement?: boolean | null;
  contextLength?: number | null;
  mcpConfigPath?: string | null;
}

export interface WebSettingsPatch {
  storage?: 'memory' | 'jsonl' | null;
  safeToolsOnly?: boolean | null;
}

export interface UserSettingsPatch {
  version: 1;
  agentDefaultModel?: AgentDefaultModelPatch;
  agent?: AgentBehaviorPatch;
  web?: WebSettingsPatch;
}

interface SettingsFileV1 {
  version: 1;
  'agent-default-model'?: AgentDefaultModelSettings;
  agent?: AgentBehaviorSettings;
  web?: WebSettingsSection;
}

export function getUserSettingsPath(userBasePath?: string): string {
  const base = userBasePath && userBasePath.trim() !== '' ? userBasePath : homedir();
  return join(base, '.claude', SETTINGS_FILENAME);
}

function isModelProvider(value: unknown): value is ModelProvider {
  return typeof value === 'string' && MODEL_PROVIDERS.has(value as ModelProvider);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalHttpBaseUrl(value: unknown): string | undefined {
  const raw = asOptionalString(value);
  if (!raw) return undefined;
  return normalizeHttpBaseUrl(raw);
}

/**
 * `undefined` keeps a saved value. `null`, blank, or invalid deletes it.
 * `dropOnOmit` deletes on undefined too (provider changed, so the old secret must not be relabeled).
 */
function persistSecret(
  value: string | null | undefined,
  normalize: (raw: string) => string | undefined,
  dropOnOmit: boolean
): string | null | undefined {
  if (value === undefined) return dropOnOmit ? null : undefined;
  if (value === null) return null;
  return normalize(value) ?? null;
}

function parseAgentDefaultModel(raw: unknown): AgentDefaultModelSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const provider = isModelProvider(obj.provider) ? obj.provider : undefined;
  const model = asOptionalString(obj.model);
  const baseUrl = asOptionalHttpBaseUrl(obj.baseUrl);
  const apiKey = asOptionalString(obj.apiKey);
  const temperature = asOptionalFiniteNumber(obj.temperature);
  const thinking = typeof obj.thinking === 'boolean' ? obj.thinking : undefined;
  const thinkingLevel =
    obj.thinkingLevel === 'low' || obj.thinkingLevel === 'medium' || obj.thinkingLevel === 'high'
      ? obj.thinkingLevel
      : undefined;
  return mergeSection(undefined, { provider, model, baseUrl, apiKey, temperature, thinking, thinkingLevel });
}

function parseAgentBehavior(raw: unknown): AgentBehaviorSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const memory = typeof obj.memory === 'boolean' ? obj.memory : undefined;
  const contextManagement = typeof obj.contextManagement === 'boolean' ? obj.contextManagement : undefined;
  const contextLength = asOptionalFiniteNumber(obj.contextLength);
  const mcpConfigPath = asOptionalString(obj.mcpConfigPath);
  return mergeSection(undefined, {
    memory,
    contextManagement,
    contextLength: contextLength !== undefined && contextLength > 0 ? contextLength : undefined,
    mcpConfigPath
  });
}

function parseWebSection(raw: unknown): WebSettingsSection | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const storage = obj.storage === 'memory' || obj.storage === 'jsonl' ? obj.storage : undefined;
  const safeToolsOnly = typeof obj.safeToolsOnly === 'boolean' ? obj.safeToolsOnly : undefined;
  return mergeSection(undefined, { storage, safeToolsOnly });
}

/** Parse a settings document. Invalid JSON shape returns null (do not throw). */
export function parseUserSettings(raw: unknown): UserSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;
  return {
    version: 1,
    agentDefaultModel: parseAgentDefaultModel(obj['agent-default-model']),
    agent: parseAgentBehavior(obj.agent),
    web: parseWebSection(obj.web)
  };
}

export function loadUserSettings(userBasePath?: string): UserSettings | null {
  const path = getUserSettingsPath(userBasePath);
  try {
    const text = readFileSync(path, 'utf8');
    return parseUserSettings(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function toFileShape(settings: UserSettings): SettingsFileV1 {
  const file: SettingsFileV1 = { version: 1 };
  if (settings.agentDefaultModel) {
    file['agent-default-model'] = compact(settings.agentDefaultModel);
  }
  if (settings.agent) {
    file.agent = compact(settings.agent);
  }
  if (settings.web) {
    file.web = compact(settings.web);
  }
  return file;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null)
  ) as T;
}

function mergeSection<T extends object>(
  base: T | undefined,
  patch: { [K in keyof T]?: T[K] | null } | undefined
): T | undefined {
  if (!base && !patch) return undefined;
  const next: Record<string, unknown> = { ...(base as Record<string, unknown> | undefined) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) {
      delete next[key];
    } else if (value !== undefined) {
      next[key] = value;
    }
  }
  const cleaned = compact(next);
  return Object.keys(cleaned).length === 0 ? undefined : (cleaned as T);
}

export function mergeUserSettings(base: UserSettings | null, patch: UserSettingsPatch): UserSettings {
  return {
    version: 1,
    agentDefaultModel: mergeSection(base?.agentDefaultModel, patch.agentDefaultModel),
    agent: mergeSection(base?.agent, patch.agent),
    web: mergeSection(base?.web, patch.web)
  };
}

export function settingsFromConfigure(
  input: {
    provider: ModelProvider;
    model: string;
    /**
     * Non-empty http(s) URL without userinfo.
     * Omit keeps a saved URL; null, blank, or invalid deletes it.
     */
    baseUrl?: string | null;
    /**
     * Non-empty API key, stored in plaintext.
     * Omit keeps a saved key; null or blank deletes it.
     */
    apiKey?: string | null;
    temperature?: number;
    thinking?: boolean;
    thinkingLevel?: 'low' | 'medium' | 'high';
    memory?: boolean;
    contextManagement?: boolean;
    contextLength?: number;
    mcpConfigPath?: string;
    storage: 'memory' | 'jsonl';
    safeToolsOnly?: boolean;
  },
  previous?: UserSettings | null
): UserSettingsPatch {
  const previousProvider = previous?.agentDefaultModel?.provider;
  const providerChanged = previousProvider !== undefined && previousProvider !== input.provider;
  return {
    version: 1,
    agentDefaultModel: {
      provider: input.provider,
      model: input.model,
      baseUrl: persistSecret(input.baseUrl, normalizeHttpBaseUrl, providerChanged),
      apiKey: persistSecret(input.apiKey, (raw) => asOptionalString(raw), providerChanged),
      temperature: input.temperature ?? null,
      thinking: input.thinking ?? null,
      thinkingLevel: input.thinkingLevel ?? null
    },
    agent: {
      memory: input.memory,
      contextManagement: input.contextManagement,
      contextLength: input.contextLength ?? null,
      mcpConfigPath: asOptionalString(input.mcpConfigPath) ?? null
    },
    web: {
      storage: input.storage,
      safeToolsOnly: input.safeToolsOnly === true
    }
  };
}

export function saveUserSettings(userBasePath: string | undefined, settings: UserSettings): void {
  const path = getUserSettingsPath(userBasePath);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(toFileShape(settings), null, 2)}\n`;
  const tmp = join(dir, `.${SETTINGS_FILENAME}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
    try {
      chmodSync(path, 0o600);
    } catch {
      /* Windows may ignore mode */
    }
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function persistConfigureSettings(
  userBasePath: string | undefined,
  input: Parameters<typeof settingsFromConfigure>[0]
): void {
  const current = loadUserSettings(userBasePath);
  const next = mergeUserSettings(current, settingsFromConfigure(input, current));
  saveUserSettings(userBasePath, next);
}
