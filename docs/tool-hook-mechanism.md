# Agent SDK 工具调用 Hook 机制设计文档

## 读者指引

- **应用集成者**：若只需在项目里配置「工具执行前/后」要运行的命令（审计、格式化等），请优先阅读 **§2 配置文件**、**§2.7 环境变量**，以及 [`sdk-api-reference.md`](./sdk-api-reference.md) 中与 `HookManager`、`hookConfigDir` 相关的导出说明。不必阅读 **§4 模块设计**、**§9 实现要点**（内部实现）或 **§10.5**（源码路径）。
- **SDK 贡献者或深度排障**：可通读全文；源码树对照见 [`repository-layout.md`](./repository-layout.md)「Hook 实现位置」。

---

## 1. 概述

本设计文档描述了 Agent SDK 的工具调用 Hook 机制，参考 Claude Code 的实现，提供在工具执行前/后自定义控制行为的能力。

### 1.1 设计目标

- 支持配置文件（项目级/用户级）和代码两种方式设置 Hook
- 支持 Hook 的优先级机制和（代码 Hook 的）ID 覆盖
- 提供灵活的 Hook 执行流程，并与命令式 Hook 的 **stdin/退出码协议** 对齐，便于脚本化
- 与现有 `ToolRegistry`（含参数校验与 `outputHandler`）和 `Agent` 无缝集成

### 1.2 非目标（后续可扩展）

- 在 Hook 内嵌完整沙箱（命令 Hook 等同于用户在本机执行配置中的命令，见 §12）
- 远程 Hook 或 HTTP 型 Hook

---

## 2. 配置文件

### 2.1 配置文件位置

| 级别 | 路径 |
|------|------|
| 项目级 | `{项目目录}/.claude/settings.json` |
| 用户级 | `~/.claude/settings.json` |

### 2.2 配置格式

```json
{
  "disableAllHooks": false,
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "id": "project-security",
            "type": "command",
            "command": "python3 .claude/hooks/security_check.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "prettier --write \"$CLAUDE_TOOL_INPUT_FILE_PATH\""
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/error_handler.py"
          }
        ]
      }
    ]
  }
}
```

### 2.3 JSON 键与运行时类型的映射

`settings.json` 使用 **PascalCase** 事件键，与 TypeScript 中的 `HookEventType`（camelCase）对应关系如下。加载器在解析后 **必须** 转为运行时枚举：

| JSON 键 (`hooks` 下) | `HookEventType` |
|----------------------|-----------------|
| `PreToolUse` | `preToolUse` |
| `PostToolUse` | `postToolUse` |
| `PostToolUseFailure` | `postToolUseFailure` |

实现上建议定义 `HooksSettingsFile`（与磁盘 JSON 一致）与内部 `HooksSettings`（`Record<HookEventType, HookGroupConfig[]>`）两套类型，在 `loader.ts` 中完成转换。

### 2.4 配置字段说明

| 字段 | 类型 | 描述 |
|------|------|------|
| `disableAllHooks` | `boolean` | 见 §6.4、§10.2 |
| `hooks` | `object` | Hook 配置对象 |
| `hooks.PreToolUse` | `HookGroup[]` | 工具执行前的 Hook |
| `hooks.PostToolUse` | `HookGroup[]` | 工具执行成功后的 Hook |
| `hooks.PostToolUseFailure` | `HookGroup[]` | 工具执行失败后的 Hook |

### 2.5 HookGroup 结构

```typescript
interface HookGroup {
  /** 正则表达式匹配工具名称，可省略表示匹配所有，见 §9.1 */
  matcher?: string;
  /** Hook 列表 */
  hooks: CommandHook[];
}
```

### 2.6 CommandHook 结构

```typescript
interface CommandHook {
  /**
   * 可选。同一优先级层内用于去重/覆盖：后加载的同名 id 覆盖先加载的。
   * 配置文件中的 command hook 默认无 id；若需与用户层合并去重，应显式设置 id。
   */
  id?: string;
  /** Hook 类型，目前仅支持 command */
  type: 'command';
  /** 要执行的 shell 命令 */
  command: string;
  /** 超时时间（秒），默认 30 */
  timeout?: number;
  /**
   * 是否异步执行（不阻塞工具调用）。
   * 仅建议用于 Post* 阶段；异步命令若失败，应记录日志，不得影响已返回的工具结果，见 §9.5。
   */
  async?: boolean;
}
```

### 2.7 环境变量

在 command 中可使用以下环境变量（由执行器在启动子进程前注入）。工具参数名与 **Zod schema 字段名** 一致（如 `file_path` → `CLAUDE_TOOL_INPUT_FILE_PATH`）。

| 变量 | 描述 |
|------|------|
| `CLAUDE_TOOL_NAME` | 工具名称 |
| `CLAUDE_TOOL_CALL_ID` | 工具调用 ID（若可用） |
| `CLAUDE_PROJECT_DIR` | 项目根目录 |
| `CLAUDE_HOOK_EVENT` | 当前事件：`preToolUse` \| `postToolUse` \| `postToolUseFailure` |
| `CLAUDE_TOOL_INPUT_<KEY>` | 每个顶层参数一项，`<KEY>` 为参数名的 **大写蛇形**。例如 `file_path` → `CLAUDE_TOOL_INPUT_FILE_PATH`，`old_string` → `CLAUDE_TOOL_INPUT_OLD_STRING` |

此外，**stdin 协议**（§9.2）会传递完整 JSON，推荐脚本优先读 stdin，环境变量作辅助。

---

## 3. 核心类型定义

### 3.1 文件位置

`src/tools/hooks/types.ts`

### 3.2 类型列表

```typescript
import type { ToolResult } from '../../core/types.js';

/**
 * Hook 事件类型（运行时）
 */
export type HookEventType =
  | 'preToolUse'
  | 'postToolUse'
  | 'postToolUseFailure';

/**
 * Hook 执行上下文
 *
 * 不同阶段字段可用性：
 * - 所有阶段：`eventType`, `toolName`, `toolInput`, `toolCallId`, `timestamp`, `projectDir`
 * - PreToolUse：`toolInput` 为 **已通过 Zod 校验** 的参数对象
 * - PostToolUse：见 §6.5
 * - PostToolUseFailure：见 §6.5
 */
export interface HookContext {
  eventType: HookEventType;
  toolName: string;
  /** 已校验的工具参数 */
  toolInput: Record<string, unknown>;
  toolCallId?: string;
  timestamp: number;
  projectDir?: string;

  /**
   * PostToolUse：handler 返回的原始结果（未经 outputHandler）
   */
  toolResultRaw?: ToolResult;
  /**
   * PostToolUse：将返回给调用方的最终结果。
   * 若存在 outputHandler 且对内容做了处理，此处为 **处理之后** 的结果；否则与 toolResultRaw 相同。
   */
  toolResultFinal?: ToolResult;

  /**
   * PostToolUseFailure：失败原因简述（校验错误、异常信息、或业务 isError 说明）
   */
  errorMessage?: string;
  /**
   * PostToolUseFailure：失败分类，便于脚本与函数 Hook 分支
   */
  failureKind?: 'validation' | 'handler_throw' | 'tool_error';
}
```

### 3.3 Hook 执行结果

```typescript
/**
 * 仅 PreToolUse 阶段需要；Post* 阶段返回值忽略（见 §9.5）
 */
export interface HookResult {
  /** 是否允许继续执行工具 handler */
  allowed: boolean;
  /** 拒绝原因（展示给用户 / 模型） */
  reason?: string;
  /**
   * 对 toolInput 的增量覆盖；多段 Hook 按执行顺序 **浅合并**，后者覆盖同名字段。
   * 合并后的对象需再次满足工具 Zod schema（由 HookManager 在调用 handler 前执行 parse）
   */
  updatedInput?: Record<string, unknown>;
}
```

### 3.4 JavaScript 函数 Hook（代码设置方式）

```typescript
export interface FunctionHook {
  id: string;
  event: HookEventType;
  matcher?: string;
  handler: (context: HookContext) => Promise<HookResult | void>;
  description?: string;
}
```

### 3.5 Shell 命令 Hook 配置（配置文件方式）

与 §2.6 一致，运行时解析为 `CommandHookConfig`（字段相同）。

### 3.6 配置文件解析后的设置（内部）

```typescript
export interface HooksSettings {
  disableAllHooks?: boolean;
  hooks: Record<HookEventType, HookGroupConfig[]>;
}

export interface HookGroupConfig {
  matcher?: string;
  hooks: CommandHookConfig[];
}

export interface CommandHookConfig {
  id?: string;
  type: 'command';
  command: string;
  timeout?: number;
  async?: boolean;
}
```

---

## 4. 模块设计

### 4.1 文件结构

```
src/tools/hooks/
├── index.ts        # 导出模块
├── types.ts        # 类型定义
├── loader.ts       # 配置文件加载器
└── manager.ts      # Hook 管理器核心类
```

### 4.2 模块职责

| 文件 | 职责 |
|------|------|
| `types.ts` | 定义所有类型和接口 |
| `loader.ts` | 加载并解析 `settings.json`，完成 JSON 键 → `HookEventType` 映射 |
| `manager.ts` | Hook 管理、执行、优先级与 `updatedInput` 合并 |
| `index.ts` | 统一导出所有公共 API |

---

## 5. 公共 API

### 5.1 HookManager

```typescript
export class HookManager {
  constructor();

  /** 注册函数 Hook；与配置合并规则见 §6.3 */
  register(hook: FunctionHook): void;

  /** 移除指定 id 的函数 Hook */
  unregister(id: string): boolean;

  async loadProjectConfig(projectDir: string): Promise<void>;
  async loadUserConfig(): Promise<void>;
  async discoverAndLoad(projectDir?: string): Promise<void>;

  /** 运行时总开关；为 false 时跳过所有 Hook，见 §10.2 */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;

  async executePreToolUse(context: HookContext): Promise<HookResult>;
  async executePostToolUse(context: HookContext): Promise<void>;
  async executePostToolUseFailure(context: HookContext): Promise<void>;

  static create(): HookManager;
}
```

### 5.2 createFunctionHook

便于构造 `FunctionHook`（可选：对 `handler` 做轻量包装或默认字段）：

```typescript
export function createFunctionHook(config: {
  id: string;
  event: HookEventType;
  matcher?: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult | void>;
}): FunctionHook;
```

---

## 6. 执行流程

### 6.1 配置加载流程

```
Agent 创建
    ↓
HookManager.discoverAndLoad(projectDir)
    ├─ loadProjectConfig(projectDir)   → 项目级 hooks、disableAllHooks
    └─ loadUserConfig()                → 用户级 hooks、disableAllHooks
    ↓
合并规则（同一 id、同一 event）见 §6.3
    ↓
可选: register() 注册函数 Hook（同 id 覆盖见 §6.3；**执行顺序上**在合并后的 command 之后，见 §6.3）
```

### 6.2 工具执行流程（逻辑顺序）

与 `ToolRegistry.execute` 对齐的 **推荐** 插入点见 §6.5；此处为概念流程：

```
工具调用请求 ToolRegistry.execute(name, args)
    ↓
查找工具 → Zod 校验参数
    ↓ 校验失败
    PostToolUseFailure（failureKind: validation），返回错误结果
    ↓ 校验成功
PreToolUse（项目配置 → 用户配置 → 函数 Hook）
    ↓ allowed: false
    返回 { content: reason, isError: true }，不执行 handler
    ↓ allowed: true（合并 updatedInput 后作为最终参数）
执行 tool.handler(validatedArgs)
    ↓ 抛错
PostToolUseFailure（failureKind: handler_throw）
    ↓
handler 返回 ToolResult
    ↓ result.isError === true
PostToolUseFailure（failureKind: tool_error）
    ↓ 否则成功
可选 outputHandler 处理超长输出等 → 得到 toolResultFinal
PostToolUse（传入 toolResultRaw 与 toolResultFinal）
    ↓
返回 toolResultFinal
```

### 6.3 优先级与覆盖机制

**执行顺序**（同一事件、通过 matcher 的 Hook）：**项目级配置 → 用户级配置 → 函数 Hook**。

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1（先执行） | 项目级 | `{projectDir}/.claude/settings.json` |
| 2 | 用户级 | `~/.claude/settings.json` |
| 3（后执行） | 函数 Hook | `register()` |

**ID 覆盖（仅作用于「可标识」的 Hook）**：

- **函数 Hook**：必须以 `id` 唯一；同一 `HookManager` 内重复 `register` 同 id，后者覆盖前者。
- **配置文件中的 command hook**：若配置了 **`id`**，则在 **合并项目与用户两层配置** 时，**后加载层** 中相同 `id` + 相同 `event` 的条目 **替换** 先加载层的同 id 条目（便于用户覆盖项目默认脚本）。
- **未配置 `id` 的 command hook**：不做跨层去重，两层配置 **全部保留**，按「项目组 → 用户组」顺序展开后依次执行。

**PreToolUse 否决**：任一 Hook 返回 `allowed: false`，立即终止后续 Hook 与本工具 handler。

### 6.4 `disableAllHooks` 合并与运行时开关

见 §10.2。

### 6.5 与 ToolRegistry、outputHandler 的集成要点

实现 `ToolRegistry.execute` 时建议：

1. **PreToolUse 放在参数校验成功之后、handler 之前**，这样 `toolInput` 已满足 schema，且 Pre 可安全返回 `updatedInput` 再 `parse` 一次。
2. **PostToolUse** 在 **handler 成功**（未抛错且 `!result.isError`）且 **outputHandler 处理完成** 之后调用；上下文同时带上 `toolResultRaw`（handler 直接返回值）与 `toolResultFinal`（可能经 outputHandler 改写）。
3. **PostToolUseFailure** 在下列失败时调用：参数校验失败、handler 抛错、handler 返回 `isError: true`、**工具未注册**；`failureKind` 分别为 `validation`、`handler_throw`，后两类均为 `tool_error`（含未找到工具）。
4. MCP 等动态注册的工具名同样走 `toolName` 匹配（MCP 注册名形如 `mcp__<serverName>__<toolName>`，matcher 需写完整名）；matcher 为正则，见 §9.1。

---

## 7. 集成方案

### 7.1 ToolRegistry 集成

```typescript
export class ToolRegistry {
  private hookManager: HookManager | null = null;

  setHookManager(manager: HookManager | null): void;
  getHookManager(): HookManager | null;

  /** 第三参用于传入 `toolCallId`、`projectDir` 等 Hook 上下文（见 `ToolExecuteOptions`） */
  async execute(name: string, args: unknown, options?: ToolExecuteOptions): Promise<ToolResult>;
}
```

### 7.2 Agent 配置扩展

```typescript
export interface AgentConfig {
  hookManager?: HookManager;
  /** 解析项目级 settings 的目录，默认 `process.cwd()` */
  hookConfigDir?: string;
}
```

---

## 8. 使用示例

### 8.1 基础用法（自动加载配置）

```typescript
import { createAgent } from '@ddlqhd/agent-sdk';

const agent = createAgent({
  model: openaiAdapter,
  hookConfigDir: '/path/to/project'
});
```

### 8.2 手动创建 HookManager

```typescript
import { HookManager, createFunctionHook } from '@ddlqhd/agent-sdk';

const hookManager = HookManager.create();
await hookManager.discoverAndLoad('/path/to/project');

hookManager.register(createFunctionHook({
  id: 'security-check',
  event: 'preToolUse',
  matcher: 'Bash',
  handler: async ({ toolInput }) => {
    const command = toolInput.command as string;
    if (command.includes('rm -rf /')) {
      return {
        allowed: false,
        reason: '危险命令已被安全 Hook 阻止'
      };
    }
    return { allowed: true };
  }
}));

const agent = createAgent({
  model: openaiAdapter,
  hookManager
});
```

### 8.3 示例：自动格式化

见 §2.2；`Write` / `Edit` 的路径参数对应 `CLAUDE_TOOL_INPUT_FILE_PATH`。

### 8.4 示例：安全检查与 Python 脚本

`security_check.py` 应与 §9.2 **stdin/退出码协议** 一致；下列示例与协议对齐：

```python
#!/usr/bin/env python3
import json
import sys

def check_sensitive_files(file_path):
    sensitive = [".env", "secrets.yaml", "private_key.pem", ".ssh/id_rsa"]
    for s in sensitive:
        if s in file_path:
            return False, f"禁止修改敏感文件: {file_path}"
    return True, None

input_data = json.loads(sys.stdin.read())
tool_name = input_data.get('tool_name', '')
tool_input = input_data.get('tool_input', {})

if tool_name == 'Write':
    file_path = tool_input.get('file_path', '')
    allowed, reason = check_sensitive_files(file_path)
    if not allowed:
        print(json.dumps({"reason": reason}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)

sys.exit(0)
```

---

## 9. 实现要点

### 9.1 Matcher 匹配逻辑

`matcher` 为 **JavaScript 正则表达式源码**（不含定界符）。`Write|Edit` 表示匹配名为 `Write` 或 `Edit` 的工具。若工具名含正则元字符（如 `.`、`*`），需在配置中 **转义**。

```typescript
function matchTool(toolName: string, matcher?: string): boolean {
  if (!matcher || matcher === '*') return true;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return false;
  }
}
```

可选后续扩展：`matcherType: 'regex' | 'glob'`；首版仅支持 regex。

### 9.2 命令 Hook：stdin JSON 与退出码协议

所有 command Hook 子进程 **标准输入** 为单行或多行 **UTF-8 JSON**（实现可选用紧凑单行），结构如下：

```typescript
interface HookCommandStdin {
  hook_event: 'preToolUse' | 'postToolUse' | 'postToolUseFailure';
  tool_name: string;
  tool_call_id?: string;
  project_dir?: string;
  tool_input: Record<string, unknown>;
  /** 仅 Post* */
  tool_result_raw?: { content: string; isError?: boolean };
  tool_result_final?: { content: string; isError?: boolean };
  /** 仅 PostToolUseFailure */
  error_message?: string;
  failure_kind?: 'validation' | 'handler_throw' | 'tool_error';
}
```

**PreToolUse 结果（进程退出码）**：

| 退出码 | 含义 |
|--------|------|
| `0` | 允许继续执行工具 |
| `2` | **阻止**：禁止执行本次工具；**stderr** 应为 UTF-8 JSON：`{ "reason": string }` |
| 其他非 0 | 实现可视为「阻止」或「配置错误」；建议与 `2` 区分时统一记录日志 |

**Post* 命令**：退出码非 0 时记录 stderr，**不改变** 已产生的工具结果。

环境变量注入与 stdin 应 **同时** 提供，便于 shell 与脚本任选。

### 9.3 Command 执行与环境变量

```typescript
// 伪代码：为每个 tool_input 顶层键设置 CLAUDE_TOOL_INPUT_<UPPER_SNAKE>
function buildEnv(context: HookContext): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.CLAUDE_TOOL_NAME = context.toolName;
  if (context.toolCallId) env.CLAUDE_TOOL_CALL_ID = context.toolCallId;
  if (context.projectDir) env.CLAUDE_PROJECT_DIR = context.projectDir;
  env.CLAUDE_HOOK_EVENT = context.eventType;
  for (const [k, v] of Object.entries(context.toolInput)) {
    const key = 'CLAUDE_TOOL_INPUT_' + toUpperSnake(k);
    env[key] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return env;
}
```

### 9.4 PreToolUse：`updatedInput` 合并与再校验

实现中 **command** 子进程仅通过 **退出码** 表达 Pre 结果（见 §9.2），**不会**向运行时回传 `updatedInput`。**仅函数 Hook** 的返回值可包含 `updatedInput`，并在与 command 合并后的顺序中参与浅合并。

```typescript
async function executePreToolUse(context: HookContext): Promise<HookResult> {
  let workingInput = { ...context.toolInput };

  // 先依次执行合并后的 command PreHook（仅 allowed / deny）
  // 再依次执行函数 Hook（可返回 updatedInput）
  for (const hook of orderedHooksForPre()) {
    if (!matchTool(context.toolName, hook.matcher)) continue;

    const result = await runHook(hook, { ...context, toolInput: workingInput });
    if (result?.allowed === false) {
      return { allowed: false, reason: result.reason };
    }
    if (result?.updatedInput) {
      workingInput = { ...workingInput, ...result.updatedInput };
    }
  }

  return { allowed: true, updatedInput: workingInput };
}
```

`ToolRegistry` 在调用 handler 前对 `workingInput` 再次 `parameters.parse(workingInput)`，失败则视为 Pre 合并后校验错误，走 `PostToolUseFailure`（`validation`）并返回错误结果。

### 9.5 Post* 阶段错误处理

- 同步 command：`await` 完成；非 0 退出码 **仅日志**。
- `async: true`：**不 await** 结束；子进程未捕获错误应写入内部 logger，**不得** `unhandledRejection` 影响进程。
- 函数 Hook 在 Post* 中若 `throw`，同样 **记录日志**，不覆盖工具返回值。

---

## 10. 附录

### 10.1 目录结构

```
project/
├── .claude/
│   ├── settings.json
│   └── hooks/
│       ├── security_check.py
│       └── error_handler.py
├── src/
└── package.json
```

### 10.2 `disableAllHooks` 与 `setEnabled` 的优先级

生效顺序（从高到低，**后者不能推翻前者为「开」时的「关」**，仅说明「谁说了算」）：

1. **`HookManager.setEnabled(false)`**  
   运行时关闭：不执行任何 Hook，直至再次 `setEnabled(true)`。
2. **`setEnabled(true)` 时** 的配置合并：  
   - 若 **项目级或用户级** 任一方 `disableAllHooks === true`，则 **视为全局禁用配置文件中的 command/function 合并结果**（函数 Hook 仍注册在管理器内，但不执行）。  
   - 二者均为 `false` 或未设置时，按 §6.1 加载并执行。

若需「仅项目强制关闭、用户无法打开」，属于策略扩展，可在后续版本增加 `hooksPolicy: 'userMayOverride' | 'projectLocked'` 等字段。

### 10.3 跨平台说明

- **命令解释**：当前实现使用 `child_process.spawn(command, { shell: true })`（与「优先 `execFile`」的保守建议不同，便于与 Claude Code 式单行 `command` 字符串对齐）。Windows 需注意 `python` vs `python3`、引号与路径。
- 路径与引号：示例中 `"$CLAUDE_TOOL_INPUT_FILE_PATH"` 在 Unix shell 下展开；Windows 批处理需另行说明或使用 node 脚本。

### 10.4 内置工具名参考（当前仓库）

与 matcher 编写相关（节选）：`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`WebFetch`、`WebSearch`、`Skill` 等。第三方与 MCP 工具以运行时注册名为准；MCP 工具为 `mcp__<server>__<tool>` 形式。

### 10.5 源码路径（贡献者）

详见 [`repository-layout.md`](./repository-layout.md)「Hook 实现位置」。磁盘 `settings.json` 与运行时结构的键名映射见 **§2.3**；与 `ToolRegistry` / `outputHandler` 的衔接见正文相关小节。

---

## 11. 安全说明

- `settings.json` 中的 `command` 会在用户机器上执行，**等价于用户自行运行该命令**。仓库应只信任来源明确的配置。
- 建议团队将 `.claude/settings.json` 纳入代码审查；CI 可对 `command` 做允许路径前缀检查（可选功能）。
- PreToolUse 阻止执行时，**不得** 部分执行 handler。

---

## 12. 变更记录

| 版本 | 日期 | 变更说明 |
|------|------|------|
| 1.0.0 | 2026-03-29 | 初始版本 |
| 1.1.0 | 2026-03-29 | 完善 JSON 映射、HookContext（Post/Failure）、命令 stdin/退出码协议、与 outputHandler 集成顺序、`updatedInput` 合并、`disableAllHooks` 语义、可选 command `id`、安全与跨平台说明 |
