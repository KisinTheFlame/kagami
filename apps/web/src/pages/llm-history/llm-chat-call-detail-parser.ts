import {
  LlmChatErrorPayloadSchema,
  LlmChatResponsePayloadSchema,
  type LlmChatCallItem,
  type LlmChatErrorPayload,
  type LlmChatResponsePayload,
  type LlmToolCallPayload,
} from "@kagami/shared";

export type ParsedLlmUserContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      mimeType: string | null;
      filename?: string;
      sizeBytes?: number;
    };

export type ParsedLlmRequestMessage =
  | {
      role: "user";
      content: string | ParsedLlmUserContentPart[];
    }
  | {
      role: "assistant";
      content: string;
      toolCalls: LlmToolCallPayload[];
    }
  | {
      role: "tool";
      toolCallId: string;
      content: string;
    };

export type ParsedLlmChatRequestPayload = {
  system?: string;
  messages: ParsedLlmRequestMessage[];
  tools: Array<{
    name: string;
    description?: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
    };
  }>;
  toolChoice: "required" | "auto" | "none" | { tool_name: string };
  model?: string;
};

export type LlmChatCallDetailParseResult = {
  request: ParsedLlmChatRequestPayload | null;
  response: LlmChatResponsePayload | null;
  error: LlmChatErrorPayload | null;
  hasSchemaError: boolean;
  schemaErrors: string[];
};

export function parseLlmChatCallDetail(item: LlmChatCallItem): LlmChatCallDetailParseResult {
  const requestParsed = parseRequestPayload(item.requestPayload);
  const responseParsed =
    item.responsePayload === null
      ? null
      : LlmChatResponsePayloadSchema.safeParse(sanitizeResponsePayload(item.responsePayload));
  const errorParsed = item.error === null ? null : LlmChatErrorPayloadSchema.safeParse(item.error);

  const schemaErrors: string[] = [];
  if (!requestParsed.success) {
    schemaErrors.push(`requestPayload: ${requestParsed.error}`);
  }

  if (item.status === "success") {
    if (responseParsed === null) {
      schemaErrors.push("responsePayload: 成功记录缺少 responsePayload");
    } else if (!responseParsed.success) {
      schemaErrors.push(`responsePayload: ${formatIssueSummary(responseParsed.error.issues)}`);
    }
  }

  if (item.status === "failed") {
    if (errorParsed === null) {
      schemaErrors.push("error: 失败记录缺少 error");
    } else if (!errorParsed.success) {
      schemaErrors.push(`error: ${formatIssueSummary(errorParsed.error.issues)}`);
    }
  }

  return {
    request: requestParsed.success ? requestParsed.data : null,
    response: responseParsed?.success ? responseParsed.data : null,
    error: errorParsed?.success ? errorParsed.data : null,
    hasSchemaError: schemaErrors.length > 0,
    schemaErrors,
  };
}

function parseRequestPayload(
  payload: Record<string, unknown>,
): { success: true; data: ParsedLlmChatRequestPayload } | { success: false; error: string } {
  const system = typeof payload.system === "string" ? payload.system : undefined;
  const model = typeof payload.model === "string" ? payload.model : undefined;

  const toolsValue = payload.tools;
  if (!Array.isArray(toolsValue)) {
    return { success: false, error: "tools 必须是数组" };
  }

  const tools = toolsValue.map((tool, index) => {
    if (!isRecord(tool)) {
      throw new Error(`tools.${index} 必须是对象`);
    }

    if (typeof tool.name !== "string" || tool.name.length === 0) {
      throw new Error(`tools.${index}.name 必须是非空字符串`);
    }

    const parameters = isRecord(tool.parameters) ? tool.parameters : null;
    if (!parameters || parameters.type !== "object" || !isRecord(parameters.properties)) {
      throw new Error(`tools.${index}.parameters 必须是 object schema`);
    }

    return {
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : undefined,
      parameters: {
        type: "object" as const,
        properties: parameters.properties,
      },
    };
  });

  const messagesValue = payload.messages;
  if (!Array.isArray(messagesValue)) {
    return { success: false, error: "messages 必须是数组" };
  }

  let messages: ParsedLlmRequestMessage[];
  try {
    messages = messagesValue.map((message, index) => parseRequestMessage(message, index));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const toolChoice = parseToolChoice(payload.toolChoice);
  if (!toolChoice) {
    return { success: false, error: "toolChoice 不合法" };
  }

  return {
    success: true,
    data: {
      ...(system ? { system } : {}),
      ...(model ? { model } : {}),
      messages,
      tools,
      toolChoice,
    },
  };
}

function parseRequestMessage(value: unknown, index: number): ParsedLlmRequestMessage {
  if (!isRecord(value)) {
    throw new Error(`messages.${index} 必须是对象`);
  }

  if (value.role === "user") {
    const content = parseUserContent(value.content, index);
    return {
      role: "user",
      content,
    };
  }

  if (value.role === "assistant") {
    return {
      role: "assistant",
      content: typeof value.content === "string" ? value.content : "",
      toolCalls: parseToolCalls(value.toolCalls, index),
    };
  }

  if (value.role === "tool") {
    if (typeof value.toolCallId !== "string" || value.toolCallId.length === 0) {
      throw new Error(`messages.${index}.toolCallId 必须是非空字符串`);
    }

    return {
      role: "tool",
      toolCallId: value.toolCallId,
      content: typeof value.content === "string" ? value.content : "",
    };
  }

  throw new Error(`messages.${index}.role 不合法`);
}

function parseUserContent(value: unknown, index: number): string | ParsedLlmUserContentPart[] {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    throw new Error(`messages.${index}.content 必须是字符串或数组`);
  }

  return value.map((part, partIndex) => parseUserContentPart(part, index, partIndex));
}

function parseUserContentPart(
  value: unknown,
  messageIndex: number,
  partIndex: number,
): ParsedLlmUserContentPart {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`messages.${messageIndex}.content.${partIndex} 必须包含合法 type`);
  }

  if (value.type === "text") {
    return {
      type: "text",
      text: typeof value.text === "string" ? value.text : "",
    };
  }

  if (value.type === "image") {
    return {
      type: "image",
      mimeType: typeof value.mimeType === "string" ? value.mimeType : null,
      ...(typeof value.filename === "string" ? { filename: value.filename } : {}),
      ...(typeof value.sizeBytes === "number" ? { sizeBytes: value.sizeBytes } : {}),
    };
  }

  throw new Error(`messages.${messageIndex}.content.${partIndex}.type 不支持: ${value.type}`);
}

function parseToolCalls(value: unknown, index: number): LlmToolCallPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((toolCall, toolIndex) => {
    if (!isRecord(toolCall)) {
      return [];
    }

    if (
      typeof toolCall.id !== "string" ||
      typeof toolCall.name !== "string" ||
      !isRecord(toolCall.arguments)
    ) {
      throw new Error(`messages.${index}.toolCalls.${toolIndex} 结构不合法`);
    }

    return [
      {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    ];
  });
}

function parseToolChoice(value: unknown): ParsedLlmChatRequestPayload["toolChoice"] | null {
  if (value === "required" || value === "auto" || value === "none") {
    return value;
  }

  if (isRecord(value) && typeof value.tool_name === "string" && value.tool_name.length > 0) {
    return { tool_name: value.tool_name };
  }

  return null;
}

function sanitizeResponsePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload };
  delete sanitized.text;
  delete sanitized.json;
  delete sanitized.toolCalls;
  return sanitized;
}

function formatIssueSummary(
  issues: Array<{
    path: Array<string | number>;
    message: string;
  }>,
): string {
  return issues
    .slice(0, 3)
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path} ${issue.message}`;
    })
    .join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
