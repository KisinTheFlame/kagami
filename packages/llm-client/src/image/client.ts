import type { Config } from "@kagami/kernel/config/config.loader";
import type { OpenAiCodexAuthProvider } from "../providers/openai-codex-auth.js";
import { createOpenAiCodexImageProvider } from "./providers/openai-codex-image-provider.js";
import type { ImageProvider } from "./provider.js";
import type { ImageGenerationRequest, ImageGenerationResult } from "./types.js";

type ImageConfig = Config["server"]["llm"]["image"];

export interface ImageClient {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

type CreateImageClientOptions = {
  config: ImageConfig;
  /** LLM 全局超时（复用 llm.timeoutMs）；生图为多秒级操作。 */
  timeoutMs: number;
  /** openai-codex provider 的 OAuth 凭据端口（同 chat runtime 注入 authModule.authServices.codex）。 */
  codexAuthStore?: OpenAiCodexAuthProvider;
  /** 测试 seam：直接注入 provider，绕过 config 选择。 */
  provider?: ImageProvider;
};

/**
 * 生图 client 工厂，与 [[embedding/client#createEmbeddingClient]] 对称。不做缓存——同 prompt
 * 每次出图不同，缓存无意义（与 embedding 的确定性去重相反）。client 只做「按 config 兜默认参数 +
 * 选 provider」，字节字节透传。
 */
export function createImageClient(options: CreateImageClientOptions): ImageClient {
  const provider = options.provider ?? createImageProvider(options);

  return {
    async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
      return await provider.generate(resolveImageRequest(request, options.config));
    },
  };
}

function resolveImageRequest(
  request: ImageGenerationRequest,
  config: ImageConfig,
): ImageGenerationRequest {
  // 只兜路由 model。size/quality 不给 config 默认：codex 忽略它们（固定 1254×1254），给默认只会
  // 造成「配了就以为生效」的错觉。调用方显式传才透传，交由 provider / 未来标准-API provider 处理。
  return {
    prompt: request.prompt,
    model: request.model ?? config.model,
    ...(request.size ? { size: request.size } : {}),
    ...(request.quality ? { quality: request.quality } : {}),
  };
}

function createImageProvider(options: CreateImageClientOptions): ImageProvider {
  // config 是 discriminatedUnion，当前仅 openai-codex 一个成员。
  if (!options.codexAuthStore) {
    throw new Error("openai-codex image provider requires a codex auth store");
  }

  return createOpenAiCodexImageProvider({
    config: {
      baseUrl: options.config.baseUrl,
      model: options.config.model,
      timeoutMs: options.timeoutMs,
    },
    authStore: options.codexAuthStore,
  });
}
