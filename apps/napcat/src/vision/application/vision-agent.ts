import type { LlmClient, LlmContentPart } from "@kagami/llm-client";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { createVisionSystemPrompt } from "./system-prompt.js";

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

    const prompt = input.prompt?.trim().length
      ? input.prompt.trim()
      : createVisionSystemPrompt({ tileCount: input.images.length });
    const imageParts: LlmContentPart[] = input.images.map(image => ({
      type: "image",
      // LlmImageContentPart.content 现为 base64 字符串（JSON 安全）；
      // VisionAgent 入参仍收 Buffer 字节，在此边缘转一次。
      content: image.content.toString("base64"),
      mimeType: image.mimeType,
      filename: image.filename,
    }));
    const response = await this.llmClient.chat(
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              ...imageParts,
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      },
      {
        usage: "vision",
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
