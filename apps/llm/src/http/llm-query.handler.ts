import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { llmApiContract } from "@kagami/llm-api/contract";
import type { LlmChatCallWireDetail, LlmChatCallWireSummary } from "@kagami/llm-api/query";
import type {
  LlmChatCallDao,
  LlmChatCallItem,
  LlmChatCallSummary,
} from "../infra/llm-chat-call.dao.js";

type LlmQueryHandlerDeps = {
  llmChatCallDao: LlmChatCallDao;
};

/**
 * console 只读查询端点（epic #539 子 issue 3）：llm 独占库后，console 不再直读
 * llm_chat_call，改经这两条契约路由查询。DB Date → ISO 字符串的序列化在此完成，
 * console 侧拿到的就是 wire 形状、做纯转发聚合。未命中 id 回 found:false，
 * 404 语义由 console 自己翻译（不占用服务间错误通道）。
 */
export class LlmQueryHandler {
  private readonly llmChatCallDao: LlmChatCallDao;

  public constructor({ llmChatCallDao }: LlmQueryHandlerDeps) {
    this.llmChatCallDao = llmChatCallDao;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, llmApiContract.queryLlmChatCalls, async ({ input }) => {
      const [total, items] = await Promise.all([
        this.llmChatCallDao.countByQuery(input),
        this.llmChatCallDao.listPage(input),
      ]);
      return { total, items: items.map(mapSummary) };
    });

    registerJsonRoute(app, llmApiContract.getLlmChatCall, async ({ input }) => {
      const item = await this.llmChatCallDao.findById(input.id);
      if (item === null) {
        return { found: false as const };
      }
      return { found: true as const, item: mapDetail(item) };
    });
  }
}

function mapSummary(item: LlmChatCallSummary): LlmChatCallWireSummary {
  return {
    id: item.id,
    requestId: item.requestId,
    seq: item.seq,
    provider: item.provider,
    model: item.model,
    extension: item.extension,
    status: item.status,
    latencyMs: item.latencyMs,
    createdAt: item.createdAt.toISOString(),
  };
}

function mapDetail(item: LlmChatCallItem): LlmChatCallWireDetail {
  return {
    ...mapSummary(item),
    requestPayload: item.requestPayload,
    responsePayload: item.responsePayload,
    nativeRequestPayload: item.nativeRequestPayload,
    nativeResponsePayload: item.nativeResponsePayload,
    error: item.error,
    nativeError: item.nativeError,
  };
}
