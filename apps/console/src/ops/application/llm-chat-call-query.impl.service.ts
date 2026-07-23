import {
  type LlmChatCallDetailResponse,
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
} from "@kagami/console-api/llm-chat-call";
import type { JsonClient } from "@kagami/rpc-client/client";
import type { llmApiContract } from "@kagami/llm-api/contract";
import type { LlmChatCallQueryService } from "./llm-chat-call-query.service.js";
import { mapLlmChatCallDetail, mapLlmChatCallList } from "../mappers/llm-chat-call.mapper.js";
import { BizError } from "@kagami/kernel/errors/biz-error";

/** 只依赖用到的两条查询路由，其余 llm 契约（chat/embed 等内部 RPC）与 console 无关。 */
export type LlmQueryClient = Pick<
  JsonClient<typeof llmApiContract>,
  "queryLlmChatCalls" | "getLlmChatCall"
>;

type DefaultLlmChatCallQueryServiceDeps = {
  llmQueryClient: LlmQueryClient;
};

/**
 * llm_chat_call 查询：epic #539 子 issue 3 起 console 不再直读共享库，改经 llm 契约
 * 路由查询（llm 独占 llm.db）。console 只做转发聚合；未命中 id 的 404 语义在此翻译。
 */
export class DefaultLlmChatCallQueryService implements LlmChatCallQueryService {
  private readonly llmQueryClient: LlmQueryClient;

  public constructor({ llmQueryClient }: DefaultLlmChatCallQueryServiceDeps) {
    this.llmQueryClient = llmQueryClient;
  }

  public async queryList(query: LlmChatCallListQuery): Promise<LlmChatCallListResponse> {
    const { total, items } = await this.llmQueryClient.queryLlmChatCalls({
      provider: query.provider,
      model: query.model,
      scene: query.scene,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });

    return mapLlmChatCallList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }

  public async getDetail(id: number): Promise<LlmChatCallDetailResponse> {
    const result = await this.llmQueryClient.getLlmChatCall({ id });
    if (!result.found) {
      throw new BizError({
        message: "LLM 调用记录不存在",
        meta: {
          reason: "LLM_CHAT_CALL_NOT_FOUND",
          id,
        },
        statusCode: 404,
      });
    }

    return mapLlmChatCallDetail(result.item);
  }
}
