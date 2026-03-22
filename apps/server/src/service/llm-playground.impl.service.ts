import type {
  LlmPlaygroundToolListResponse,
  LlmPlaygroundChatRequest,
  LlmPlaygroundChatResponse,
  LlmToolDefinition,
  PlaygroundContentPart,
  LlmProviderListResponse,
  PlaygroundMessage,
} from "@kagami/shared";
import { BizError } from "../errors/biz-error.js";
import type { LlmClient } from "../llm/client.js";
import type { LlmChatRequest, LlmContentPart, LlmMessage } from "../llm/types.js";
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
    return this.llmClient.chatDirect(toLlmChatRequest(input), {
      providerId: input.provider,
      model: input.model,
      recordCall: false,
    });
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

function parseImageDataUrl(dataUrl: string): { mimeType: string; content: Buffer } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw new BizError({
      message: "图片 dataUrl 不合法",
      statusCode: 400,
    });
  }

  const [, mimeType, encoded] = match;
  try {
    const content = Buffer.from(encoded, "base64");
    if (content.byteLength === 0) {
      throw new Error("empty");
    }

    return {
      mimeType,
      content,
    };
  } catch (error) {
    throw new BizError({
      message: "图片 base64 数据解析失败",
      statusCode: 400,
      cause: error,
    });
  }
}
