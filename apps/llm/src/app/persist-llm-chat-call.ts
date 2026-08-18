import type { LlmChatCallObservation } from "@kagami/llm-client";
import type { LlmChatCallDao, LlmChatCallWriteStats } from "../infra/llm-chat-call.dao.js";

/**
 * 把一条 LLM observation 落成 llm_chat_call 行（打点等其它订阅动作在调用方，与落库解耦）。
 * 返回 DAO 的 Promise，让 client 内部 emitObservation 统一 catch（写库失败不影响 LLM 结果）。
 *
 * **请求体不再行内存储**（issue #612）：`messages` 逐条进内容寻址的 `llm_blob`，行内只留有序
 * blob id。ReAct 每轮重发全历史，逐轮存完整副本让单会话累计写入呈 O(轮数²)；实测 23104 条
 * message 引用里只有 11% 唯一，去重后写入降到 O(轮数)，同 requestId 的重试 seq 更是零新增。
 *
 * **`native_request_payload` 已彻底不落**：它只是 request 的另一份 provider wire 序列化，
 * 占了改动前一半的空间。**`native_error` / `native_response_payload` 仍完整保留**——它们是
 * O(1)/行，且是 provider 侧 4xx 真因的唯一落点（`prompt is too long`、lone-surrogate 400
 * 这类只在这里看得到）。
 */
export function persistLlmChatCall(
  dao: LlmChatCallDao,
  observation: LlmChatCallObservation,
): Promise<LlmChatCallWriteStats> {
  if (observation.status === "success") {
    return dao.recordSuccess({
      provider: observation.provider,
      model: observation.model,
      scene: observation.scene,
      extension: observation.extension,
      requestId: observation.requestId,
      seq: observation.seq,
      latencyMs: observation.latencyMs,
      request: observation.request,
      response: observation.response,
      nativeResponsePayload: observation.nativeResponsePayload,
    });
  }

  return dao.recordError({
    provider: observation.provider,
    model: observation.model,
    scene: observation.scene,
    extension: observation.extension,
    requestId: observation.requestId,
    seq: observation.seq,
    latencyMs: observation.latencyMs,
    request: observation.request,
    ...(observation.response ? { response: observation.response } : {}),
    nativeResponsePayload: observation.nativeResponsePayload,
    nativeError: observation.nativeError,
    error: observation.error,
  });
}
