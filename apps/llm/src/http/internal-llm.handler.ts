import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerJsonRoute } from "@kagami/http/contract";
import { llmApiContract } from "@kagami/llm-api/contract";
import type { LlmProviderId } from "@kagami/llm";
import type { LlmUsageId } from "@kagami/kernel/contracts/llm";
import type { LlmClient, LlmChatRequest } from "@kagami/llm-client";
import type { EmbeddingClient, EmbeddingRequest } from "@kagami/llm-client/embedding";

// Agent-facing 内部 RPC。请求体是可信的内部契约（agent HttpLlmClient 直连、仅 localhost），
// 故 request/EmbeddingRequest 用 z.unknown() 透传后按类型断言——复杂 union（LlmMessage/Tool）
// 不做逐字段 zod，只校验信封外壳。抛出的 BizError 由 runtime setErrorHandler 统一序列化成
// 富错误信封，agent 侧据此重建 BizError。
const ChatBody = z.object({
  request: z.unknown(),
  usage: z.string().min(1),
  recordCall: z.boolean().optional(),
});
const ChatDirectBody = z.object({
  request: z.unknown(),
  providerId: z.string().min(1),
  model: z.string().min(1),
  recordCall: z.boolean().optional(),
});
const EmbedBody = z.object({
  request: z.unknown(),
});

export class InternalLlmHandler {
  private readonly llmClient: LlmClient;
  private readonly embeddingClient: EmbeddingClient;

  public constructor({
    llmClient,
    embeddingClient,
  }: {
    llmClient: LlmClient;
    embeddingClient: EmbeddingClient;
  }) {
    this.llmClient = llmClient;
    this.embeddingClient = embeddingClient;
  }

  public register(app: FastifyInstance): void {
    app.post("/internal/chat", async request => {
      const body = ChatBody.parse(request.body);
      return await this.llmClient.chat(body.request as LlmChatRequest, {
        usage: body.usage as LlmUsageId,
        ...(body.recordCall === undefined ? {} : { recordCall: body.recordCall }),
      });
    });

    app.post("/internal/chat-direct", async request => {
      const body = ChatDirectBody.parse(request.body);
      return await this.llmClient.chatDirect(body.request as LlmChatRequest, {
        providerId: body.providerId as LlmProviderId,
        model: body.model,
        ...(body.recordCall === undefined ? {} : { recordCall: body.recordCall }),
      });
    });

    // providers 路由走契约（@kagami/llm-api）：input/output 由 llmApiContract.listProviders 反推，
    // 与 agent 侧 createClient 共享同一份 schema —— 改契约 output，此 execute 返回类型与 agent 调用点同时红。
    registerJsonRoute(app, llmApiContract.listProviders, async ({ input }) => {
      return await this.llmClient.listAvailableProviders({ usage: input.usage as LlmUsageId });
    });

    app.post("/internal/embed", async request => {
      const body = EmbedBody.parse(request.body);
      return await this.embeddingClient.embed(body.request as EmbeddingRequest);
    });
  }
}
