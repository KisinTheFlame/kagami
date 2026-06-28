import type { LlmMessage } from "../../../llm/types.js";

const CONTEXT_COMPACTION_KEEP_RATIO = 0.1;

export type ContextCompactionPlan = {
  messagesToSummarize: LlmMessage[];
  messagesToKeep: LlmMessage[];
};

export function createContextCompactionPlan(input: {
  messages: LlmMessage[];
  totalTokens: number;
  totalTokenThreshold: number;
}): ContextCompactionPlan | null {
  const { messages, totalTokens, totalTokenThreshold } = input;
  if (messages.length === 0 || totalTokens <= totalTokenThreshold) {
    return null;
  }

  const keepCount = calculateCompactionKeepCount({
    totalMessageCount: messages.length,
  });
  const initialCutIndex = messages.length - keepCount;
  const cutIndex = extendCompactionCutIndexForAssistantToolBoundary({
    messages,
    cutIndex: initialCutIndex,
  });

  return {
    messagesToSummarize: messages.slice(0, cutIndex),
    messagesToKeep: messages.slice(cutIndex),
  };
}

function calculateCompactionKeepCount(input: { totalMessageCount: number }): number {
  if (input.totalMessageCount <= 1) {
    return 0;
  }

  return Math.max(1, Math.ceil(input.totalMessageCount * CONTEXT_COMPACTION_KEEP_RATIO));
}

function extendCompactionCutIndexForAssistantToolBoundary(input: {
  messages: LlmMessage[];
  cutIndex: number;
}): number {
  const { messages, cutIndex } = input;
  if (cutIndex <= 0 || cutIndex >= messages.length) {
    return cutIndex;
  }

  const boundaryMessage = messages[cutIndex - 1];
  if (boundaryMessage?.role !== "assistant" || boundaryMessage.toolCalls.length === 0) {
    return cutIndex;
  }

  const toolCallIds = new Set(boundaryMessage.toolCalls.map(toolCall => toolCall.id));
  let lastMatchingToolIndex = -1;

  for (let index = cutIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "tool" && toolCallIds.has(message.toolCallId)) {
      lastMatchingToolIndex = index;
    }
  }

  return lastMatchingToolIndex >= 0 ? lastMatchingToolIndex + 1 : cutIndex;
}
