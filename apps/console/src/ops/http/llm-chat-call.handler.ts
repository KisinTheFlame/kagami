import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { consoleApiContract } from "@kagami/console-api/contract";
import type { LlmChatCallQueryService } from "../application/llm-chat-call-query.service.js";

type LlmChatCallHandlerDeps = {
  llmChatCallQueryService: LlmChatCallQueryService;
};

/** LLM 调用历史查询路由。路由与 schema 的单一事实源在 @kagami/console-api（#279 PR4）。 */
export class LlmChatCallHandler {
  private readonly llmChatCallQueryService: LlmChatCallQueryService;

  public constructor({ llmChatCallQueryService }: LlmChatCallHandlerDeps) {
    this.llmChatCallQueryService = llmChatCallQueryService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, consoleApiContract.queryLlmChatCalls, ({ input }) =>
      this.llmChatCallQueryService.queryList(input),
    );

    registerJsonRoute(app, consoleApiContract.getLlmChatCallDetail, ({ params }) =>
      this.llmChatCallQueryService.getDetail(params.id),
    );
  }
}
