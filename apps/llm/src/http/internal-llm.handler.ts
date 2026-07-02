import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/contract";
import { llmApiContract } from "@kagami/llm-api/contract";
import type { LlmProviderId } from "@kagami/llm";
import type { LlmUsageId } from "@kagami/kernel/contracts/llm";
import type { LlmClient, LlmChatRequest } from "@kagami/llm-client";
import type { EmbeddingClient, EmbeddingRequest } from "@kagami/llm-client/embedding";

// Agent-facing 内部 RPC，全量走 @kagami/llm-api 契约（单一事实源，与 agent 侧 createClient 共享 schema）。
// chat/chat-direct/embed 的 request 是可信内部契约（agent 直连、仅 localhost）的复杂 union（LlmMessage/
// Tool/EmbeddingRequest），契约刻意用 z.unknown() 只校验信封、透传后按类型断言——见 llm-api/contract。
// 抛出的 BizError 由 runtime setErrorHandler 统一序列化成富错误信封，agent 侧据此重建 BizError。
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
    registerJsonRoute(app, llmApiContract.chat, async ({ input }) => {
      return await this.llmClient.chat(input.request as LlmChatRequest, {
        usage: input.usage as LlmUsageId,
        ...(input.recordCall === undefined ? {} : { recordCall: input.recordCall }),
      });
    });

    registerJsonRoute(app, llmApiContract.chatDirect, async ({ input }) => {
      return await this.llmClient.chatDirect(input.request as LlmChatRequest, {
        providerId: input.providerId as LlmProviderId,
        model: input.model,
        ...(input.recordCall === undefined ? {} : { recordCall: input.recordCall }),
      });
    });

    // providers 路由是编译期强制样板：input/output 由 llmApiContract.listProviders 反推，与 agent 侧
    // createClient 共享同一份 schema —— 改契约 output，此 execute 返回类型与 agent 调用点同时红。
    registerJsonRoute(app, llmApiContract.listProviders, async ({ input }) => {
      return await this.llmClient.listAvailableProviders({ usage: input.usage as LlmUsageId });
    });

    registerJsonRoute(app, llmApiContract.embed, async ({ input }) => {
      return await this.embeddingClient.embed(input.request as EmbeddingRequest);
    });
  }
}
