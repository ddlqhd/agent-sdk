# Agent SDK CLI

命令行用于**快速试用** SDK 能力（模型、工具、会话、MCP），与 [`sdk-examples-index.md`](./sdk-examples-index.md) 中的 Web Demo 一样，属于演示与调试入口；应用集成仍应以代码中的 [`Agent`](./sdk-api-reference.md) 为准。

## 本地开发（本仓库）

先构建：

```bash
pnpm build
```

通过 `node` 运行 CLI：

```bash
# 查看帮助
node dist/cli/index.js --help

# 交互式聊天
node dist/cli/index.js chat --model openai --api-key sk-xxx

# 单次提问
node dist/cli/index.js run "What is the capital of France?" --model openai

# 列出可用工具
node dist/cli/index.js tools list

# 查看某工具详情（子命令为 show，不是 info）
node dist/cli/index.js tools show Read

# 列出会话
node dist/cli/index.js sessions list

# 连接 MCP 服务器（见下文「mcp」；当前 CLI 仅实现 connect）
node dist/cli/index.js mcp connect "npx @modelcontextprotocol/server-filesystem /path"
```

可在 `package.json` 中添加脚本：

```json
"scripts": {
  "cli": "node dist/cli/index.js"
}
```

然后使用 `pnpm cli tools list`。

## 通过 npm 安装后使用

全局安装（`npm install -g @ddlqhd/agent-sdk`）后可直接使用 `agent-sdk` 命令；项目内推荐 `npx`：

```bash
npx @ddlqhd/agent-sdk --help

# 聊天模式
npx @ddlqhd/agent-sdk chat --model openai --api-key sk-xxx

# 单次运行
npx @ddlqhd/agent-sdk run "List files in current directory" --model openai

# 工具管理
npx @ddlqhd/agent-sdk tools list
npx @ddlqhd/agent-sdk tools show Read
npx @ddlqhd/agent-sdk tools test Read -a "{}"
# 或长选项：--args（JSON 对象字符串）

# 会话管理（与 chat/run 使用相同存储时须传相同 --user-base-path）
npx @ddlqhd/agent-sdk sessions list
npx @ddlqhd/agent-sdk sessions show <session-id>
npx @ddlqhd/agent-sdk sessions checkpoints <session-id>
npx @ddlqhd/agent-sdk sessions rewind <session-id> --user-turn-index 0
npx @ddlqhd/agent-sdk sessions fork <source-id>
npx @ddlqhd/agent-sdk sessions delete <session-id>
npx @ddlqhd/agent-sdk sessions clear

# MCP（当前 CLI 仅提供 connect；运行时 MCP 多用 Agent 配置或 mcp_config.json）
npx @ddlqhd/agent-sdk mcp connect "npx @modelcontextprotocol/server-filesystem /path"
```

## 命令参考

### chat

启动交互式聊天会话。

```bash
agent-sdk chat [options]

选项:
  -m, --model <model>      模型提供商 (openai, anthropic, ollama)
  -k, --api-key <key>      API Key
  -u, --base-url <url>     基础 URL
  -M, --model-name <name>  模型名称
  -t, --temperature <num>  温度 (0-2)
  --max-tokens <num>       最大 Token 数
  -s, --session <id>       会话 ID
  -S, --system <prompt>    系统提示词
  --no-stream              禁用流式输出
  -v, --verbose            显示完整的工具调用参数和结果（调试模式）
  --mcp-config <path>      MCP 配置文件路径
  --user-base-path <path>  用户基础路径 (默认: ~)
  --cwd <path>             工作目录 (默认: 当前目录)
  --resume                 恢复最近更新的会话（与 chat/run 使用相同存储；若已设 -s 则忽略）
  --thinking [value]       模型统一 thinking/reasoning 开关（true|false；省略 value 等价 true）。
                           写入 `AgentConfig.modelConfig.thinking`。
  --thinking-level <lvl>   推理档位 low|medium|high，写入 `thinkingLevel`
                           （各 adapter 按需使用；Ollama 对应顶层 HTTP `think`）。
  --log-level <level>      Agent SDK 日志级别 (debug|info|warn|error|silent；chat/run 默认: info)
  --log-file <path>        SDK JSONL 日志文件路径（默认 <userBase>/.claude/logs/agent-sdk-<date>.log；
                           可被环境变量 AGENT_SDK_LOG_FILE 覆盖；--log-level=silent 时不写文件）
  --fork                   在 stream/run 前先 fork 当前会话（需 -s 或 --resume）
  --fork-checkpoint-id <id>  在 stream/run 前 fork 到指定 checkpoint
  --fork-user-turn-index <n> 在 stream/run 前 fork 到 0-based user turn
```

#### 交互式斜杠命令（chat）

输入 `/help` 查看完整列表。常用命令：

| 命令 | 说明 |
|------|------|
| `/help` | 命令表 |
| `/status` | 本地会话统计（model、tokens、checkpoints、最近一轮预览） |
| `/session` | 简短会话摘要 |
| `/sessions` | 交互式切换 JSONL 会话（编号 / id 前缀 / 预览过滤） |
| `/new` | 新会话（别名 `/clear`，仅 UI，不删磁盘旧文件） |
| `/checkpoints` | 可回退 user prompt 列表 |
| `/rewind <n>` | 回退到 0-based user turn，**终端自动重放**活动链 |
| `/fork` / `/fork <n>` | 分支会话（可选 checkpoint turn），重放历史 |
| `/details` | 切换运行时 verbose（等同 `-v`，无需重启） |
| `/compact` | 手动上下文压缩（需启用 `contextManagement`） |
| `/export [path]` | 导出活动链为 Markdown |
| `/editor` | 在 `$EDITOR` 中撰写下一条消息 |
| `/exit` | 退出（别名 `/quit`、`/q`） |

其他输入：

- `!cmd` — 在 agent `cwd` 执行 shell，输出附在下一条 user 消息前（TTY only，首次有安全提示）
- `/skill-name` — 调用已安装 skill（与内置斜杠命令区分：未知 `/foo` 会提示错误）

`--resume` / `-s` 恢复会话时，若有历史会自动重放终端对话。rewind/fork 后同样重放，与 Agent 内存一致。

### tui

全屏 Ink TUI（需安装可选依赖 `ink` 与 `react`）：

```bash
pnpm add ink react
agent-sdk tui [options]
```

选项与 `chat` 相同（`--resume`、`-s`、`--fork*` 等）。非 TTY 或缺少依赖时回退提示使用 `agent-sdk chat`。

**迁移（破坏性）**：原先的 `--ollama-think [value]` 已移除；请改用 `--thinking`（布尔）与 `--thinking-level`（档位）组合，语义与 SDK 字段 `thinking` / `thinkingLevel` 一致。

### run

单次运行并输出结果。

```bash
agent-sdk run <prompt> [options]

选项:
  -m, --model <model>      模型提供商
  -k, --api-key <key>      API Key
  -o, --output <format>    输出格式 (text, json)
  -v, --verbose            显示完整的工具调用参数和结果（调试模式）
  (其他选项同 chat)
```

### tools

管理工具列表。

```bash
agent-sdk tools list [options]       # 列出所有可用工具
agent-sdk tools show <tool-name>     # 查看工具详情（参数 schema 等）
agent-sdk tools test <tool-name>     # 用 JSON 参数试跑工具（-a / --args）

选项（list）:
  -f, --format <format>  输出格式 (table, json)
  -c, --category <cat>  按名称前缀或描述子串过滤（仅 list）

选项（test）:
  -a, --args <json>  工具参数（JSON 对象字符串）
```

`tools test` 的 `-a` / `--args` 为 JSON 对象字符串。未配置 `askUserQuestion` 时，`AskUserQuestion` 多为格式化文本而非真实交互。

### sessions

管理会话历史。

```bash
agent-sdk sessions list [options]           # 列出所有会话
agent-sdk sessions show <id>                  # 查看会话（默认活动链；--raw 含 summary/rewind 审计行）
agent-sdk sessions checkpoints <id>           # 列出可回退 user prompt（0-based userTurnIndex）
agent-sdk sessions rewind <id> [options]    # 磁盘回退（不 sync 其他进程中的 Agent 内存）
agent-sdk sessions fork <sourceId> [options]  # 分支新会话
agent-sdk sessions delete <id>                # 删除会话（可加 -f / --force 跳过确认）
agent-sdk sessions clear                      # 清空全部会话（可加 -f / --force 跳过确认）

list 选项:
  --user-base-path <path>  与 chat/run 一致，用于解析会话 JSONL 目录
  -f, --format <format>    输出格式 (table, json)
  -l, --limit <n>          列出会话条数上限（默认 20）
  --with-active            额外计算 Active 列（活动链消息数，较慢）

show 选项:
  --user-base-path <path>  同上
  -l, --limit <n>          展示消息条数上限（默认 50）
  --raw                    全量 append-only transcript（含 Compaction / Rewind 行）

checkpoints / rewind / fork 选项:
  --user-base-path <path>  同上
  -f, --format <format>    输出格式 (table, json)
  --checkpoint-id <id>       rewind 或 fork 到 checkpoint（三选一）
  --user-turn-index <n>      0-based user prompt 索引（三选一）
  --keep-through-raw-index <n>  raw JSONL 行号，须为 user 行（rewind；三选一）
  --new-id <id>              fork 目标 session id（可选，默认 UUID）

delete / clear 选项:
  --user-base-path <path>  同上
  -f, --force               跳过确认提示
```

注意：

- `sessions list` 的 **Entries** 为 raw JSONL 行数（含 summary/rewind），非活动消息条数。
- `sessions list` 的 `-f` 表示 **format**；`sessions delete` / `sessions clear` 的 `-f` 表示 **force**。
- 离线 `sessions rewind` 只改 JSONL；正在运行的 chat/web-demo 须用 `Agent.rewindToCheckpoint`（交互式 `/rewind` 或 web-demo UI）。

### mcp

当前 CLI **仅**提供一次性探测连接（连接后列出工具并退出，进程内不常驻）。

```bash
agent-sdk mcp connect <command> [options]

选项:
  -n, --name <name>   服务器名称 (默认: default)
  -a, --args <args>   命令参数，逗号分隔
  -e, --env <env>     环境变量，形如 KEY=VALUE，逗号分隔
```

应用内长期使用的 MCP 请通过 `Agent` 的 `mcpServers` 或 `loadMCPConfig` + `--mcp-config`（见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md)）。
