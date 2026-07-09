import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { llmProvidersViewContract } from "@kagami/llm-api/providers-view";
import type { LlmProviderListResponse } from "@kagami/llm-api/llm-chat";
import type { LlmClient } from "@kagami/llm-client";

/**
 * 管理台「LLM 调用历史」按 provider 过滤用的 provider 列举路由（console-facing，经 gateway
 * `/llm/providers` 前缀直连 kagami-llm，取代原 agent 中转）。以 agent 视角固定列举——与历史记录
 * 的调用来源一致。契约 output 是 `{ providers }`，而 listAvailableProviders 回的是数组，故显式包壳。
 */
export class LlmProvidersViewHandler {
  private readonly llmClient: LlmClient;

  public constructor({ llmClient }: { llmClient: LlmClient }) {
    this.llmClient = llmClient;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(
      app,
      llmProvidersViewContract.listProviders,
      async (): Promise<LlmProviderListResponse> => {
        return { providers: await this.llmClient.listAvailableProviders({ usage: "agent" }) };
      },
    );
  }
}
