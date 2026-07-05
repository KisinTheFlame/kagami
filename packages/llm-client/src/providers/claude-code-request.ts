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
    // thinking 显式关死：消息模型与持久化尚不认识 thinking 块（解析层会静默丢弃），
    // tool loop 续轮回放缺块会被 API 拒绝（400）。开启 adaptive thinking 是独立
    // 工程，见 https://github.com/KisinTheFlame/kagami/issues/269。
    thinking: {
      type: "disabled",
    },
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
