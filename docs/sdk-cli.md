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

全局安装（`npm install -g agent-sdk`）后可直接使用 `agent-sdk`；项目内推荐 `npx`：

```bash
npx agent-sdk --help

# 聊天模式
npx agent-sdk chat --model openai --api-key sk-xxx

# 单次运行
npx agent-sdk run "List files in current directory" --model openai

# 工具管理
npx agent-sdk tools list
npx agent-sdk tools show Read
npx agent-sdk tools test Read -a "{}"
# 或长选项：--args（JSON 对象字符串）

# 会话管理（与 chat/run 使用相同存储时须传相同 --user-base-path）
npx agent-sdk sessions list
npx agent-sdk sessions show <session-id>
npx agent-sdk sessions delete <session-id>
npx agent-sdk sessions clear

# MCP（当前 CLI 仅提供 connect；运行时 MCP 多用 Agent 配置或 mcp_config.json）
npx agent-sdk mcp connect "npx @modelcontextprotocol/server-filesystem /path"
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
  --ollama-think [value]   仅 Ollama：对应 API `think`（true|false|low|medium|high；单独写该 flag 等价 true）
```

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
agent-sdk sessions list [options]    # 列出所有会话
agent-sdk sessions show <id>         # 查看会话内容（默认展示最近若干条消息）
agent-sdk sessions delete <id>       # 删除会话（可加 -f / --force 跳过确认）
agent-sdk sessions clear             # 清空全部会话（可加 -f / --force 跳过确认）

list 选项:
  --user-base-path <path>  与 chat/run 一致，用于解析会话 JSONL 目录
  -f, --format <format>    输出格式 (table, json)
  -l, --limit <n>          列出会话条数上限（默认 20）

show 选项:
  --user-base-path <path>  同上
  -l, --limit <n>          展示消息条数上限（默认 50）

delete / clear 选项:
  --user-base-path <path>  同上
  -f, --force               跳过确认提示
```

注意：`sessions list` 的 `-f` 表示 **format**；`sessions delete` / `sessions clear` 的 `-f` 表示 **force**，与 list 不同。

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
