import type { LlmClient } from "../../../../llm/client.js";
import { BizError } from "../../../../common/errors/biz-error.js";
import { createVisionSystemPrompt } from "./system-prompt.js";

type VisionAgentDeps = {
  llmClient: LlmClient;
};

export type AnalyzeImageInput = {
  content: Buffer;
  mimeType: string;
  filename?: string;
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

    const prompt = input.prompt?.trim().length ? input.prompt.trim() : createVisionSystemPrompt();
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
              {
                type: "image",
                content: input.content,
                mimeType: input.mimeType,
                filename: input.filename,
              },
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
  if (input.content.byteLength === 0) {
    throw new Error("VisionAgent.analyzeImage requires non-empty image content");
  }

  if (input.mimeType.trim().length === 0) {
    throw new Error("VisionAgent.analyzeImage requires a mimeType");
  }

  if (!input.mimeType.toLowerCase().startsWith("image/")) {
    throw new Error("VisionAgent.analyzeImage only accepts image/* mime types");
  }
}
