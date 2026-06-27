import {
  type LlmPlaygroundToolListResponse,
  type LlmPlaygroundChatRequest,
  type LlmPlaygroundChatResponse,
  type LlmToolDefinition,
  type PlaygroundContentPart,
  type LlmProviderListResponse,
  type PlaygroundMessage,
} from "@kagami/shared/schemas/llm-chat";
import { BizError } from "@kagami/server-core/common/errors/biz-error";
import type { LlmClient } from "../client.js";
import type { LlmChatRequest, LlmContentPart, LlmMessage } from "../types.js";
import type { LlmPlaygroundService } from "./llm-playground.service.js";

type DefaultLlmPlaygroundServiceDeps = {
  llmClient: LlmClient;
  playgroundToolDefinitions: LlmToolDefinition[];
};

export class DefaultLlmPlaygroundService implements LlmPlaygroundService {
  private readonly llmClient: LlmClient;
  private readonly playgroundToolDefinitions: LlmToolDefinition[];

  public constructor({ llmClient, playgroundToolDefinitions }: DefaultLlmPlaygroundServiceDeps) {
    this.llmClient = llmClient;
    this.playgroundToolDefinitions = playgroundToolDefinitions;
  }

  public async listProviders(): Promise<LlmProviderListResponse> {
    return {
      providers: await this.llmClient.listAvailableProviders({ usage: "agent" }),
    };
  }

  public async listPlaygroundTools(): Promise<LlmPlaygroundToolListResponse> {
    return {
      tools: this.playgroundToolDefinitions,
    };
  }

  public async chat(input: LlmPlaygroundChatRequest): Promise<LlmPlaygroundChatResponse> {
    const result = await this.llmClient.chatDirect(toLlmChatRequest(input), {
      providerId: input.provider,
      model: input.model,
      recordCall: false,
    });

    return {
      ...result.response,
      nativeRequestPayload: result.nativeRequestPayload,
    };
  }
}

function toLlmChatRequest(input: LlmPlaygroundChatRequest): LlmChatRequest {
  return {
    ...(input.system ? { system: input.system } : {}),
    messages: input.messages.map(toLlmMessage),
    tools: input.tools,
    toolChoice: input.toolChoice,
  };
}

function toLlmMessage(message: PlaygroundMessage): LlmMessage {
  if (message.role === "user") {
    return {
      role: "user",
      content:
        typeof message.content === "string" ? message.content : message.content.map(toLlmPart),
    };
  }

  if (message.role === "assistant") {
    return message;
  }

  return message;
}

function toLlmPart(part: PlaygroundContentPart): LlmContentPart {
  if (part.type === "text") {
    return part;
  }

  const parsed = parseImageDataUrl(part.dataUrl);
  if (parsed.mimeType !== part.mimeType) {
    throw new BizError({
      message: "图片 MIME 类型与 dataUrl 不匹配",
      statusCode: 400,
      meta: {
        mimeType: part.mimeType,
      },
    });
  }

  return {
    type: "image",
    content: parsed.content,
    mimeType: parsed.mimeType,
    ...(part.fileName ? { filename: part.fileName } : {}),
  };
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; content: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw new BizError({
      message: "图片 dataUrl 不合法",
      statusCode: 400,
    });
  }

  const [, mimeType, encoded] = match;
  try {
    // 校验 base64 合法且非空，但 LlmImageContentPart.content 直接存 base64 字符串
    // （JSON 安全），不再转成 Buffer。
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.byteLength === 0) {
      throw new Error("empty");
    }

    return {
      mimeType,
      content: encoded,
    };
  } catch (error) {
    throw new BizError({
      message: "图片 base64 数据解析失败",
      statusCode: 400,
      cause: error,
    });
  }
}
