# Agent SDK CLI

命令行用于**快速试用** SDK 能力（模型、工具、会话、MCP、Web UI），与 [`sdk-examples-index.md`](./sdk-examples-index.md) 中的 Web UI 一样，属于演示与调试入口；应用集成仍应以代码中的 [`Agent`](./sdk-api-reference.md) 为准。

## 本地开发（本仓库）

首次 clone 后：

```bash
pnpm install
pnpm build
```

通过 `pnpm cli` 或 `agent-sdk` 运行 CLI（与 npm 安装后的命令相同）：

```bash
# 查看帮助
pnpm cli --help

# 交互式聊天
pnpm cli chat --provider openai --api-key sk-xxx

# 单次提问（headless）
pnpm cli -p "What is the capital of France?" --provider openai --bare

# 本地 Web UI
pnpm cli web

# 列出可用工具
pnpm cli tools list

# 查看某工具详情（子命令为 show，不是 info）
pnpm cli tools show Read

# 列出会话
pnpm cli sessions list

# 连接 MCP 服务器（见下文「mcp」；当前 CLI 仅实现 connect）
pnpm cli mcp connect "npx @modelcontextprotocol/server-filesystem /path"

# 等价写法（本仓库根目录请用 pnpm cli；npm 安装后可用 pnpm exec agent-sdk 或 agent-sdk）
pnpm exec agent-sdk tools list
```

未构建时 CLI 会提示执行 `pnpm build`。调试/CI 也可显式使用 `node packages/agent-sdk-cli/dist/index.js ...`。

### 贡献者全局 link

若需在仓库外目录直接调用 CLI：

```bash
pnpm build
pnpm --filter @ddlqhd/agent-sdk-cli link --global
agent-sdk chat --provider openai
```

## 通过 npm 安装后使用

CLI 是独立包 **`@ddlqhd/agent-sdk-cli`**（会依赖 `@ddlqhd/agent-sdk`）。全局安装：

```bash
npm install -g @ddlqhd/agent-sdk-cli
```

之后可直接使用 `agent-sdk` 命令；项目内推荐 `npx`：

```bash
npx @ddlqhd/agent-sdk-cli --help

# 聊天模式
npx @ddlqhd/agent-sdk-cli chat --provider openai --api-key sk-xxx

# 单次运行（headless / print 模式）
npx @ddlqhd/agent-sdk-cli -p "List files in current directory" --provider openai --bare

# 工具管理
npx @ddlqhd/agent-sdk-cli tools list
npx @ddlqhd/agent-sdk-cli tools show Read
npx @ddlqhd/agent-sdk-cli tools test Read -a "{}"
# 或长选项：--args（JSON 对象字符串）

# 会话管理（与 chat/-p 使用相同存储时须传相同 --user-base-path）
npx @ddlqhd/agent-sdk-cli sessions list
npx @ddlqhd/agent-sdk-cli sessions show <session-id>
npx @ddlqhd/agent-sdk-cli sessions checkpoints <session-id>
npx @ddlqhd/agent-sdk-cli sessions rewind <session-id> --user-turn-index 0
npx @ddlqhd/agent-sdk-cli sessions fork <source-id>
npx @ddlqhd/agent-sdk-cli sessions delete <session-id>
npx @ddlqhd/agent-sdk-cli sessions clear

# 本地 Web UI（HTTP + WebSocket，默认 http://127.0.0.1:3001）
npx @ddlqhd/agent-sdk-cli web

# MCP（当前 CLI 仅提供 connect；运行时 MCP 多用 Agent 配置或 mcp_config.json）
npx @ddlqhd/agent-sdk-cli mcp connect "npx @modelcontextprotocol/server-filesystem /path"
```

## HTTP 代理

CLI 启动时会读取壳环境里的代理变量，并安装到 Node `fetch`（模型请求、`WebFetch` / Tavily 等走同一套）：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
# 可选：直连名单（逗号或空格分隔；`*` 表示全部直连）
export NO_PROXY=localhost,127.0.0.1
```

优先级：`https_proxy` → `HTTPS_PROXY` → `http_proxy` → `HTTP_PROXY`。小写与大写变体都有效。不支持 SOCKS（以及非法 URL）时会在 stderr 打 `CLI proxy:` 警告并忽略。`NO_PROXY` 在包装层直连，不经过代理。Node 自带 `fetch` 默认不读这些变量，因此 CLI 会把 `globalThis.fetch` 换成依赖里的 `undici.fetch` 并挂上真正的 `ProxyAgent`（不会改 Node 内置 dispatcher）。仅 `export` 而不走本 CLI 入口时，库代码里的 `fetch` 仍可能直连。

## 命令参考

### chat

启动交互式聊天会话。

```bash
agent-sdk chat [options]

选项:
  --provider <provider>    模型提供商 (openai, anthropic, ollama；默认 openai)
  -m, --model <model>      模型 ID（如 gpt-4o、claude-sonnet-4）
  -k, --api-key <key>      API Key
  -u, --base-url <url>     基础 URL
  -M, --model-name <name>  已弃用，等同 `--model`（help 中隐藏）
  -t, --temperature <num>  温度 (0-2)
  --max-tokens <num>       最大 Token 数
  -s, --session <id>       会话 ID
  -S, --system <prompt>    系统提示词
  --no-stream              禁用流式输出
  -v, --verbose            显示完整的工具调用参数和结果（调试模式）
  --mcp-config <path>      MCP 配置文件路径
  --user-base-path <path>  用户基础路径 (默认: ~)
  --cwd <path>             工作目录 (默认: 当前目录)
  --exec-server <url>      远程 exec-server WebSocket（如 ws://host:8787）
  --exec-token <token>     exec-server 共享 token
  --resume, --continue     恢复最近更新的会话（与 chat/-p 使用相同存储；若已设 -s 则忽略）
  --thinking [value]       模型统一 thinking/reasoning 开关（true|false；省略 value 等价 true）。
                           写入 `AgentConfig.modelConfig.thinking`。
  --thinking-level <lvl>   推理档位 low|medium|high，写入 `thinkingLevel`
                           （各 adapter 按需使用；Ollama 对应顶层 HTTP `think`）。
  --log-level <level>      Agent SDK 日志级别 (debug|info|warn|error|silent；chat/-p 默认: info)
  --log-file <path>        SDK JSONL 日志文件路径（默认 <userBase>/.claude/logs/agent-sdk-<date>.log；
                           可被环境变量 AGENT_SDK_LOG_FILE 覆盖；--log-level=silent 时不写文件）
  --fork                   在 stream/-p 前先 fork 当前会话（需 -s 或 --resume）
  --fork-checkpoint-id <id>  在 stream/-p 前 fork 到指定 checkpoint
  --fork-user-turn-index <n> 在 stream/-p 前 fork 到 0-based user turn
```

`--model` 表示模型 ID，`--provider` 表示适配器。旧写法 `--model openai|anthropic|ollama`（以及隐藏的 `--model-name`）仍可用一轮，但会在 stderr 给出弃用警告。

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

全屏 Ink TUI（`optionalDependencies`：`ink`、`react`；本仓库 devDependencies 已包含以便构建）：

```bash
# 消费者若未自动安装可选依赖：
pnpm add ink react

agent-sdk tui [options]
```

选项与 `chat` 相同（`--resume`、`-s`、`--fork*` 等）。支持流式对话、Esc 中断流式输出。

**斜杠下拉**：输入 `/` 唤起内置命令与可 invoke 的 Skills 列表；`↑↓` 选择；`Tab` 或 `Enter` **仅补全**到输入框（不立即执行）；补全后再次 `Enter` 才发送。带参命令（如 `/rewind`）补全后保留尾随空格。

**状态栏**（header 下方常驻）：`sess`（会话短 id）、`msgs`（活跃消息数）、`chk`（checkpoint 数）、`in`/`out`（累计 token）、`verbose`、`streaming…`。

**消息块**（OpenCode 风格）：每条消息为左侧色条块，无 `user:`/`assistant:` 前缀。user / thinking 为灰色边框；assistant 为青色；工具调用为黄色、`Name: value` 摘要；工具结果为绿色 dim、`Result:` 前缀；工具错误为红色、`Error: message`。流式 thinking 与 assistant 缓冲使用相同块样式。

**工具输出**：流式与历史重放均显示工具调用与结果（非 verbose 截断参数与结果，与 `chat` 流式一致）；`/details` 切换 verbose 后下次对话展示完整参数与结果。输入提示符为 `>`。

**模态**（Esc 关闭）：

| 命令 | 操作 |
|------|------|
| `/help` | 命令列表 |
| `/status`、`/session` | 完整会话状态 |
| `/sessions` | ↑↓ 选择会话，Enter 切换并重放 |
| `/checkpoints` | ↑↓ 选择，Enter 回退 |

非 TTY 或缺少 `ink`/`react` 时提示使用 `agent-sdk chat`。

**迁移（破坏性）**：原先的 `--ollama-think [value]` 已移除；请改用 `--thinking`（布尔）与 `--thinking-level`（档位）组合，语义与 SDK 字段 `thinking` / `thinkingLevel` 一致。

### web

本地 **Agent Studio** Web UI：同一进程提供静态页面与 WebSocket `/ws`。浏览器不接触 API Key；密钥走服务端环境变量或 `--api-key`。

```bash
# 默认 http://127.0.0.1:3001（与 chat 共用 cwd / userBasePath / 会话目录）
agent-sdk web

agent-sdk web --provider openai --model gpt-4o --port 3001
agent-sdk web --cwd . --user-base-path ~ --mcp-config mcp_config.json
agent-sdk web --demo-tools   # 额外注册 DemoCalculator 示例工具
```

`web` 只暴露它实际会用到的 flags（没有 chat 的 `--session` / `--thinking` 等）：

```bash
agent-sdk web [options]

选项:
  --port <port>            监听端口（默认 3001，或环境变量 PORT）
  --host <host>            监听地址（默认 127.0.0.1）
  --allow-remote           允许绑定非回环地址，并关闭 WebSocket Origin 校验（危险）
  --demo-tools             注册 DemoCalculator 示例工具
  --provider <provider>    模型提供商（写入 UI 默认值）
  -m, --model <model>      模型 ID（写入 UI 默认值）
  -k, --api-key <key>      API Key（仅服务端使用）
  -u, --base-url <url>     仅当 UI 仍使用上述 --provider 时生效
  --mcp-config <path>      MCP 配置文件（UI 未填路径时使用）
  --user-base-path <path>  用户基础路径（默认: ~；jsonl 会话与 CLI 相同）
  --cwd <path>             工作目录（默认: 当前目录）
  --exec-server <url>      远程 exec-server（见 [`sdk-exec-server.md`](./sdk-exec-server.md)）
  --exec-token <token>     exec-server token
  --log-level / --log-file 同 chat
```

### exec-server

在工作区机器上启动执行面（文件系统 / 进程 / HTTP）。控制面用 `--exec-server` 或 `AGENT_SDK_EXEC_SERVER_URL` 连接。详见 [`sdk-exec-server.md`](./sdk-exec-server.md)。

```bash
agent-sdk exec-server --listen 127.0.0.1:8787 --cwd /repo --token "$TOKEN"
```

stdout 会打印连接、RPC method 和断开，用来确认控制面请求是否打到执行面。`--exec-server` 连不上时 `chat` / `tui` / `web` / `-p` 会直接失败，不会进会话。

连接后 UI 会按表单自动 `configure`。路径栏留空则使用上述 CLI 默认值。会话默认 **jsonl**，可与 `agent-sdk sessions` / `chat --resume` 共用存储。UI 若改选 **memory** 存储，每个会话是独立的内存实例，列出/恢复只对当前连接里仍活着的 runtime 有效。

本仓库需先 `pnpm build`：CLI 包会把 Vite 客户端打进 `dist/web-client`，发布的 `@ddlqhd/agent-sdk-cli` 已包含该静态资源。未构建时 `agent-sdk web` 会提示先 build。`tsup --watch` 不会清空已构建的 `dist/web-client`。

默认只绑定回环地址，并对浏览器 WebSocket 校验 `Origin`（仅 `http://127.0.0.1:<port>` / `http://localhost:<port>`）。`--host 0.0.0.0` 必须同时加 `--allow-remote`；这会跳过 Origin 校验，任何能连上的客户端都可以驱动带工具的 Agent，不要对公网暴露。

### Print mode (`-p`)

非交互 headless 模式（对齐 Claude Code `-p` / `--print`）。在根命令使用，无需子命令：

```bash
agent-sdk -p "What does this repo do?" --provider openai --bare

# 管道：指令 + stdin 内容
cat build.log | agent-sdk -p "find root cause" --bare --allowed-tools "Read"

# JSON 输出（stdout 仅合法 JSON，适合 jq / CI）
agent-sdk -p "Summarize" --bare -o json | jq .

# 继续最近会话
agent-sdk -p "Continue the review" --continue --bare
```

根级选项（`-p` 专用，与 chat 共享 model/session 选项）：

```bash
agent-sdk -p [prompt] [options]

选项:
  -p, --print [prompt]     非交互单次执行（prompt 可省略，改从 stdin 读取）
  -o, --output <format>    输出格式 (text, json)
  --output-format <format> --output 别名（Claude Code 兼容）
  --allowed-tools <tools>  逗号分隔的自动批准工具（映射 AgentConfig.allowedTools）
  --bare                   跳过 hooks/skills/memory/MCP 自动发现/subagent profile
  --provider <provider>    模型提供商 (openai, anthropic, ollama；默认 openai)
  -m, --model <model>      模型 ID
  -k, --api-key <key>      API Key
  -v, --verbose            显示完整的工具调用参数和结果（调试模式）
  --resume, --continue     恢复最近会话
  (其他选项同 chat)
```

**Breaking change**：`run` 子命令已移除。请改用 `agent-sdk -p "..."`。

`-p` 模式下 MCP 加载成功 info、fork 提示等走 stderr，不污染 stdout；`-o json` 时 stdout 仅输出 JSON。

`--bare` 跳过项目/用户目录的 hooks、skills、memory、MCP 自动发现、subagent profile；仍可通过 `--mcp-config`、`-S/--system` 等显式传入配置。

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
  --user-base-path <path>  与 chat/-p 一致，用于解析会话 JSONL 目录
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
- 离线 `sessions rewind` 只改 JSONL；正在运行的 chat / `agent-sdk web` 须用 `Agent.rewindToCheckpoint`（交互式 `/rewind` 或 Web UI）。

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
