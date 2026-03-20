import type { LlmClient } from "../llm/client.js";
import { BizError } from "../errors/biz-error.js";

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

const DEFAULT_VISION_PROMPT = [
  "请把这张图片转成适合聊天上下文的一小段中文文本。",
  "只输出最终描述，不要标题、不要分点、不要 Markdown、不要补充说明、不要提出后续建议。",
  "优先保留最影响理解上下文的信息：主体、动作、场景、可见文字、数字、时间、地点、关键界面信息。",
  "如果是截图或界面，提炼最关键的页面内容，不要把每个按钮和布局都详细列出来。",
  "控制在 1 段内，尽量简洁；通常 1 到 3 句即可。",
  "不要编造未出现的内容，不确定时省略或用简短措辞说明。",
].join("\n");

export class VisionAgent {
  private readonly llmClient: LlmClient;

  public constructor({ llmClient }: VisionAgentDeps) {
    this.llmClient = llmClient;
  }

  public async analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult> {
    validateAnalyzeImageInput(input);

    const prompt = input.prompt?.trim().length ? input.prompt.trim() : DEFAULT_VISION_PROMPT;
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
