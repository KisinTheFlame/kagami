import type { LlmMessage } from "@kagami/llm-client";

/** 阈值触发的自动压缩固定用这一档：摘要前 90%，保留最近 10%。 */
const AUTO_CONTEXT_COMPRESS_RATIO = 90;

export type ContextCompactionPlan = {
  messagesToSummarize: LlmMessage[];
  messagesToKeep: LlmMessage[];
};

/**
 * 纯切片：按「摘要掉前百分之多少」把消息列表切成两段。compressRatio 是整数百分比，
 * 100 = 全部摘要、一条不留。阈值触发的自动压缩与人工面板压缩共用这一份切法，
 * 保证 tool-call 边界这类语义永远不会在两条路径上漂移。
 * 返回 null = 无可压缩（列表为空，或按该比例算下来一条都不该摘要）。
 */
export function createContextCompactionSlice(input: {
  messages: LlmMessage[];
  compressRatio: number;
}): ContextCompactionPlan | null {
  const { messages, compressRatio } = input;
  if (messages.length === 0) {
    return null;
  }

  const keepCount = calculateCompactionKeepCount({
    totalMessageCount: messages.length,
    compressRatio,
  });
  const initialCutIndex = messages.length - keepCount;
  const cutIndex = extendCompactionCutIndexForAssistantToolBoundary({
    messages,
    cutIndex: initialCutIndex,
  });
  if (cutIndex <= 0) {
    return null;
  }

  return {
    messagesToSummarize: messages.slice(0, cutIndex),
    messagesToKeep: messages.slice(cutIndex),
  };
}

export function createContextCompactionPlan(input: {
  messages: LlmMessage[];
  /** null = 本轮 usage 缺失（provider 未回报），此时仅按图片数触发。 */
  totalTokens: number | null;
  totalTokenThreshold: number;
  imageCountThreshold: number;
}): ContextCompactionPlan | null {
  const { messages, totalTokens, totalTokenThreshold, imageCountThreshold } = input;
  if (messages.length === 0) {
    return null;
  }

  const exceedsTokenThreshold = totalTokens !== null && totalTokens > totalTokenThreshold;
  const exceedsImageThreshold = countImageContentParts(messages) > imageCountThreshold;
  if (!exceedsTokenThreshold && !exceedsImageThreshold) {
    return null;
  }

  return createContextCompactionSlice({
    messages,
    compressRatio: AUTO_CONTEXT_COMPRESS_RATIO,
  });
}

function countImageContentParts(messages: LlmMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "user" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "image") {
        count += 1;
      }
    }
  }
  return count;
}

function calculateCompactionKeepCount(input: {
  totalMessageCount: number;
  compressRatio: number;
}): number {
  if (input.compressRatio >= 100 || input.totalMessageCount <= 1) {
    return 0;
  }

  const keepRatio = (100 - input.compressRatio) / 100;
  return Math.max(1, Math.ceil(input.totalMessageCount * keepRatio));
}

/**
 * 把切点向后推到不会拆散「assistant tool_use ↔ 它的 tool 结果」的位置。
 * 判据不是"切点前一条恰好是 assistant"——切点可能落在同一组 tool 结果中间，甚至
 * 中间还夹着别的消息（tool 结果之间允许插入其它消息）。所以这里改成：只要摘要侧
 * 存在某个 assistant 的 tool 结果掉在保留侧，就把边界推到那条结果之后；推完可能
 * 又把新的 assistant 纳入摘要侧，故循环到不再变化为止。
 *
 * 漏掉这一步的后果是保留段以孤儿 tool 消息打头，provider 直接 400。
 */
function extendCompactionCutIndexForAssistantToolBoundary(input: {
  messages: LlmMessage[];
  cutIndex: number;
}): number {
  const { messages, cutIndex } = input;
  if (cutIndex <= 0 || cutIndex >= messages.length) {
    return cutIndex;
  }

  let boundary = cutIndex;
  let extended = true;

  while (extended) {
    extended = false;

    const summarizedToolCallIds = new Set<string>();
    for (let index = 0; index < boundary; index += 1) {
      const message = messages[index];
      if (message?.role === "assistant" && message.toolCalls.length > 0) {
        for (const toolCall of message.toolCalls) {
          summarizedToolCallIds.add(toolCall.id);
        }
      }
    }

    for (let index = boundary; index < messages.length; index += 1) {
      const message = messages[index];
      if (message?.role === "tool" && summarizedToolCallIds.has(message.toolCallId)) {
        boundary = index + 1;
        extended = true;
      }
    }
  }

  return boundary;
}
