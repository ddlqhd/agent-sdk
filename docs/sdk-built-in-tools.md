# Agent SDK 内置工具目录

本文档列出默认注册的内置工具（与 `ToolDefinition.name` 一致，可用 CLI `tools show <name>` 查看详情）。与 **`exclusiveTools` / `disallowedTools` / 同名覆盖** 相关的策略见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 第 3、4 节及 [`sdk-api-reference.md`](./sdk-api-reference.md)「替换内置工具」。

## 安全子集

- 源码中 **`isDangerous === true`** 的工具（当前主要为 **`Bash`**、**`BashKill`**）可用 `getSafeBuiltinTools(skillRegistry)` 排除。
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
| `Bash` | 执行 shell 命令（foreground 默认等待结束；`background: true` 时注册为后台任务并立即返回 `jobId`） | **是** |
| `BashList` | 列出当前进程内的后台 bash 任务（job id、pid、运行时、日志路径等） | 否 |
| `BashOutput` | 读取后台输出；`stream: all` 时 `sinceCursor`/`nextCursorCombinedApprox` 与 **`combinedCursorStale`** 配合使用；未知 id 返回 **`not_found`** | 否 |
| `BashKill` | 终止后台任务（SIGTERM → 宽限期 → SIGKILL）；任务记录随后移除 | **是** |

**后台任务**：`Bash` 传入 `background: true` 时使用 SDK 内进程表管理子进程，并可选用 `blockUntilMs` 在返回前短暂采集启动日志。可选 **`remove_job_on_exit: true`** 在子进程退出后立即从注册表移除（默认保留至 **`BashKill`**）。后台任务**不会**随 `Agent.stream` 的取消而自动结束，需调用 `BashKill` 或在 Node 进程退出时由 SDK 钩子清理。详见 [`bash-background-jobs.md`](./bash-background-jobs.md)。

### 搜索 (grep)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `Grep` | 在工作区内对文件内容做**正则**搜索（Node 逐文件逐行匹配；**不**调用外部 `rg`）。目录搜索时尊重搜索根目录下的 `.gitignore`；超长匹配行会围绕命中位置截断 | 否 |

### Web (web)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `WebFetch` | 抓取 URL 并返回可读 markdown | 否 |
| `WebSearch` | 设置 `TAVILY_API_KEY` 时通过 Tavily 搜索；未设置时返回提示配置 Tavily 的说明（`isError: true`） | 否 |

### 任务规划 (planning)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `TodoWrite` | 批量写入/更新完整 `todos` 列表（每项含 `content`、`status`；`activeForm` 可选）；多步任务结束前宜将全部项标为 `completed`；执行中可随时用新列表重规划 | 否 |

### 交互 (interaction)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `AskUserQuestion` | 向用户结构化提问（需宿主配置 `askUserQuestion`；`resolver(questions, { signal? })` 以支持与 `Agent.stream` 同源取消，见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 与 [`sdk-agent-loop.md`](./sdk-agent-loop.md)） | 否 |

### Skill (skill-activation)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `Skill` | 按名称调用已注册 Skill | 否 |

### Subagent (subagent)

| Tool | 说明 | Dangerous |
|------|------|-----------|
| `Agent` | 将工作委托给子代理（独立上下文） | 否 |

**Subagent 说明**：子代理默认**不**再暴露 `Agent` 工具（禁止嵌套）；并发、超时、危险工具等由 `AgentConfig.subagent` 控制。`subagent_type: explore` 时会追加只读优先的 system 片段，且在未指定 `allowed_tools` 与 `subagent.defaultAllowedTools` 时默认仅暴露 Read/Glob/Grep/WebFetch/WebSearch（以父级已注册工具为准）。详见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 中 Subagent 小节。
