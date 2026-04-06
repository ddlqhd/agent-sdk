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

## 9. 已知实现差异提示

- README 中部分默认值与当前源码存在差异（例如 Ollama 默认模型）
- 以源码导出与实现为准，接入时建议显式配置关键参数

