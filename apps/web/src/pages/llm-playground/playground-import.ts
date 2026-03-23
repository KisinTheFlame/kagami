import {
  type LlmChatCallItem,
  type LlmPlaygroundChatRequest,
  type LlmProviderOption,
  type PlaygroundContentPart,
  type PlaygroundMessage,
} from "@kagami/shared";
import type {
  ParsedLlmChatRequestPayload,
  ParsedLlmRequestMessage,
  ParsedLlmUserContentPart,
} from "@/pages/llm-history/llm-chat-call-detail-parser";

export type PlaygroundImportWarningCode =
  | "image_omitted"
  | "provider_unavailable"
  | "model_unavailable"
  | "no_provider_available";

export type PlaygroundImportWarning = {
  code: PlaygroundImportWarningCode;
  message: string;
};

export type PlaygroundImportSource = {
  itemId: number;
  requestId: string;
  createdAt: string;
  provider: string;
  model: string;
  status: LlmChatCallItem["status"];
};

export type PlaygroundImportDraft = {
  source: PlaygroundImportSource;
  payload: LlmPlaygroundChatRequest;
  warnings: PlaygroundImportWarning[];
};

export type PlaygroundImportLocationState = {
  playgroundImport: PlaygroundImportDraft;
};

export type ResolvedPlaygroundImport = {
  source: PlaygroundImportSource;
  payload: LlmPlaygroundChatRequest;
  selectedProviderId: LlmPlaygroundChatRequest["provider"] | "";
  selectedModel: string;
  warnings: PlaygroundImportWarning[];
};

export function buildPlaygroundImportDraftFromHistory(params: {
  item: LlmChatCallItem;
  request: ParsedLlmChatRequestPayload;
}): PlaygroundImportDraft {
  const { item, request } = params;
  const imageStats = { count: 0 };
  const messages = request.messages.map(message =>
    toPlaygroundMessage({
      message,
      imageStats,
    }),
  );
  const warnings: PlaygroundImportWarning[] = [];

  if (imageStats.count > 0) {
    warnings.push({
      code: "image_omitted",
      message: `本次导入忽略了 ${imageStats.count} 个图片片段，已在消息中保留文本占位说明。`,
    });
  }

  return {
    source: {
      itemId: item.id,
      requestId: item.requestId,
      createdAt: item.createdAt,
      provider: item.provider,
      model: item.model,
      status: item.status,
    },
    payload: {
      provider: item.provider as LlmPlaygroundChatRequest["provider"],
      model: request.model ?? item.model,
      ...(request.system ? { system: request.system } : {}),
      messages,
      tools: request.tools,
      toolChoice: request.toolChoice,
    },
    warnings,
  };
}

export function resolvePlaygroundImportDraft(params: {
  draft: PlaygroundImportDraft;
  providers: LlmProviderOption[];
}): ResolvedPlaygroundImport {
  const { draft, providers } = params;
  const warnings = [...draft.warnings];

  if (providers.length === 0) {
    warnings.push({
      code: "no_provider_available",
      message: "当前没有可用 provider，已保留导入的上下文内容，待服务端配置后再发送请求。",
    });

    return {
      source: draft.source,
      payload: draft.payload,
      selectedProviderId: "",
      selectedModel: "",
      warnings,
    };
  }

  const matchedProvider = providers.find(provider => provider.id === draft.payload.provider);
  const resolvedProvider = matchedProvider ?? providers[0];

  if (!matchedProvider) {
    warnings.push({
      code: "provider_unavailable",
      message: `历史 provider ${draft.payload.provider} 当前不可用，已切换到 ${resolvedProvider.id}。`,
    });
  }

  const matchedModel = resolvedProvider.models.includes(draft.payload.model);
  const resolvedModel = matchedModel ? draft.payload.model : resolvedProvider.models[0];

  if (!matchedModel) {
    warnings.push({
      code: "model_unavailable",
      message: `历史 model ${draft.payload.model} 不在 provider ${resolvedProvider.id} 的当前配置中，已切换到 ${resolvedModel}。`,
    });
  }

  return {
    source: draft.source,
    payload: {
      ...draft.payload,
      provider: resolvedProvider.id,
      model: resolvedModel,
    },
    selectedProviderId: resolvedProvider.id,
    selectedModel: resolvedModel,
    warnings,
  };
}

export function getPlaygroundImportDraftFromLocationState(
  state: unknown,
): PlaygroundImportDraft | null {
  if (!isRecord(state) || !("playgroundImport" in state)) {
    return null;
  }

  const draft = state.playgroundImport;
  return isRecord(draft) ? (draft as PlaygroundImportDraft) : null;
}

function toPlaygroundMessage(params: {
  message: ParsedLlmRequestMessage;
  imageStats: { count: number };
}): PlaygroundMessage {
  const { message, imageStats } = params;
  if (message.role === "user") {
    return {
      role: "user",
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map(part => toPlaygroundContentPart({ part, imageStats })),
    };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      toolCalls: message.toolCalls,
    };
  }

  return {
    role: "tool",
    toolCallId: message.toolCallId,
    content: message.content,
  };
}

function toPlaygroundContentPart(params: {
  part: ParsedLlmUserContentPart;
  imageStats: { count: number };
}): PlaygroundContentPart {
  const { part, imageStats } = params;
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
    };
  }

  imageStats.count += 1;
  return {
    type: "text",
    text: buildImagePlaceholderText(part),
  };
}

function buildImagePlaceholderText(
  part: Extract<ParsedLlmUserContentPart, { type: "image" }>,
): string {
  const meta = [
    part.filename ? `文件名：${part.filename}` : null,
    part.mimeType ? `MIME：${part.mimeType}` : null,
    typeof part.sizeBytes === "number" ? `大小：${part.sizeBytes} B` : null,
  ].filter((value): value is string => value !== null);

  return meta.length > 0
    ? `[图片已忽略：原图未保存在历史记录中；${meta.join("；")}]`
    : "[图片已忽略：原图未保存在历史记录中]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
