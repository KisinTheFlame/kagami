import type { LlmChatCallObservation } from "@kagami/llm-client";
import type { LlmChatCallDao } from "@kagami/persistence/dao/llm-chat-call.dao";

/**
 * 把一条 LLM observation 落成 llm_chat_call 行（打点等其它订阅动作在调用方，与落库解耦）。
 * 返回 DAO 的 Promise，让 client 内部 emitObservation 统一 catch（写库失败不影响 LLM 结果）。
 *
 * **成功轮刻意不落 native_request_payload**：它是 request_payload 的另一份序列化（同一批
 * messages，只是 provider wire 形状）。ReAct 每轮把当前全部历史重发给 LLM，故这两列都随会话
 * 长度线性增大，一个长会话累计写入 = O(轮数²)，两列并存又把常数翻倍，是 llm_chat_call 磁盘
 * 占用的主要来源。native 请求体几乎只在诊断 provider 侧 native error 时有价值，成功轮无此需求，
 * 丢弃可省掉约一半每行写入。**失败轮完整保留 native_request_payload**（历史上 lone-surrogate
 * 400 之类正是靠它定位）。response 两列体量是 O(1)/行（单条回复、不含历史），不参与平方增长，
 * 保留不动。
 */
export function persistLlmChatCall(
  dao: LlmChatCallDao,
  observation: LlmChatCallObservation,
): Promise<void> {
  if (observation.status === "success") {
    return dao.recordSuccess({
      provider: observation.provider,
      model: observation.model,
      extension: observation.extension,
      requestId: observation.requestId,
      seq: observation.seq,
      latencyMs: observation.latencyMs,
      request: observation.request,
      response: observation.response,
      nativeRequestPayload: null,
      nativeResponsePayload: observation.nativeResponsePayload,
    });
  }

  return dao.recordError({
    provider: observation.provider,
    model: observation.model,
    extension: observation.extension,
    requestId: observation.requestId,
    seq: observation.seq,
    latencyMs: observation.latencyMs,
    request: observation.request,
    ...(observation.response ? { response: observation.response } : {}),
    nativeRequestPayload: observation.nativeRequestPayload,
    nativeResponsePayload: observation.nativeResponsePayload,
    nativeError: observation.nativeError,
    error: observation.error,
  });
}
