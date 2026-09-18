# 多模态图片输入（Multimodal Image Input）设计文档

## 读者指引

- **SDK 贡献者**：若需实现或修改多模态图片输入，请阅读全文。核心源码位于 `src/core/types.ts`（`ImageContent` 类型）、`src/models/{openai,anthropic,ollama}.ts`（各适配器映射，其中 `openaiContentPartsToWire` / `buildAnthropicWireMessages` / `ollamaMessageContentToApi` 为顶层纯函数）、`src/core/compressor.ts`（`messageContentToTranscriptText` 顶层纯函数 + `SummarizationCompressor` 私有委派）、`src/cli/utils/chat-history.ts`（展示逻辑）。
- **应用集成者**：只需知道 `Message.content` 为 `ContentPart[]` 时可包含 `ImageContent`，`ModelCapabilities.supportsImages` 标识模型是否支持。无需理解适配器内部 wire format 转换。

---

## 1. 背景

### 1.1 起点：上一版 `ImageContent`（本次重构前的状态）

> 以下为本设计文档撰写时所描述的"重构前"代码；本设计落地后该 shape 已被替换为 `source` 判别联合（见 §4.1）。这里保留它，仅为记录重构动机。

```ts
// 重构前 src/core/types.ts（commit cf31301 引入）
export interface ImageContent {
  type: 'image';
  /** 纯 base64 编码的图像数据（不含 data URI 前缀） */
  base64: string;
  /** MIME 类型，如 'image/png', 'image/jpeg' */
  mimeType: string;
}
```

**核心问题**：`ImageContent` 只支持**裸 base64**，且 `mimeType` 必填。不支持 URL、Buffer、file_id 等更灵活的图片来源。当时的设计把 provider 的最低公分母（裸 base64）暴露给了调用方，违背"SDK 屏蔽 provider 差异"的定位。

### 1.2 行业对比

| SDK | 图片来源 | mediaType | URL 处理 |
| --- | --- | --- | --- |
| Vercel AI SDK | base64 / Uint8Array / ArrayBuffer / Buffer / URL / provider reference | 可选，自动探测 | SDK 自动下载并按 provider 需要编码 |
| Anthropic API/SDK | base64 / url / file_id | 必填（base64） | 原生支持 url source |
| OpenAI | 托管 URL 或 data URI | 由 data URI 前缀携带 | 原生支持 url |

### 1.3 重构前消费点

> 以下为重构前 `ImageContent` 的所有消费点（`part.mimeType` / `part.base64` 顶层字段）。本设计落地后全部改为 `part.source.*`：

| 文件 | 重构前使用方式 |
|------|----------------|
| `src/models/openai.ts` | `transformContentParts` → `data:${part.mimeType};base64,${part.base64}` |
| `src/models/anthropic.ts` | `buildAnthropicWireMessages` → `source:{type:'base64',media_type:part.mimeType,data:part.base64}` |
| `src/models/ollama.ts` | `ollamaMessageContentToApi` → `images.push(part.base64)` |
| `src/core/compressor.ts` | `messageContentToText` → `[image: ${part.mimeType}]` |
| `src/cli/utils/chat-history.ts` | `partsToText` + `partsToTerminalLines` → `[image: ${p.mimeType}]` |

---

## 2. 设计目标

1. **统一图片来源**：支持 `base64` 与 `url` 两种来源，覆盖主流 provider 的多模态能力。
2. **区分 source 类型**：用判别联合表达 `base64`（必填 mimeType）与 `url`（mimeType 可选），消费者按需处理。
3. **零运行时依赖**：不做异步自动下载（如 Vercel AI SDK），各适配器同步映射；Ollama 对 url source 清晰报错。
4. **向后兼容考虑**：本字段刚引入、尚无外部真实使用者，允许直接破坏性替换 `ImageContent` 类型，不影响 `ContentPart` 联合接口语义。
5. **`ModelCapabilities.supportsImages` 保持不变**。

---

## 3. 模块影响

```
src/core/types.ts            ← ImageContent 类型定义（核心变更）
src/models/openai.ts         ← OpenAI wire format 映射（base64→data URI, url→透传）
src/models/anthropic.ts      ← Anthropic wire format 映射（支持两种 source）
src/models/ollama.ts         ← Ollama 映射（base64→images[], url→抛错）
src/core/compressor.ts       ← 压缩展示层适配新类型
src/cli/utils/chat-history.ts ← 终端展示层适配新类型
docs/sdk-types-reference.md  ← 类型文档更新
tests/unit/multimodal-image.test.ts ← 新增测试
```

---

## 4. 类型设计

### 4.1 目标类型

```ts
// src/core/types.ts
export interface ImageContent {
  type: 'image';
  source:
    | { type: 'base64'; data: string; mimeType: string }
    | { type: 'url'; url: string; mimeType?: string };
}
```

### 4.2 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `source.type` | `'base64' \| 'url'` | 图片来源判别 |
| `source.data` | `string` | base64 编码的图像数据（不含 `data:` URI 前缀）；仅在 `type === 'base64'` 时存在 |
| `source.mimeType` | `string` | base64 来源时的 MIME 类型（必填）；URL 来源时可选 |
| `source.url` | `string` | 可公开访问的图像 URL（HTTPS 优先）；仅在 `type === 'url'` 时存在 |

### 4.3 使用示例

```ts
// base64 来源（发送本地图片）
const msg: Message = {
  role: 'user',
  content: [
    { type: 'text', text: '描述这张图片' },
    {
      type: 'image',
      source: { type: 'base64', data: 'iVBORw0KGgo...', mimeType: 'image/png' }
    }
  ]
};

// URL 来源（发送网络图片）
const msg: Message = {
  role: 'user',
  content: [
    { type: 'text', text: '这张图片里有什么？' },
    {
      type: 'image',
      source: { type: 'url', url: 'https://example.com/photo.jpg', mimeType: 'image/jpeg' }
    }
  ]
};
```

---

## 5. 适配器映射

### 5.1 映射总表

| Provider | url source | base64 source |
| --- | --- | --- |
| OpenAI | `image_url.url = <url>` 直接透传 | `data:${mime};base64,${data}` → `image_url.url` |
| Anthropic | `source:{type:'url',url}` | `source:{type:'base64',media_type,data}` |
| Ollama | 仅支持 base64 → 抛清晰错误 | `images:[data]` |

### 5.2 OpenAI 适配器（`src/models/openai.ts`）

为便于测试，把 `transformContentParts` 的实现提取为顶层纯函数 `openaiContentPartsToWire`；class 内的同名私有方法直接委派：

```ts
export function openaiContentPartsToWire(
  content: string | ContentPart[]
): string | unknown[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;

  const parts: unknown[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      const url = part.source.type === 'base64'
        ? `data:${part.source.mimeType};base64,${part.source.data}`
        : part.source.url;
      parts.push({
        type: 'image_url',
        image_url: { url, detail: 'auto' }
      });
    }
  }
  return parts.length > 0 ? parts : '';
}
```

**`role: 'tool'` 修正**：`OpenAI` 要求 tool 消息的 `content` 必须为字符串（不支持多模态数组）。如果 `msg.content` 是数组但仅含 `text` 段，则用 `\n\n` 拼接为字符串；如果**包含任何非 text 段**（如图片），直接 `throw`，避免图片被静默丢弃或被错误地 JSON 化后发给 OpenAI。

### 5.3 Anthropic 适配器（`src/models/anthropic.ts`）

为避免在调用点用 `Record<string, string>` 这种"手搓"的线协议类型，在文件顶部定义本地联合 `AnthropicImageSource`，`buildAnthropicWireMessages` 直接构造此类型：

```ts
export type AnthropicImageSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'url'; url: string };

// buildAnthropicWireMessages 内
if (part.type === 'image') {
  const source: AnthropicImageSource =
    part.source.type === 'base64'
      ? { type: 'base64', media_type: part.source.mimeType, data: part.source.data }
      : { type: 'url', url: part.source.url };
  contentParts.push({ type: 'image', source });
}
```

### 5.4 Ollama 适配器（`src/models/ollama.ts`）

**`ollamaMessageContentToApi`** 的 image 分支：

```ts
if (part.type === 'image') {
  if (part.source.type === 'base64') {
    images.push(part.source.data);
  } else if (part.source.type === 'url') {
    throw new Error(
      `Ollama does not support url-based image sources. ` +
      `Use base64 instead. Received url: ${part.source.url}`
    );
  }
}
```

保持 `ollamaMessageContentToApiString` deprecated 兼容层不变。

---

## 6. 展示/预览层适配

### 6.1 压缩器（`src/core/compressor.ts`）

将 `messageContentToText` 的实现提取为顶层纯函数 `messageContentToTranscriptText`；class 内的同名私有方法直接委派：

```ts
export function messageContentToTranscriptText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'thinking') return `[thinking] ${part.thinking}`;
      if (part.type === 'image') {
        return part.source.type === 'base64'
          ? `[image: ${part.source.mimeType}]`
          : `[image: ${part.source.url}]`;
      }
      return '';
    })
    .filter((s) => s.length > 0)
    .join('\n');
}
```

### 6.2 终端展示（`src/cli/utils/chat-history.ts`）

`partsToText` 与 `partsToTerminalLines` 同理：

```ts
if (p.type === 'image') {
  const label = p.source.type === 'base64'
    ? `[image: ${p.source.mimeType}]`
    : `[image: ${p.source.url}]`;
  return label;
}
```

---

## 7. 变更清单

### 7.1 `src/core/types.ts`

- 将 `ImageContent` 从扁平结构改为 `source` 判别联合（base64 | url）。
- 移除顶层 `base64`、`mimeType` 字段。

### 7.2 `src/models/openai.ts`

- 把 `transformContentParts` 的实现提取为顶层纯函数 `openaiContentPartsToWire`；class 私有方法委派。
- `ImageContent` → 新 `source` 分支判断（base64 → data URI，url → 透传）。
- `role: 'tool'` 分支修正：
  - 仅含 text 段 → 用 `\n\n` 拼接为字符串；
  - 含任何非 text 段 → 直接 `throw new Error('OpenAI tool messages require a string content; ...')`。

### 7.3 `src/models/anthropic.ts`

- 在文件顶部定义本地类型 `AnthropicImageSource`（base64 + url 判别联合）。
- `buildAnthropicWireMessages`：`ImageContent` → 构造 `AnthropicImageSource`（base64: `{ type, media_type, data }`；url: `{ type, url }`），不再用 `Record<string, string>`。

### 7.4 `src/models/ollama.ts`

- `ollamaMessageContentToApi`：`ImageContent` → 新 `source` 分支判断；url source 抛 `Error`。

### 7.5 `src/core/compressor.ts`

- 把 `messageContentToText` 的实现提取为顶层纯函数 `messageContentToTranscriptText`；class 私有方法委派。
- `ImageContent` → 读 `source.mimeType` / `source.url`。

### 7.6 `src/cli/utils/chat-history.ts`

- `partsToText` + `partsToTerminalLines`：`ImageContent` → 读 `source.mimeType` / `source.url`。

### 7.7 `tests/unit/multimodal-image.test.ts`

新增测试文件，覆盖：

**OpenAI 适配器（`transformContentParts`）**：
- base64 source → `data:image/png;base64,...` data URI
- url source → 透传 url
- tool 角色消息 → 不产生多模态数组

**Anthropic 适配器（`buildAnthropicWireMessages`）**：
- base64 source → `{ type: 'base64', media_type, data }`
- url source → `{ type: 'url', url }`

**Ollama 适配器（`ollamaMessageContentToApi`）**：
- base64 source → `images[]` 数组
- url source → 抛出 `Error('Ollama does not support url-based image sources')`

**展示层**：
- `messageContentToText` → 新 source 格式
- `partsToText` → 新 source 格式

### 7.8 `docs/sdk-types-reference.md`

- 更新 `ImageContent` 类型定义段（当前为过时的 `imageUrl` 描述，需替换为新 `source` 联合）。

### 7.9 `docs/sdk-api-reference.md`

- 如涉及图片相关 API 描述则同步更新。

---

## 8. 测试策略

```bash
# 运行新增的多模态图片测试
pnpm vitest run tests/unit/multimodal-image.test.ts

# 运行所有既有测试确保回归
pnpm test:run
pnpm lint
```

> 注意：现存 `yaml` 模块缺失报错与本次无关，需先 `pnpm install`。

### 8.1 测试场景矩阵

| 场景 | 适配器 | 输入 | 预期输出 |
|------|--------|------|----------|
| base64→OpenAI data URI | openai | `{source:{type:'base64',data:'abc',mimeType:'image/png'}}` | `image_url.url = 'data:image/png;base64,abc'` |
| url→OpenAI 透传 | openai | `{source:{type:'url',url:'https://ex.com/img.png'}}` | `image_url.url = 'https://ex.com/img.png'` |
| base64→Anthropic | anthropic | `{source:{type:'base64',data:'abc',mimeType:'image/png'}}` | `source:{type:'base64',media_type:'image/png',data:'abc'}` |
| url→Anthropic | anthropic | `{source:{type:'url',url:'https://ex.com/img.jpg'}}` | `source:{type:'url',url:'https://ex.com/img.jpg'}` |
| base64→Ollama | ollama | `{source:{type:'base64',data:'abc',mimeType:'image/png'}}` | `images:['abc']` |
| url→Ollama 抛错 | ollama | `{source:{type:'url',url:'https://ex.com/img.png'}}` | `Error` |

---

## 9. 验证

```bash
pnpm test:run          # 全部单元测试
pnpm lint              # TypeScript 类型检查
pnpm build             # ESM + CJS + d.ts 构建无报错
```

---

## 10. 相关文档

- 类型参考：[`docs/sdk-types-reference.md`](../sdk-types-reference.md)（需更新 `ImageContent` 段）
- API 参考：[`docs/sdk-api-reference.md`](../sdk-api-reference.md)（如有图片相关描述需同步）
- 模型类型定义源码：[`src/core/types.ts`](../../packages/agent-sdk/src/core/types.ts)
- OpenAI 适配器：[`src/models/openai.ts`](../../src/models/openai.ts)（`transformContentParts` 方法）
- Anthropic 适配器：[`src/models/anthropic.ts`](../../src/models/anthropic.ts)（`buildAnthropicWireMessages` 函数）
- Ollama 适配器：[`src/models/ollama.ts`](../../src/models/ollama.ts)（`ollamaMessageContentToApi` 函数）
- 上下文压缩器：[`src/core/compressor.ts`](../../packages/agent-sdk/src/core/compressor.ts)（`messageContentToText` 方法）
- 终端展示：[`src/cli/utils/chat-history.ts`](../../packages/agent-sdk-cli/src/utils/chat-history.ts)（`partsToText` / `partsToTerminalLines` 函数）
