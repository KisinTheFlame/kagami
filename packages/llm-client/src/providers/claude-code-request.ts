import { imageContentToBase64 } from "@kagami/llm";
import type { JsonSchema, LlmChatRequest, LlmContentPart } from "../types.js";
import type {
  ClaudeMessageRequest,
  ClaudeMessageRequestBody,
  ClaudeSystemBlock,
} from "./claude-code-wire.js";

const CLAUDE_CODE_SDK_PROMPT = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const CLAUDE_CODE_BILLING_HEADER =
  "x-anthropic-billing-header: cc_version=2.1.76.b57; cc_entrypoint=sdk-cli; cch=00000;";
const DEFAULT_MAX_TOKENS = 4096;
const CLAUDE_4_MAX_TOKENS = 32000;

/**
 * LlmChatRequest → Anthropic Messages 请求体（含 system 前缀块 / thinking / 工具映射）。
 *
 * imageFileIds：图片 base64 内容 → 已上传的 Files API file_id 映射（key 为 `part.content`
 * 原样，即裸 base64）。命中的图片发 `source:{type:"file",file_id}`（几十字节，请求体不再随
 * 图片膨胀）；未命中（关闭 File API / 上传失败降级 / 非 claude-code）回退 `source:{type:"base64"}`。
 * 不传该参数时全部走 base64——与 File API 引入前逐字节一致，钉死旧行为的黑盒测试不受影响。
 */
export function toClaudeCodeRequestBody(
  request: LlmChatRequest,
  imageFileIds?: Map<string, string>,
): ClaudeMessageRequestBody {
  const model = requireRequestModel(request);
  const toolsEnabled = request.tools.length > 0 && request.toolChoice !== "none";
  const toolChoice = toClaudeToolChoice(request.toolChoice);
  // Anthropic 约束：thinking 与强制工具调用（tool_choice: any/tool）不兼容，只允许 auto/none。
  // 强制单工具是 vision/一次性抽取类场景，语义上也不需要 thinking——静默回落 disabled。
  const forcedToolChoice =
    request.toolChoice === "required" || typeof request.toolChoice === "object";
  const thinkingEnabled = request.thinking !== undefined && !forcedToolChoice;

  return {
    model,
    stream: true,
    max_tokens: resolveClaudeMaxTokens(model),
    cache_control: {
      type: "ephemeral",
      ttl: "1h",
    },
    system: toClaudeSystemBlocks(request.system),
    messages: request.messages.flatMap<ClaudeMessageRequest>(message => {
      if (message.role === "user") {
        return [
          {
            role: "user",
            content:
              typeof message.content === "string"
                ? [{ type: "text", text: message.content }]
                : message.content.map(part => toClaudeUserContentPart(part, imageFileIds)),
          },
        ];
      }

      if (message.role === "assistant") {
        const content: Array<Record<string, unknown>> = [];
        if (message.content.length > 0) {
          content.push({
            type: "text",
            text: message.content,
          });
        }
        for (const toolCall of message.toolCalls) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.arguments,
          });
        }

        // thinking 块回放（#573）：仅在本请求开启 thinking 时前置渲染（Step 0 实测该形态
        // 与模型自然出块序一致且回放合法）；未开启的请求（镜像 fork agent 关回 disabled、
        // config kill-switch 后）剥除不发——API 容忍携带（Step 0 E3）但剥除省 token 且字节
        // 确定。thinking-only 消息不单独成 turn：无 text/tool_use 则整条照旧丢弃。
        if (thinkingEnabled && content.length > 0 && message.thinkingBlocks?.length) {
          content.unshift(...message.thinkingBlocks.map(block => ({ ...block })));
        }

        return content.length > 0
          ? [
              {
                role: "assistant",
                content,
              },
            ]
          : [];
      }

      return [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId,
              content: message.content,
            },
          ],
        },
      ];
    }),
    // thinking 按请求开关（#573）：request.thinking 来自 usage 级配置（llm 服务侧注入）。
    // adaptive + output_config.effort 直通配置值；缺省 disabled 与旧行为逐字节一致。
    // 注意 thinking 参数值本身分割 prompt cache lineage（Step 0 E3：同字节 messages 换
    // 参数即全量重写），切换档位等价一次全量换入，属计划性成本。
    ...(thinkingEnabled
      ? {
          thinking: {
            type: "adaptive",
          },
          output_config: {
            effort: request.thinking,
          },
        }
      : {
          thinking: {
            type: "disabled",
          },
        }),
    ...(toolsEnabled
      ? {
          tools: request.tools.map(tool => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            input_schema: toInputSchema(tool.parameters),
          })),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
        }
      : {}),
  };
}

function toClaudeSystemBlocks(system: string | undefined): ClaudeSystemBlock[] {
  const blocks: ClaudeSystemBlock[] = [
    {
      type: "text",
      text: CLAUDE_CODE_BILLING_HEADER,
    },
    {
      type: "text",
      text: CLAUDE_CODE_SDK_PROMPT,
    },
  ];

  if (system) {
    blocks.push({
      type: "text",
      text: system,
    });
  }

  // 在**最后一个 system block** 上钉一个稳定的 cache 断点：tools + system 段进程内字节恒定（KV 缓存
  // 优先原则保证 system prompt / 工具集不在会话中途变），这个断点进程生命周期内不漂移，给 tools+system
  // 这段稳定前缀一个可跨请求/跨会话复用的缓存写点。顶层 `cache_control`（见 toClaudeCodeRequestBody）是
  // automatic caching：断点自动落在**最后一个可缓存块**（易变的 messages 尾部）且随对话向后移动，做单会话
  // 增量缓存，并不专门 pin 住 tools+system 边界。两者互补，共用 4 个断点额度里的 2 个（渲染序 tools →
  // system → messages，断点在 system 末块能覆盖 tools+system）。
  // 按 Anthropic prompt caching 语义，cache_control 是「缓存到此为止」的控制指令、不参与内容前缀的 hash，
  // 故新增这个断点不应改变顶层 automatic 已产生前缀的 key，TTL 内且内容一致的在飞缓存条目应仍能命中；新增
  // 的只是 system 前缀这个写点本身的首次冷写 + 后续读复用。以上均为工程假设，受 TTL(1h)、最小可缓存 token
  // 阈值（Opus 4.x 约 4096）、并发首写完成时机、模型/平台支持等约束——上线后以真实
  // cache_creation_input_tokens / cache_read_input_tokens 与有无 400 为准（provider 走 /v1/messages?beta=true）。
  // blocks 恒有 ≥2 个元素（billing + SDK prompt 一定 push），末元素必然存在。
  blocks[blocks.length - 1].cache_control = { type: "ephemeral", ttl: "1h" };

  return blocks;
}

function toClaudeUserContentPart(
  part: LlmContentPart,
  imageFileIds?: Map<string, string>,
): Record<string, unknown> {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
    };
  }

  // File API 命中：以 file_id 引用，请求体不再携带 base64。key 用 part.content 原样
  // （裸 base64），与 provider 侧预解析写入的 key 一致，builder 无需再解码/哈希。
  const fileId = imageFileIds?.get(part.content);
  if (fileId !== undefined) {
    return {
      type: "image",
      source: {
        type: "file",
        file_id: fileId,
      },
    };
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: part.mimeType,
      // content 现为 base64 字符串；imageContentToBase64 兜底已被 JSON 毒过的旧历史
      // 图片（{type:"Buffer",data:[...]}）与残留的 Buffer 形态，恢复成合法 base64。
      data: imageContentToBase64(part.content),
    },
  };
}

function toInputSchema(parameters: JsonSchema): Record<string, unknown> {
  return {
    type: parameters.type,
    properties: parameters.properties,
  };
}

function toClaudeToolChoice(
  toolChoice: LlmChatRequest["toolChoice"],
): Record<string, unknown> | null {
  if (toolChoice === "auto") {
    return {
      type: "auto",
    };
  }

  if (toolChoice === "required") {
    return {
      type: "any",
    };
  }

  if (toolChoice === "none") {
    return null;
  }

  return {
    type: "tool",
    name: toolChoice.tool_name,
  };
}

function resolveClaudeMaxTokens(model: string): number {
  if (isClaude4Model(model)) {
    return CLAUDE_4_MAX_TOKENS;
  }

  return DEFAULT_MAX_TOKENS;
}

function isClaude4Model(model: string): boolean {
  return model.startsWith("claude-sonnet-4-") || model.startsWith("claude-opus-4-");
}

function requireRequestModel(request: { model?: string }): string {
  if (!request.model) {
    throw new Error("Claude Code provider requires an explicit model");
  }

  return request.model;
}
