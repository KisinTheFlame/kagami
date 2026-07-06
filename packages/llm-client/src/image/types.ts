/**
 * 生图（image generation）能力的抽象层类型，与 [[embedding/types]] 平级：都是「非 chat 的第二类
 * LLM 能力」。抽象层保持纯粹——「给 prompt，回原始字节」，落 OSS / 发 QQ 属消费端职责，不进本包。
 */
export type ImageProviderId = "openai-codex";

export type ImageGenerationRequest = {
  prompt: string;
  /**
   * 目标尺寸，如 "1024x1024" | "1024x1536" | "1536x1024" | "auto"。**是否生效取决于 provider**：
   * openai-codex 后端忽略它（固定回 1254×1254，实测确证）；未来的标准平台-API provider 才认。
   */
  size?: string;
  /** 质量档，如 "low" | "medium" | "high" | "auto"。同 size，openai-codex 后端不认。 */
  quality?: string;
  /** 路由模型（如 gpt-5.4）；缺省由 client 从 config 兜。实际出图由后端 image 模型完成。 */
  model?: string;
};

/** 进程内的原始图片字节（未 base64）。HTTP 边界的 base64 编码是传输层职责，不落在抽象层。 */
export type GeneratedImage = {
  data: Uint8Array;
  mimeType: string;
};

export type ImageGenerationResult = {
  provider: ImageProviderId;
  model: string;
  image: GeneratedImage;
  /** 后端改写后的实际 prompt（若返回）。 */
  revisedPrompt?: string;
  /** 后端实际出图尺寸（若返回）。 */
  size?: string;
};
