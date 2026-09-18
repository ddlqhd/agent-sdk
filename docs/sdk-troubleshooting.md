# Agent SDK 常见问题与排障

## 1. OpenAI/Anthropic 报 API Key 缺失

典型错误：

- `OpenAI API key is required...`
- `Anthropic API key is required...`

排查：

1. 确认环境变量存在（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`）
2. 确认代码中是否显式传了空字符串覆盖环境变量
3. 优先在初始化时显式传 `apiKey`

## 2. `Unknown model provider`

原因：`createModel({ provider })` 传入了非 `openai|anthropic|ollama` 的值。

排查：

- 检查配置中心枚举值
- 对环境变量做白名单映射，不直接透传原始字符串

## 3. MCP 配置不生效

排查步骤：

1. 使用 `loadMCPConfig()` 返回值确认 `servers.length`
2. 检查 `mcp_config.json` 是否位于：
   - `{userBasePath}/.claude/mcp_config.json`
   - `{cwd}/.claude/mcp_config.json`
3. 用 `validateMCPConfig()` 校验结构
4. 确保单个 server 仅使用 `command` 或 `url` 之一

## 4. Session 恢复失败

现象：传入 `sessionId` 后上下文未延续。

排查：

- 确认本次与上次使用的是同一个 `userBasePath`
- 确认没有在中途 `clearMessages()`
- 检查持久化目录是否可写

## 5. 流式输出异常中断

排查：

- 监听 `end`（`reason === 'error'`）与 `tool_error` 事件分别记录
- 如果使用了 `AbortController`，确认不是业务层提前 `abort()`
- 开启 `includeRawStreamEvents` 采集 provider 原始事件辅助定位

## 6. Skill 未触发

排查：

1. 目录结构必须为 `.claude/skills/<SkillName>/SKILL.md`（或手动 `loadSkill(path)`）
2. `name` 要唯一，重复注册会报错
3. 用户输入必须是 `/skill-name ...` 格式
4. `userInvocable: false` 时不能被用户手动触发

## 7. Memory 内容未注入

排查：

- 确认 `memory !== false`
- 确认文件路径为：
  - `{userBasePath}/.claude/CLAUDE.md`
  - `{workspaceRoot}/CLAUDE.md`
- 仅首次用户消息前注入一次，非每轮重复注入

## 8. 工具调用循环过多

现象：响应慢、多轮 tool-call。

处理建议：

- 设置更合理的 `maxIterations`
- 在工具描述中明确边界，减少不必要调用
- 给工具返回结构化、可终止的结果（避免模型继续追问）

## 9. 文档与实现不一致时

- 以 `packages/agent-sdk/package.json` 的 `exports`、`packages/agent-sdk/src/index.ts` 的公开导出及对应实现为准。
- 模型默认值、工具行为等可能随版本调整；生产环境请**显式**配置 `provider`、`model`、`baseUrl` 等关键参数，避免依赖隐式默认值。

## 10. 已 export HTTP_PROXY / HTTPS_PROXY 但 CLI 仍直连

Node 18+ 的 `fetch` **默认不读** `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`。`agent-sdk` CLI 会在启动时用依赖里的 `undici.fetch` + `ProxyAgent` 走这些变量（不会把 npm undici dispatcher 塞进 Node 内置 fetch，避免 Node 24/26 上立刻 `fetch failed`）。

排查：

1. 确认变量在**启动 CLI 的同一壳**里（`echo $HTTPS_PROXY` / `echo $HTTP_PROXY`）
2. 优先设 `HTTPS_PROXY`（或小写 `https_proxy`）；二者都设时小写 `https_proxy` 优先
3. 检查 `NO_PROXY` / `no_proxy` 是否把 API 主机加进了直连名单（或设成了 `*`）
4. SOCKS（`socks5://...`）不受支持，CLI 会忽略
5. 用 `pnpm cli` / `agent-sdk` / `node packages/agent-sdk-cli/dist/index.js` 启动；不要只跑未走 CLI 入口的库代码并期望自动代理
6. 若启动报 `Cannot find module 'undici'`，在仓库根目录执行 `pnpm install`（`undici` 是 `@ddlqhd/agent-sdk` 的运行时依赖，用来给 Node `fetch` 安装代理 dispatcher）

