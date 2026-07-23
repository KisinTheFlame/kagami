// LLM 调用的「KV 缓存身份」标识：**一切影响 prompt cache 命中的配置（provider / model /
// attempts，将来的 thinking / cache_control）都收口在同一个 usage 下**，不得按调用点分叉。
// provider 标识（`LlmProviderId`）的单源另在 @kagami/llm。
//
// 只有两个值：
// - `agent`：主 Agent 及一切 fork 出去、字节级复用主 Agent 消息前缀的 task agent
//   （contextSummarizer / todoSuggestionAgent / innerVoice）。它们必须与主 Agent 走同一份
//   模型配置，否则前缀 cache 必 miss——所以共享同一个缓存身份，而非各配一份。
// - `vision`：napcat 图片理解，独立的小 prompt，可独立选模型。
//
// 调用「归因」（哪个业务场景发起的）不再由 usage 承担，改由 `LlmClient.chat` 的 `scene`
// 自由字段承接（metric 标签 + llm_chat_call 落库），见 issue #555。
export type LlmUsageId = "agent" | "vision";
