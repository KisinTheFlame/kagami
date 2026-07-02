/**
 * Claude Code（Anthropic Messages API）wire 层类型：请求体 / 响应体的原样形状。
 * 从 932 行的 claude-code-provider.ts 拆出（拆分不改行为，行为由
 * test/claude-code-provider.test.ts 黑盒钉死）。
 */

export type ClaudeSystemBlock = {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
    ttl?: "1h";
  };
};

export type ClaudeMessageRequestBody = {
  model: string;
  max_tokens: number;
  stream: true;
  cache_control?: {
    type: "ephemeral";
    ttl?: "1h";
  };
  system: ClaudeSystemBlock[];
  messages: Array<{
    role: "user" | "assistant";
    content: Array<Record<string, unknown>>;
  }>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
  thinking?: Record<string, unknown>;
  output_config?: Record<string, unknown>;
  context_management?: Record<string, unknown>;
};

export type ClaudeMessageRequest = ClaudeMessageRequestBody["messages"][number];

export type ClaudeMessageResponse = {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: Array<
    | {
        type?: "text";
        text?: string;
      }
    | {
        type?: "tool_use";
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }
  >;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
};
