import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { resolveModelApiKey, resolveModelBaseUrl } from '../../packages/agent-sdk-cli/src/web/agent-factory.js';
import type { WebRuntimeDefaults } from '../../packages/agent-sdk-cli/src/web/agent-factory.js';
import { createWebCommand, resolveWebRuntimeDefaults } from '../../packages/agent-sdk-cli/src/commands/web.js';
import {
  applyPersistedModelDefaults,
  snapshotModelDefaults,
  withModelDefaults
} from '../../packages/agent-sdk-cli/src/web/model-defaults.js';
import { toUiDefaults } from '../../packages/agent-sdk-cli/src/web/ui-defaults.js';
import { baseUrlForLog, maskApiKey } from '../../packages/agent-sdk-cli/src/web/shared/log-utils.js';
import { resolveCliPackageRoot } from '../../packages/agent-sdk-cli/src/web/paths.js';
import {
  assertLoopbackBind,
  isAllowedWsOrigin,
  isImmediateClientMessage,
  isLoopbackListenHost,
  parseClientMessage,
  parseListenPort,
  resolveListenPort,
  resolveStaticFile
} from '../../packages/agent-sdk-cli/src/web/http-utils.js';
import { firstUserQuestionTitle, messagesToChatHistory } from '../../packages/agent-sdk-cli/src/web/shared/message-text.js';

function makeClientDist(): string {
  const root = mkdtempSync(join(tmpdir(), 'cli-web-static-'));
  writeFileSync(join(root, 'index.html'), '<html></html>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  return root;
}

describe('createWebCommand', () => {
  it('registers web with port, host, demo-tools, and allow-remote', () => {
    const cmd = createWebCommand();
    expect(cmd.name()).toBe('web');
    const longs = cmd.options.map((o) => o.long);
    expect(longs).toContain('--port');
    expect(longs).toContain('--host');
    expect(longs).toContain('--demo-tools');
    expect(longs).toContain('--allow-remote');
    expect(longs).toContain('--provider');
    expect(longs).toContain('--cwd');
    expect(longs).toContain('--exec-server');
    expect(longs).toContain('--exec-token');
    expect(longs).toContain('--user-base-path');
    expect(longs).not.toContain('--session');
    expect(longs).not.toContain('--resume');
    expect(longs).not.toContain('--temperature');
  });
});

describe('resolveCliPackageRoot', () => {
  it('finds @ddlqhd/agent-sdk-cli from src/web/paths.ts', () => {
    const root = resolveCliPackageRoot();
    expect(root.endsWith('packages/agent-sdk-cli')).toBe(true);
  });
});

describe('resolveListenPort', () => {
  it('prefers the flag, then PORT, then 3001', () => {
    expect(resolveListenPort(8123, '9')).toBe(8123);
    expect(resolveListenPort(undefined, '4455')).toBe(4455);
    expect(resolveListenPort(undefined, undefined)).toBe(3001);
    expect(resolveListenPort(undefined, '')).toBe(3001);
  });

  it('rejects invalid PORT values', () => {
    expect(() => parseListenPort('abc')).toThrow(/Invalid --port/);
    expect(() => resolveListenPort(undefined, '0')).toThrow(/Invalid --port/);
    expect(() => resolveListenPort(undefined, '70000')).toThrow(/Invalid --port/);
  });
});

describe('isAllowedWsOrigin', () => {
  it('allows loopback origins on the listen port', () => {
    expect(isAllowedWsOrigin('http://127.0.0.1:3001', '127.0.0.1', 3001, false)).toBe(true);
    expect(isAllowedWsOrigin('http://localhost:3001', '127.0.0.1', 3001, false)).toBe(true);
    expect(isAllowedWsOrigin(undefined, '127.0.0.1', 3001, false)).toBe(true);
  });

  it('rejects other sites and port mismatches', () => {
    expect(isAllowedWsOrigin('http://evil.example:3001', '127.0.0.1', 3001, false)).toBe(false);
    expect(isAllowedWsOrigin('http://127.0.0.1:4000', '127.0.0.1', 3001, false)).toBe(false);
    expect(isAllowedWsOrigin('http://192.168.1.5:3001', '127.0.0.1', 3001, false)).toBe(false);
  });

  it('skips checks when allowRemote is set', () => {
    expect(isAllowedWsOrigin('http://evil.example', '0.0.0.0', 3001, true)).toBe(true);
  });

  it('treats missing Origin as loopback-only', () => {
    expect(isAllowedWsOrigin(undefined, '0.0.0.0', 3001, false)).toBe(false);
    expect(isLoopbackListenHost('0.0.0.0')).toBe(false);
    expect(isLoopbackListenHost('127.0.0.1')).toBe(true);
  });
});

describe('resolveStaticFile', () => {
  const dist = makeClientDist();
  const sibling = join(dist, '..', `${dist.split('/').pop()}-backup`);
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(sibling, 'secret.txt'), 'nope');

  it('serves files under the client dist', () => {
    expect(resolveStaticFile(dist, '/')).toBe(join(dist, 'index.html'));
    expect(resolveStaticFile(dist, '/assets/app.js')).toBe(join(dist, 'assets', 'app.js'));
  });

  it('rejects directories, traversal, and bad encoding', () => {
    expect(resolveStaticFile(dist, '/assets')).toBeNull();
    expect(resolveStaticFile(dist, '/../secret.txt')).toBeNull();
    expect(resolveStaticFile(dist, `../${basename(sibling)}/secret.txt`)).toBeNull();
    expect(resolveStaticFile(dist, '/%2e%2e/secret.txt')).toBeNull();
    expect(resolveStaticFile(dist, '/%')).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('accepts a well-formed configure and chat', () => {
    const cfg = parseClientMessage({
      type: 'configure',
      provider: 'openai',
      model: 'gpt-4o',
      storage: 'jsonl'
    });
    expect(cfg.ok).toBe(true);
    if (cfg.ok && cfg.msg.type === 'configure') {
      expect(cfg.msg.persist).toBeUndefined();
    }
    const persisted = parseClientMessage({
      type: 'configure',
      provider: 'openai',
      model: 'gpt-4o',
      storage: 'jsonl',
      persist: true
    });
    expect(persisted.ok).toBe(true);
    if (persisted.ok && persisted.msg.type === 'configure') {
      expect(persisted.msg.persist).toBe(true);
    }
    const withUrl = parseClientMessage({
      type: 'configure',
      provider: 'openai',
      model: 'gpt-4o',
      storage: 'jsonl',
      baseUrl: ' https://api.example/v1/ '
    });
    expect(withUrl.ok).toBe(true);
    if (withUrl.ok && withUrl.msg.type === 'configure') {
      expect(withUrl.msg.baseUrl).toBe('https://api.example/v1/');
    }
    const cleared = parseClientMessage({
      type: 'configure',
      provider: 'openai',
      model: 'gpt-4o',
      storage: 'jsonl',
      baseUrl: null
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok && cleared.msg.type === 'configure') {
      expect(cleared.msg.baseUrl).toBeNull();
    }
    const withKey = parseClientMessage({
      type: 'configure',
      provider: 'openai',
      model: 'gpt-4o',
      storage: 'jsonl',
      apiKey: ' sk-test '
    });
    expect(withKey.ok).toBe(true);
    if (withKey.ok && withKey.msg.type === 'configure') {
      expect(withKey.msg.apiKey).toBe('sk-test');
    }
    const clearedKey = parseClientMessage({
      type: 'configure',
      provider: 'openai',
      model: 'gpt-4o',
      storage: 'jsonl',
      apiKey: null
    });
    expect(clearedKey.ok).toBe(true);
    if (clearedKey.ok && clearedKey.msg.type === 'configure') {
      expect(clearedKey.msg.apiKey).toBeNull();
    }
    const chat = parseClientMessage({ type: 'chat', text: 'hi', requestId: 'r1' });
    expect(chat.ok).toBe(true);
    const del = parseClientMessage({ type: 'sessions:delete', sessionId: 's1' });
    expect(del.ok).toBe(true);
    if (del.ok && del.msg.type === 'sessions:delete') {
      expect(del.msg.sessionId).toBe('s1');
    }
  });

  it('rejects unknown types and missing required fields', () => {
    expect(parseClientMessage({ type: 'sessions:resume' }).ok).toBe(false);
    expect(parseClientMessage({ type: 'sessions:delete' }).ok).toBe(false);
    expect(parseClientMessage({ type: 'chat', text: 'hi' }).ok).toBe(false);
    expect(parseClientMessage({ type: 'nope' }).ok).toBe(false);
    expect(parseClientMessage(null).ok).toBe(false);
    expect(
      parseClientMessage({
        type: 'configure',
        provider: 'openai',
        model: 'gpt-4o',
        storage: 'jsonl',
        baseUrl: 'ftp://files.example'
      }).ok
    ).toBe(false);
    expect(
      parseClientMessage({
        type: 'configure',
        provider: 'openai',
        model: 'gpt-4o',
        storage: 'jsonl',
        baseUrl: 'not a url'
      }).ok
    ).toBe(false);
    expect(
      parseClientMessage({
        type: 'configure',
        provider: 'openai',
        model: 'gpt-4o',
        storage: 'jsonl',
        apiKey: 1
      }).ok
    ).toBe(false);
    expect(
      parseClientMessage({
        type: 'configure',
        provider: 'openai',
        model: 'gpt-4o',
        storage: 'jsonl',
        baseUrl: 'https://user:pass@api.example/v1'
      }).ok
    ).toBe(false);
    expect(
      parseClientMessage({
        type: 'configure',
        provider: 'openai',
        model: 'gpt-4o',
        storage: 'jsonl',
        baseUrl: `https://api.example/${'a'.repeat(3000)}`
      }).ok
    ).toBe(false);
  });
});

describe('resolveModelBaseUrl', () => {
  it('prefers the page URL over the seeded default', () => {
    expect(
      resolveModelBaseUrl('openai', 'https://gateway.example/v1', {
        provider: 'openai',
        baseUrl: 'https://cli.example/v1'
      })
    ).toBe('https://gateway.example/v1');
  });

  it('keeps the seeded URL when configure omits baseUrl and the provider matches', () => {
    expect(
      resolveModelBaseUrl('openai', undefined, {
        provider: 'openai',
        baseUrl: 'https://cli.example/v1'
      })
    ).toBe('https://cli.example/v1');
  });

  it('ignores the seeded URL when the page clears it', () => {
    expect(
      resolveModelBaseUrl('openai', null, {
        provider: 'openai',
        baseUrl: 'https://cli.example/v1'
      })
    ).toBeUndefined();
  });

  it('does not apply a seeded URL for a different provider', () => {
    expect(
      resolveModelBaseUrl('anthropic', undefined, {
        provider: 'openai',
        baseUrl: 'https://cli.example/v1'
      })
    ).toBeUndefined();
  });
});

describe('resolveModelApiKey', () => {
  it('prefers the page API key over the seeded default', () => {
    expect(
      resolveModelApiKey('openai', 'sk-page', {
        provider: 'openai',
        apiKey: 'sk-cli'
      })
    ).toBe('sk-page');
  });

  it('keeps the seeded API key when configure omits it and the provider matches', () => {
    expect(
      resolveModelApiKey('openai', undefined, {
        provider: 'openai',
        apiKey: 'sk-cli'
      })
    ).toBe('sk-cli');
  });

  it('ignores the seeded API key when the page clears it', () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(
        resolveModelApiKey('openai', null, {
          provider: 'openai',
          apiKey: 'sk-cli'
        })
      ).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it('does not apply a seeded API key for a different provider', () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(
        resolveModelApiKey('anthropic', undefined, {
          provider: 'openai',
          apiKey: 'sk-openai'
        })
      ).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});

describe('resolveWebRuntimeDefaults', () => {
  it('uses a saved key and URL when the provider matches', () => {
    const defaults = resolveWebRuntimeDefaults(
      {},
      {
        version: 1,
        agentDefaultModel: {
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-saved',
          baseUrl: 'https://saved.example/v1'
        }
      },
      '/work',
      '/home'
    );
    expect(defaults.provider).toBe('openai');
    expect(defaults.apiKey).toBe('sk-saved');
    expect(defaults.baseUrl).toBe('https://saved.example/v1');
  });

  it('does not seed a saved key or URL for a different --provider', () => {
    const defaults = resolveWebRuntimeDefaults(
      { provider: 'anthropic' },
      {
        version: 1,
        agentDefaultModel: {
          provider: 'openai',
          apiKey: 'sk-saved',
          baseUrl: 'https://saved.example/v1'
        }
      },
      '/work',
      '/home'
    );
    expect(defaults.provider).toBe('anthropic');
    expect(defaults.apiKey).toBeUndefined();
    expect(defaults.baseUrl).toBeUndefined();
  });

  it('lets explicit flags override a saved key and URL', () => {
    const defaults = resolveWebRuntimeDefaults(
      { provider: 'anthropic', apiKey: 'sk-flag', baseUrl: 'https://flag.example' },
      {
        version: 1,
        agentDefaultModel: {
          provider: 'openai',
          apiKey: 'sk-saved',
          baseUrl: 'https://saved.example/v1'
        }
      },
      '/work',
      '/home'
    );
    expect(defaults.apiKey).toBe('sk-flag');
    expect(defaults.baseUrl).toBe('https://flag.example');
  });
});

describe('toUiDefaults', () => {
  it('sends a mask instead of the API key and drops userinfo from the URL', () => {
    const ui = toUiDefaults({
      cwd: '/work',
      userBasePath: '/home',
      provider: 'openai',
      apiKey: 'sk-test-plain-1234',
      baseUrl: 'https://user:pass@gateway.example/v1'
    });
    expect(ui.hasApiKey).toBe(true);
    expect(ui.apiKeyHint).toBe('…1234');
    expect(ui).not.toHaveProperty('apiKey');
    expect(ui.baseUrl).toBeUndefined();
    expect(JSON.stringify(ui)).not.toContain('sk-test-plain-1234');
    expect(JSON.stringify(ui)).not.toContain('user:pass');
  });

  it('omits the key hint when no key is configured', () => {
    const ui = toUiDefaults({ cwd: '/work', userBasePath: '/home' });
    expect(ui.hasApiKey).toBeUndefined();
    expect(ui.apiKeyHint).toBeUndefined();
  });
});

describe('model default seed', () => {
  const base: WebRuntimeDefaults = {
    cwd: '/work',
    userBasePath: '/home',
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-openai',
    baseUrl: 'https://openai.example/v1'
  };

  it('keeps an existing connection on its snapshot after another connection persists', () => {
    const defaults: WebRuntimeDefaults = { ...base };
    const connA = snapshotModelDefaults(defaults);
    // connection B switches provider and persists, rewriting the shared defaults
    applyPersistedModelDefaults(defaults, snapshotModelDefaults(defaults), {
      provider: 'anthropic',
      model: 'claude-x'
    });
    expect(withModelDefaults(defaults, connA)).toEqual({
      cwd: '/work',
      userBasePath: '/home',
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-openai',
      baseUrl: 'https://openai.example/v1'
    });
  });

  it('hands the persisted values to connections opened afterwards', () => {
    const defaults: WebRuntimeDefaults = { ...base };
    applyPersistedModelDefaults(defaults, snapshotModelDefaults(defaults), {
      provider: 'anthropic',
      model: 'claude-x',
      baseUrl: undefined,
      apiKey: undefined
    });
    const connC = withModelDefaults(defaults, snapshotModelDefaults(defaults));
    expect(connC.provider).toBe('anthropic');
    expect(connC.model).toBe('claude-x');
    expect(connC.apiKey).toBeUndefined();
    expect(connC.baseUrl).toBeUndefined();
    expect(connC.cwd).toBe('/work');
    expect(connC.userBasePath).toBe('/home');
  });

  it('refreshes the persisting connection own snapshot', () => {
    const defaults: WebRuntimeDefaults = { ...base };
    const connB = snapshotModelDefaults(defaults);
    applyPersistedModelDefaults(defaults, connB, {
      provider: 'anthropic',
      model: 'claude-x',
      apiKey: 'sk-ant',
      baseUrl: undefined
    });
    expect(connB.apiKey).toBe('sk-ant');
    expect(withModelDefaults(defaults, connB).apiKey).toBe('sk-ant');
  });
});

describe('secret log helpers', () => {
  it('logs only the host of a base URL', () => {
    expect(baseUrlForLog('https://user:pass@gateway.example:8443/v1')).toBe('gateway.example:8443');
    expect(baseUrlForLog('not a url')).toBe('(invalid)');
  });

  it('masks api keys and hides short values', () => {
    expect(maskApiKey('sk-test-plain-1234')).toBe('…1234');
    expect(maskApiKey('short')).toBe('••••');
  });
});

describe('isImmediateClientMessage', () => {
  it('bypasses the serial queue for cancel and ask-user replies', () => {
    expect(isImmediateClientMessage('cancel')).toBe(true);
    expect(isImmediateClientMessage('ask_user_question_reply')).toBe(true);
    expect(isImmediateClientMessage('chat')).toBe(false);
    expect(isImmediateClientMessage('chat_run')).toBe(false);
    expect(isImmediateClientMessage('configure')).toBe(false);
  });
});

describe('assertLoopbackBind', () => {
  it('refuses a non-loopback host without --allow-remote', () => {
    expect(() => assertLoopbackBind('0.0.0.0', 3001, false)).toThrow(/allow-remote/);
    expect(() => assertLoopbackBind('0.0.0.0', 3001, true)).not.toThrow();
    expect(() => assertLoopbackBind('127.0.0.1', 3001, false)).not.toThrow();
  });
});

describe('firstUserQuestionTitle', () => {
  it('uses the first user question and skips later turns', () => {
    expect(
      firstUserQuestionTitle([
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: '  帮我看看这段代码  ' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '再改一下' }
      ])
    ).toBe('帮我看看这段代码');
  });

  it('skips summary/rewind rows and empty user content', () => {
    expect(
      firstUserQuestionTitle([
        { $type: 'summary', content: 'old summary' },
        { role: 'user', content: '   ' },
        { role: 'user', content: [{ type: 'text', text: '第一问\n换行' }] }
      ])
    ).toBe('第一问 换行');
  });

  it('truncates long questions', () => {
    const title = firstUserQuestionTitle([{ role: 'user', content: '问'.repeat(100) }], 8);
    expect(title).toBe(`${'问'.repeat(8)}…`);
  });
});

describe('messagesToChatHistory', () => {
  it('includes assistant tool calls and later tool results', () => {
    expect(
      messagesToChatHistory([
        { role: 'user', content: '查一下 package.json' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'Read', arguments: { file_path: '/tmp/package.json' } }]
        },
        { role: 'tool', toolCallId: 'c1', name: 'Read', content: '{ "name": "app" }' },
        { role: 'assistant', content: '这是一个 app 包。' }
      ])
    ).toEqual([
      { role: 'user', text: '查一下 package.json' },
      {
        role: 'tool',
        id: 'c1',
        name: 'Read',
        status: 'result',
        arguments: { file_path: '/tmp/package.json' },
        result: '{ "name": "app" }'
      },
      { role: 'assistant', text: '这是一个 app 包。' }
    ]);
  });

  it('marks tool errors and skips system messages', () => {
    expect(
      messagesToChatHistory([
        { role: 'system', content: 'you are a helper' },
        {
          role: 'assistant',
          content: '先读文件',
          toolCalls: [{ id: 'c2', name: 'Read', arguments: { file_path: '/nope' } }]
        },
        { role: 'tool', toolCallId: 'c2', content: 'ENOENT', isError: true }
      ])
    ).toEqual([
      { role: 'assistant', text: '先读文件' },
      {
        role: 'tool',
        id: 'c2',
        name: 'Read',
        status: 'error',
        arguments: { file_path: '/nope' },
        result: 'ENOENT'
      }
    ]);
  });
});
