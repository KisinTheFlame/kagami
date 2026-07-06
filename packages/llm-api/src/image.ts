/**
 * 生图路由（`/internal/generate-image`）的 HTTP 响应体（wire 形态）。抽象层的 `ImageGenerationResult`
 * 带原始字节 `Uint8Array`，跨 HTTP 无法直接序列化，故 handler 在传输边界把字节 base64 化成本 DTO。
 * base64 传输沿用 chat 路径既有做法（该 llm-service 本就承载 base64 图片，见 bodyLimit 注释）。
 *
 * 纯 type（非 zod schema）：本路由 output 与 chat/embed 一致走信封级 `z.unknown()`，wire 结构不进
 * Zod 运行时校验、消费端按类型断言，故这里只需编译期形状、不留装饰性 schema value。
 */
export type GenerateImageResult = {
  provider: string;
  model: string;
  mimeType: string;
  imageBase64: string;
  revisedPrompt?: string;
  size?: string;
};
