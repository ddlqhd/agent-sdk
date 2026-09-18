import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { isNonBlankString } from '../../utils/index.js';
import type { HookEventType, HooksSettings, HooksSettingsFile } from './types.js';

const EVENT_JSON_TO_RUNTIME: Record<string, HookEventType> = {
  PreToolUse: 'preToolUse',
  PostToolUse: 'postToolUse',
  PostToolUseFailure: 'postToolUseFailure'
};

function emptyHooksSettings(): HooksSettings {
  return {
    hooks: {
      preToolUse: [],
      postToolUse: [],
      postToolUseFailure: []
    }
  };
}

/**
 * 将磁盘 settings.json 转为内部 HooksSettings（PascalCase → HookEventType）
 */
export function parseHooksSettingsFile(raw: unknown): HooksSettings {
  if (!raw || typeof raw !== 'object') {
    return emptyHooksSettings();
  }

  const file = raw as HooksSettingsFile;
  const base = emptyHooksSettings();
  base.disableAllHooks = file.disableAllHooks;

  if (!file.hooks || typeof file.hooks !== 'object') {
    return base;
  }

  for (const [jsonKey, eventType] of Object.entries(EVENT_JSON_TO_RUNTIME)) {
    const groups = (file.hooks as Record<string, unknown>)[jsonKey];
    if (!Array.isArray(groups)) continue;

    for (const g of groups) {
      if (!g || typeof g !== 'object') continue;
      const group = g as { matcher?: string; hooks?: unknown };
      const hookList = Array.isArray(group.hooks) ? group.hooks : [];
      const normalized: typeof base.hooks.preToolUse[0] = {
        matcher: typeof group.matcher === 'string' ? group.matcher : undefined,
        hooks: []
      };

      for (const h of hookList) {
        if (!h || typeof h !== 'object') continue;
        const c = h as Record<string, unknown>;
        if (c.type !== 'command' || typeof c.command !== 'string') continue;
        normalized.hooks.push({
          id: typeof c.id === 'string' ? c.id : undefined,
          type: 'command',
          command: c.command,
          if: typeof c.if === 'string' ? c.if : undefined,
          timeout: typeof c.timeout === 'number' ? c.timeout : undefined,
          async: typeof c.async === 'boolean' ? c.async : undefined
        });
      }

      if (normalized.hooks.length > 0) {
        base.hooks[eventType].push(normalized);
      }
    }
  }

  return base;
}

/**
 * 读取并解析项目级 `.claude/settings.json`
 */
export async function loadHooksSettingsFromProject(projectDir: string): Promise<HooksSettings> {
  const path = join(projectDir, '.claude', 'settings.json');
  try {
    const text = await readFile(path, 'utf-8');
    const json = JSON.parse(text) as unknown;
    return parseHooksSettingsFile(json);
  } catch {
    return emptyHooksSettings();
  }
}

/**
 * 读取并解析用户级 `{userBasePath}/.claude/settings.json`。
 * `userBasePath` 省略时与 {@link AgentConfig.userBasePath} 默认行为一致，使用 `os.homedir()`。
 */
export async function loadHooksSettingsFromUser(userBasePath?: string): Promise<HooksSettings> {
  const base = isNonBlankString(userBasePath) ? userBasePath : homedir();
  const path = join(base, '.claude', 'settings.json');
  try {
    const text = await readFile(path, 'utf-8');
    const json = JSON.parse(text) as unknown;
    return parseHooksSettingsFile(json);
  } catch {
    return emptyHooksSettings();
  }
}
