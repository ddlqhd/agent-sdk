# Agent SDK CLI

命令行用于**快速试用** SDK 能力（模型、工具、会话、MCP），与 [`sdk-examples-index.md`](./sdk-examples-index.md) 中的 Web Demo 一样，属于演示与调试入口；应用集成仍应以代码中的 [`Agent`](./sdk-api-reference.md) 为准。

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
pnpm cli chat --model openai --api-key sk-xxx

# 单次提问（headless）
pnpm cli -p "What is the capital of France?" --model openai --bare

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

未构建时 CLI 会提示执行 `pnpm build`。调试/CI 也可显式使用 `node dist/cli/index.js ...`。

### 贡献者全局 link

若需在仓库外目录直接调用 CLI：

```bash
pnpm build
pnpm link --global
agent-sdk chat --model openai
```

## 通过 npm 安装后使用

全局安装（`npm install -g @ddlqhd/agent-sdk`）后可直接使用 `agent-sdk` 命令；项目内推荐 `npx`：

```bash
npx @ddlqhd/agent-sdk --help

# 聊天模式
npx @ddlqhd/agent-sdk chat --model openai --api-key sk-xxx

# 单次运行（headless / print 模式）
npx @ddlqhd/agent-sdk -p "List files in current directory" --model openai --bare

# 工具管理
npx @ddlqhd/agent-sdk tools list
npx @ddlqhd/agent-sdk tools show Read
npx @ddlqhd/agent-sdk tools test Read -a "{}"
# 或长选项：--args（JSON 对象字符串）

# 会话管理（与 chat/-p 使用相同存储时须传相同 --user-base-path）
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

### Print mode (`-p`)

非交互 headless 模式（对齐 Claude Code `-p` / `--print`）。在根命令使用，无需子命令：

```bash
agent-sdk -p "What does this repo do?" --model openai --bare

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
  -m, --model <model>      模型提供商
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
