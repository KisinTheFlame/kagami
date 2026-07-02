/**
 * Playground 编辑器的域模型与纯函数层：EditorMessage/EditorTool 等类型、
 * payload 解析/序列化、编辑器项构造与角色转换。从 2287 行的 LlmPlaygroundPage.tsx
 * 拆出（纯移动零行为变化），无 JSX、无 React 依赖，可单测。
 */
import {
  LlmPlaygroundChatRequestSchema,
  type LlmPlaygroundChatRequest,
  type LlmPlaygroundChatResponse,
  type LlmProviderOption,
  type LlmToolCallPayload,
  type LlmToolDefinition,
  type PlaygroundContentPart,
  type PlaygroundMessage,
} from "@kagami/shared/schemas/llm-chat";
import type { ApiRequestResult } from "@/lib/api";

export type PlaygroundResult = {
  payload: LlmPlaygroundChatRequest;
  response: ApiRequestResult;
  parsedResponse: LlmPlaygroundChatResponse | null;
  responseSchemaError: string | null;
};

export type ToolChoiceMode = "none" | "auto" | "required" | "tool";
export type EditorRole = PlaygroundMessage["role"];
export type EditorPropertyType = "string" | "number" | "integer" | "boolean" | "object" | "array";

export type EditorTextPart = {
  id: string;
  type: "text";
  text: string;
};

export type EditorImagePart = {
  id: string;
  type: "image";
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type EditorContentPart = EditorTextPart | EditorImagePart;

export type EditorToolCall = {
  id: string;
  toolCallId: string;
  name: string;
  argumentsText: string;
};

export type EditorUserMessage = {
  id: string;
  role: "user";
  parts: EditorContentPart[];
};

export type EditorAssistantMessage = {
  id: string;
  role: "assistant";
  content: string;
  toolCalls: EditorToolCall[];
};

export type EditorToolMessage = {
  id: string;
  role: "tool";
  toolCallId: string;
  content: string;
};

export type EditorMessage = EditorUserMessage | EditorAssistantMessage | EditorToolMessage;

export type EditorToolProperty = {
  id: string;
  name: string;
  type: EditorPropertyType;
  description: string;
  rawSchema: Record<string, unknown>;
};

export type EditorTool = {
  id: string;
  name: string;
  description: string;
  properties: EditorToolProperty[];
};

export function parsePlaygroundPayload({
  provider,
  model,
  availableModels,
  systemPrompt,
  messages,
  tools,
  toolChoiceMode,
  selectedToolNameForChoice,
}: {
  provider: LlmProviderOption["id"];
  model: string;
  availableModels: string[];
  systemPrompt: string;
  messages: EditorMessage[];
  tools: EditorTool[];
  toolChoiceMode: ToolChoiceMode;
  selectedToolNameForChoice: string;
}):
  | {
      success: true;
      data: LlmPlaygroundChatRequest;
    }
  | {
      success: false;
      error: string;
    } {
  if (model.trim().length === 0) {
    return {
      success: false,
      error: "请先选择 model。",
    };
  }

  if (!availableModels.includes(model)) {
    return {
      success: false,
      error: "所选 model 不在当前 provider 的配置列表中。",
    };
  }

  const parsedMessages = serializeMessages(messages);
  if (!parsedMessages.success) {
    return parsedMessages;
  }

  const parsedTools = serializeTools(tools);
  if (!parsedTools.success) {
    return parsedTools;
  }

  const toolChoice = serializeToolChoice({
    toolChoiceMode,
    selectedToolNameForChoice,
    currentToolNames: parsedTools.data.map(tool => tool.name),
  });
  if (!toolChoice.success) {
    return toolChoice;
  }

  const payloadParsed = LlmPlaygroundChatRequestSchema.safeParse({
    provider,
    model,
    ...(systemPrompt.trim().length > 0 ? { system: systemPrompt.trim() } : {}),
    messages: parsedMessages.data,
    tools: parsedTools.data,
    toolChoice: toolChoice.data,
  });

  if (!payloadParsed.success) {
    return {
      success: false,
      error: `提交参数校验失败：${formatSchemaIssues(payloadParsed.error.issues)}`,
    };
  }

  return {
    success: true,
    data: payloadParsed.data,
  };
}

export function serializeMessages(messages: EditorMessage[]):
  | {
      success: true;
      data: PlaygroundMessage[];
    }
  | {
      success: false;
      error: string;
    } {
  const serializedMessages: PlaygroundMessage[] = [];

  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      const serializedParts = message.parts
        .map(part => {
          if (part.type === "text") {
            const text = part.text.trim();
            if (text.length === 0) {
              return null;
            }

            return {
              type: "text",
              text,
            } as const;
          }

          if (part.dataUrl.trim().length === 0) {
            return null;
          }

          return {
            type: "image",
            fileName: part.fileName.trim() || undefined,
            mimeType: part.mimeType.trim(),
            dataUrl: part.dataUrl,
          } as const;
        })
        .filter((part): part is PlaygroundContentPart => part !== null);

      if (serializedParts.length === 0) {
        return {
          success: false,
          error: `第 ${index + 1} 条 user 消息没有有效内容。`,
        };
      }

      if (
        serializedParts.length === 1 &&
        serializedParts[0].type === "text" &&
        serializedParts[0].text.trim().length > 0
      ) {
        serializedMessages.push({
          role: "user",
          content: serializedParts[0].text,
        });
      } else {
        serializedMessages.push({
          role: "user",
          content: serializedParts,
        });
      }

      continue;
    }

    if (message.role === "assistant") {
      const toolCalls: LlmToolCallPayload[] = [];
      for (const toolCall of message.toolCalls) {
        const toolCallId = toolCall.toolCallId.trim();
        const toolName = toolCall.name.trim();
        if (
          toolCallId.length === 0 &&
          toolName.length === 0 &&
          toolCall.argumentsText.trim().length === 0
        ) {
          continue;
        }

        let parsedArguments: unknown;
        try {
          parsedArguments = JSON.parse(toolCall.argumentsText || "{}");
        } catch (error) {
          return {
            success: false,
            error: `第 ${index + 1} 条 assistant 消息的 tool call 参数 JSON 解析失败：${
              error instanceof Error ? error.message : "未知错误"
            }`,
          };
        }

        if (
          !parsedArguments ||
          typeof parsedArguments !== "object" ||
          Array.isArray(parsedArguments)
        ) {
          return {
            success: false,
            error: `第 ${index + 1} 条 assistant 消息的 tool call 参数必须是 JSON object。`,
          };
        }

        toolCalls.push({
          id: toolCallId,
          name: toolName,
          arguments: parsedArguments as Record<string, unknown>,
        });
      }

      serializedMessages.push({
        role: "assistant",
        content: message.content,
        toolCalls,
      });
      continue;
    }

    serializedMessages.push({
      role: "tool",
      toolCallId: message.toolCallId,
      content: message.content,
    });
  }

  if (serializedMessages.length === 0) {
    return {
      success: false,
      error: "至少需要一条消息。",
    };
  }

  return {
    success: true,
    data: serializedMessages,
  };
}

export function serializeTools(tools: EditorTool[]):
  | {
      success: true;
      data: LlmToolDefinition[];
    }
  | {
      success: false;
      error: string;
    } {
  const serializedTools: LlmToolDefinition[] = [];
  const seenToolNames = new Set<string>();

  for (const [index, tool] of tools.entries()) {
    const toolName = tool.name.trim();
    if (toolName.length === 0) {
      return {
        success: false,
        error: `第 ${index + 1} 个工具缺少名称。`,
      };
    }

    if (seenToolNames.has(toolName)) {
      return {
        success: false,
        error: `工具名称重复：${toolName}`,
      };
    }
    seenToolNames.add(toolName);

    const properties: Record<string, unknown> = {};
    const seenPropertyNames = new Set<string>();
    for (const property of tool.properties) {
      const propertyName = property.name.trim();
      if (propertyName.length === 0) {
        return {
          success: false,
          error: `工具 ${toolName} 存在未命名属性。`,
        };
      }

      if (seenPropertyNames.has(propertyName)) {
        return {
          success: false,
          error: `工具 ${toolName} 的属性名重复：${propertyName}`,
        };
      }
      seenPropertyNames.add(propertyName);

      const nextSchema: Record<string, unknown> = {
        ...property.rawSchema,
        type: property.type,
      };
      if (property.description.trim().length > 0) {
        nextSchema.description = property.description.trim();
      } else {
        delete nextSchema.description;
      }

      properties[propertyName] = nextSchema;
    }

    serializedTools.push({
      name: toolName,
      ...(tool.description.trim().length > 0 ? { description: tool.description.trim() } : {}),
      parameters: {
        type: "object",
        properties,
      },
    });
  }

  return {
    success: true,
    data: serializedTools,
  };
}

export function serializeToolChoice({
  toolChoiceMode,
  selectedToolNameForChoice,
  currentToolNames,
}:
  | {
      toolChoiceMode: Exclude<ToolChoiceMode, "tool">;
      selectedToolNameForChoice: string;
      currentToolNames: string[];
    }
  | {
      toolChoiceMode: "tool";
      selectedToolNameForChoice: string;
      currentToolNames: string[];
    }):
  | {
      success: true;
      data: LlmPlaygroundChatRequest["toolChoice"];
    }
  | {
      success: false;
      error: string;
    } {
  if (toolChoiceMode !== "tool") {
    return {
      success: true,
      data: toolChoiceMode,
    };
  }

  const toolName = selectedToolNameForChoice.trim();
  if (toolName.length === 0) {
    return {
      success: false,
      error: "请选择 toolChoice 对应的工具。",
    };
  }

  if (!currentToolNames.includes(toolName)) {
    return {
      success: false,
      error: "toolChoice 指定的工具必须存在于当前工具定义列表中。",
    };
  }

  return {
    success: true,
    data: {
      tool_name: toolName,
    },
  };
}

export function formatSchemaIssues(
  issues: Array<{
    path: Array<string | number>;
    message: string;
  }>,
): string {
  return issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function formatHttpError(response: ApiRequestResult): string {
  const body =
    typeof response.body === "string"
      ? response.body
      : response.body
        ? formatJson(response.body)
        : "";
  return [`HTTP ${response.status} ${response.statusText}`.trim(), body].filter(Boolean).join("\n");
}

export function formatJson(value: unknown): string {
  const formatted = JSON.stringify(value, null, 2);
  return formatted ?? "null";
}

export function createDefaultMessages(): EditorMessage[] {
  return [
    {
      id: createEditorId(),
      role: "user",
      parts: [createTextPart("你好")],
    },
  ];
}

export function createMessage(role: EditorRole): EditorMessage {
  if (role === "user") {
    return {
      id: createEditorId(),
      role: "user",
      parts: [createTextPart("")],
    };
  }

  if (role === "assistant") {
    return {
      id: createEditorId(),
      role: "assistant",
      content: "",
      toolCalls: [],
    };
  }

  return {
    id: createEditorId(),
    role: "tool",
    toolCallId: "",
    content: "",
  };
}

export function createTextPart(text: string): EditorTextPart {
  return {
    id: createEditorId(),
    type: "text",
    text,
  };
}

export function createToolCall(): EditorToolCall {
  return {
    id: createEditorId(),
    toolCallId: "",
    name: "",
    argumentsText: "{}",
  };
}

export function createToolEditor(): EditorTool {
  return {
    id: createEditorId(),
    name: "",
    description: "",
    properties: [],
  };
}

export function createToolProperty(): EditorToolProperty {
  return {
    id: createEditorId(),
    name: "",
    type: "string",
    description: "",
    rawSchema: {
      type: "string",
    },
  };
}

export function toolDefinitionToEditor(tool: LlmToolDefinition): EditorTool {
  return {
    id: createEditorId(),
    name: tool.name,
    description: tool.description ?? "",
    properties: Object.entries(tool.parameters.properties).map(([name, rawSchema]) => {
      const objectSchema =
        rawSchema && typeof rawSchema === "object" && !Array.isArray(rawSchema)
          ? (rawSchema as Record<string, unknown>)
          : {};

      return {
        id: createEditorId(),
        name,
        type: normalizeEditorPropertyType(objectSchema.type),
        description: typeof objectSchema.description === "string" ? objectSchema.description : "",
        rawSchema: objectSchema,
      };
    }),
  };
}

export function playgroundMessageToEditor(message: PlaygroundMessage): EditorMessage {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return {
        id: createEditorId(),
        role: "user",
        parts: [createTextPart(message.content)],
      };
    }

    return {
      id: createEditorId(),
      role: "user",
      parts: message.content.map(playgroundContentPartToEditor),
    };
  }

  if (message.role === "assistant") {
    return {
      id: createEditorId(),
      role: "assistant",
      content: message.content,
      toolCalls: message.toolCalls.map(toolCall => ({
        id: createEditorId(),
        toolCallId: toolCall.id,
        name: toolCall.name,
        argumentsText: formatJson(toolCall.arguments),
      })),
    };
  }

  return {
    id: createEditorId(),
    role: "tool",
    toolCallId: message.toolCallId,
    content: message.content,
  };
}

export function playgroundContentPartToEditor(part: PlaygroundContentPart): EditorContentPart {
  if (part.type === "text") {
    return createTextPart(part.text);
  }

  return {
    id: createEditorId(),
    type: "image",
    fileName: part.fileName ?? "",
    mimeType: part.mimeType,
    dataUrl: part.dataUrl,
  };
}

export function normalizeEditorPropertyType(value: unknown): EditorPropertyType {
  if (
    value === "string" ||
    value === "number" ||
    value === "integer" ||
    value === "boolean" ||
    value === "object" ||
    value === "array"
  ) {
    return value;
  }

  return "string";
}

export function convertMessageRole(message: EditorMessage, role: EditorRole): EditorMessage {
  if (message.role === role) {
    return message;
  }

  return createMessage(role);
}

export function moveItem<T extends { id: string }>(
  items: T[],
  itemId: string,
  direction: "up" | "down",
): T[] {
  const index = items.findIndex(item => item.id === itemId);
  if (index < 0) {
    return items;
  }

  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(index, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
}

export function createEditorId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2, 10)}`;
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error("图片读取失败"));
    };
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("图片读取失败"));
    };
    reader.readAsDataURL(file);
  });
}
