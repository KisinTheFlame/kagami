import type { LlmMessage } from "@kagami/llm-client";
import { classifyRootToolCall, type InnerVoiceIdleSignals } from "./idle-detector.js";

/** 注入进上下文的 `<inner_thought>` 伪标签，回扫时凭它辨识历史注入。 */
export const INNER_THOUGHT_TAG = "<inner_thought>";

/**
 * 从 ledger 记录（时间升序或任意序）重建摸鱼判定信号：
 * - assistant 消息的 toolCalls 可辨识 wait 与投入型 invoke 子工具；
 * - 含 `<inner_thought>` 的 user 消息即历史注入（近似注入尝试；空输出的尝试不落
 *   ledger，重启后不应期按实际注入算，属可接受的宽松侧偏差）。
 *
 * 纯函数：重启回扫恢复与 14 天回放脚本共用同一套辨识逻辑。
 */
export function collectInnerVoiceIdleSignals(
  records: ReadonlyArray<{ message: LlmMessage; createdAt: Date }>,
): InnerVoiceIdleSignals {
  const waitAt: Date[] = [];
  const engagedAt: Date[] = [];
  const attemptAt: Date[] = [];

  for (const record of records) {
    const { message, createdAt } = record;
    if (message.role === "assistant") {
      for (const toolCall of message.toolCalls) {
        const kind = classifyRootToolCall({
          name: toolCall.name,
          argumentsValue: toolCall.arguments,
        });
        if (kind === "wait") {
          waitAt.push(createdAt);
        } else if (kind === "engaged") {
          engagedAt.push(createdAt);
        }
      }
      continue;
    }

    if (message.role === "user" && isInnerThoughtMessage(message.content)) {
      attemptAt.push(createdAt);
    }
  }

  return { waitAt, engagedAt, attemptAt };
}

function isInnerThoughtMessage(content: Extract<LlmMessage, { role: "user" }>["content"]): boolean {
  if (typeof content === "string") {
    return content.includes(INNER_THOUGHT_TAG);
  }

  return content.some(part => part.type === "text" && part.text.includes(INNER_THOUGHT_TAG));
}
