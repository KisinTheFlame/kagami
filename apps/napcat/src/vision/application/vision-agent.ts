import type { LlmClient, LlmContentPart } from "@kagami/llm-client";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { createVisionSystemPrompt, createVisionTileNote } from "./system-prompt.js";

type VisionAgentDeps = {
  llmClient: LlmClient;
};

type AnalyzeImagePart = {
  content: Buffer;
  mimeType: string;
  filename?: string;
};

/**
 * images 支持多张：极端长图经 @kagami/image 切片后按序传入（#556），一次调用让 vision
 * 看到全部分片。单图场景传单元素数组。
 */
export type AnalyzeImageInput = {
  images: AnalyzeImagePart[];
  prompt?: string;
};

export type AnalyzeImageResult = {
  description: string;
  provider: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export class VisionAgent {
  private readonly llmClient: LlmClient;

  public constructor({ llmClient }: VisionAgentDeps) {
    this.llmClient = llmClient;
  }

  public async analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult> {
    validateAnalyzeImageInput(input);

    const systemPrompt = input.prompt?.trim().length
      ? input.prompt.trim()
      : createVisionSystemPrompt();
    const imageParts: LlmContentPart[] = input.images.map(image => ({
      type: "image",
      // LlmImageContentPart.content 现为 base64 字符串（JSON 安全）；
      // VisionAgent 入参仍收 Buffer 字节，在此边缘转一次。
      content: image.content.toString("base64"),
      mimeType: image.mimeType,
      filename: image.filename,
    }));
    // 切片场景（同一超长图切成多片，#556）：分片说明放进 user turn、图片之前。它带每次会变的
    // tileCount，绝不进被缓存的 system 前缀（KV 缓存红线，#594）。
    const userContent: LlmContentPart[] =
      input.images.length > 1
        ? [
            { type: "text", text: createVisionTileNote({ tileCount: input.images.length }) },
            ...imageParts,
          ]
        : imageParts;
    const response = await this.llmClient.chat(
      {
        // 稳定指令走 system 字段：与 billing+sdk 一起被缓存断点覆盖，跨 vision 调用命中
        // prompt cache（#594）；图片留在 user turn、断点之后，不进缓存。
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
        tools: [],
        toolChoice: "none",
      },
      {
        usage: "vision",
        scene: "vision",
      },
    );

    const description = response.message.content.trim();
    if (description.length === 0) {
      throw new BizError({
        message: "图片理解结果为空",
        meta: {
          provider: response.provider,
          model: response.model,
          reason: "EMPTY_CONTENT",
        },
      });
    }

    return {
      description,
      provider: response.provider,
      model: response.model,
      usage: response.usage,
    };
  }
}

function validateAnalyzeImageInput(input: AnalyzeImageInput): void {
  if (input.images.length === 0) {
    throw new BizError({
      message: "VisionAgent.analyzeImage requires at least one image",
      meta: { reason: "EMPTY_CONTENT" },
    });
  }

  for (const image of input.images) {
    if (image.content.byteLength === 0) {
      throw new BizError({
        message: "VisionAgent.analyzeImage requires non-empty image content",
        meta: { reason: "EMPTY_CONTENT" },
      });
    }

    if (image.mimeType.trim().length === 0) {
      throw new BizError({
        message: "VisionAgent.analyzeImage requires a mimeType",
        meta: { reason: "MISSING_MIME_TYPE" },
      });
    }

    if (!image.mimeType.toLowerCase().startsWith("image/")) {
      throw new BizError({
        message: "VisionAgent.analyzeImage only accepts image/* mime types",
        meta: { reason: "INVALID_MIME_TYPE", mimeType: image.mimeType },
      });
    }
  }
}
