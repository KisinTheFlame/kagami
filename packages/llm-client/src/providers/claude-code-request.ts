import { imageContentToBase64 } from "@kagami/llm";
import { isRecord } from "@kagami/kernel/json/is-record";
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
const CLAUDE_4_THINKING_BUDGET = 1024;

/** LlmChatRequest → Anthropic Messages 请求体（含 system 前缀块 / thinking / 工具映射）。 */
export function toClaudeCodeRequestBody(request: LlmChatRequest): ClaudeMessageRequestBody {
  const model = requireRequestModel(request);
  const toolsEnabled = request.tools.length > 0 && request.toolChoice !== "none";
  const toolChoice = toClaudeToolChoice(request.toolChoice);
  const thinkingConfig = toClaudeThinkingConfig({
    model,
    toolChoice: request.toolChoice,
  });

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
                : message.content.map(toClaudeUserContentPart),
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
    ...(thinkingConfig ? thinkingConfig : {}),
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

function toClaudeUserContentPart(part: LlmContentPart): Record<string, unknown> {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
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

function toClaudeThinkingConfig(input: {
  model: string;
  toolChoice: LlmChatRequest["toolChoice"];
}): Record<string, unknown> | null {
  if (forcesToolUse(input.toolChoice)) {
    return {
      thinking: {
        type: "disabled",
      },
    };
  }

  if (isClaudeAdaptiveModel(input.model)) {
    return {
      thinking: {
        type: "adaptive",
      },
      output_config: {
        effort: "medium",
      },
      context_management: {
        edits: [
          {
            type: "clear_thinking_20251015",
            keep: "all",
          },
        ],
      },
    };
  }

  if (isClaude4Model(input.model)) {
    return {
      thinking: {
        type: "enabled",
        budget_tokens: CLAUDE_4_THINKING_BUDGET,
      },
    };
  }

  return null;
}

function resolveClaudeMaxTokens(model: string): number {
  if (isClaude4Model(model)) {
    return CLAUDE_4_MAX_TOKENS;
  }

  return DEFAULT_MAX_TOKENS;
}

function isClaudeAdaptiveModel(model: string): boolean {
  return model.startsWith("claude-sonnet-4-6") || model.startsWith("claude-opus-4-6");
}

function isClaude4Model(model: string): boolean {
  return model.startsWith("claude-sonnet-4-") || model.startsWith("claude-opus-4-");
}

function forcesToolUse(toolChoice: LlmChatRequest["toolChoice"]): boolean {
  return (
    toolChoice === "required" || (isRecord(toolChoice) && typeof toolChoice.tool_name === "string")
  );
}

function requireRequestModel(request: { model?: string }): string {
  if (!request.model) {
    throw new Error("Claude Code provider requires an explicit model");
  }

  return request.model;
}
