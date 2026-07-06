import type { ImageGenerationRequest, ImageGenerationResult, ImageProviderId } from "./types.js";

/**
 * 生图 provider 抽象，与 [[embedding/provider]] 对称。带可选 `isAvailable`（同 chat provider）：
 * OAuth 型 provider（openai-codex）据此暴露「凭据是否就绪」。
 */
export interface ImageProvider {
  id: ImageProviderId;
  isAvailable?(): Promise<boolean>;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
