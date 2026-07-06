/**
 * LLM 协议层的消息表示。OpenAI 风格的 user / assistant / tool 三态，完全通用，
 * 不含任何具体 provider 的 wire 格式细节，也不含项目（Kagami / napcat）业务语义。
 * （provider 标识枚举 `LLM_PROVIDER_IDS` 例外：它是协议契约层"接入了哪些 provider"
 * 的清单，属跨前后端/内核共享的契约本身，故收在此最底层包里单源维护。）
 *
 * 这是 Agent Runtime 与 LLM 之间流动的基本单元——`@kagami/agent-runtime` 的
 * ReAct kernel、Tool、Effect 等都直接用它，不再用 `TMessage` 泛型抽象。
 */

/**
 * Kagami 当前接入的 LLM provider 标识全集。这是 LLM 协议层的契约枚举：config
 * schema、后端 provider 装配、auth 全部从这里派生，避免字面量在多处各写一遍而
 * 漂移。**新增 / 删除 provider 只改这一处。**
 *
 * 刻意用 `as const` 数组而非单独写 type union：既派生出字面量联合类型，又能在
 * 运行时遍历（如 client 探测可用 provider）。本包保持零 zod 依赖，需要 zod 校验
 * 的下游用 `z.enum(LLM_PROVIDER_IDS)` 自行派生 schema。
 */
export const LLM_PROVIDER_IDS = ["deepseek", "openai", "openai-codex", "claude-code"] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmTextContentPart = {
  type: "text";
  text: string;
};

export type LlmImageContentPart = {
  type: "image";
  /**
   * 图片内容的 **base64 字符串**（裸 base64，不含 `data:` 前缀）。
   *
   * 刻意用 string 而非 Buffer：图片内容部件会进入主 Agent 的持久上下文（快照 / ledger
   * 都按 JSON 存），而 Buffer 经 JSON 往返会变成 `{ type:"Buffer", data:[...] }` 不再是
   * Buffer——provider 侧 `.toString("base64")` 就会产出 "[object Object]" 这种无效 base64。
   * string 是 JSON 原生、往返不变、且正是各 provider wire 格式所需。生产者在边缘用
   * `buffer.toString("base64")` 转一次即可。
   */
  content: string;
  mimeType: string;
  filename?: string;
};

export type LlmContentPart = LlmTextContentPart | LlmImageContentPart;

/**
 * 把图片内容归一成 base64 字符串。防御性：兼容三种历史/运行时形态——
 * - base64 字符串（当前契约）：原样返回；
 * - Node Buffer（同进程内存中的图，如 vision 同请求构造）：toString("base64")；
 * - JSON 往返后的 Buffer 残骸 `{ type:"Buffer", data:number[] }`（旧持久化数据 / 已中毒的
 *   历史消息）：Buffer.from(data) 还原后转 base64。
 *
 * 这让 provider 对"已经被 JSON 毒过的历史图片消息"也能恢复，无需手动改库。
 */
export function imageContentToBase64(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Buffer.isBuffer(content)) {
    return content.toString("base64");
  }
  if (
    content !== null &&
    typeof content === "object" &&
    Array.isArray((content as { data?: unknown }).data)
  ) {
    return Buffer.from((content as { data: number[] }).data).toString("base64");
  }
  return "";
}

export type LlmMessage =
  | { role: "user"; content: string | LlmContentPart[] }
  | { role: "assistant"; content: string; toolCalls: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** 工具参数的 JSON Schema（仅支持 object 顶层）。 */
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  additionalProperties?: boolean | Record<string, unknown>;
};

/**
 * 一个工具对 LLM 的定义（name / description / parameters）。这是 LLM 协议层的
 * "工具定义"——Agent Runtime 的 kernel 把它塞进 chat 请求的 tools 字段，LLM
 * 据此决定调哪个工具。不含执行逻辑（执行是 agent-runtime 的 ToolComponent）。
 */
export type Tool = {
  name: string;
  description?: string;
  parameters: JsonSchema;
};
