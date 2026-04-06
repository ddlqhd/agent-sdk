# Agent SDK 内置工具目录

本文档列出默认注册的内置工具（与 `ToolDefinition.name` 一致，可用 CLI `tools show <name>` 查看详情）。与 **`exclusiveTools` / `disallowedTools` / 同名覆盖** 相关的策略见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 第 3、4 节及 [`sdk-api-reference.md`](./sdk-api-reference.md)「替换内置工具」。

## 安全子集

- 源码中 **`isDangerous === true`** 的工具（当前主要为 **`Bash`**）可用 `getSafeBuiltinTools(skillRegistry)` 排除。
- **`getAllBuiltinTools`** 包含全部内置工具（含危险工具）。

## 按类别

### 文件系统 (filesystem)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `Read` | 读取文件内容（带行号，支持 offset/limit） | 否 |
| `Write` | 创建或覆盖文件 | 否 |
| `Edit` | 在文件中进行精确字符串替换 | 否 |
| `Glob` | 按 glob 模式查找文件 | 否 |

### Shell (shell)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `Bash` | 执行 shell 命令 | **是** |

### 搜索 (grep)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `Grep` | 在工作区内对文件内容做**正则**搜索（Node 逐文件逐行匹配；**不**调用外部 `rg`）。目录搜索时尊重搜索根目录下的 `.gitignore`；超长匹配行会围绕命中位置截断 | 否 |

### Web (web)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `WebFetch` | 抓取 URL 并返回可读 markdown | 否 |
| `WebSearch` | 设置 `TAVILY_API_KEY` 时通过 Tavily 搜索；未设置时返回提示配置 Tavily 的说明（`isError: true`） | 否 |

### 任务 (task)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `TaskCreate` | 创建会话任务 | 否 |
| `TaskUpdate` | 更新或完成任务 | 否 |
| `TaskList` | 列出任务 | 否 |

### 交互 (interaction)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `AskUserQuestion` | 向用户结构化提问（需宿主配置 `askUserQuestion`，见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 相关小节） | 否 |

### Skill (skill-activation)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `Skill` | 按名称调用已注册 Skill | 否 |

### Subagent (subagent)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `Agent` | 将工作委托给子代理（独立上下文） | 否 |

**Subagent 说明**：子代理默认**不**再暴露 `Agent` 工具（禁止嵌套）；并发、超时、危险工具等由 `AgentConfig.subagent` 控制。详见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 中 Subagent 小节。
