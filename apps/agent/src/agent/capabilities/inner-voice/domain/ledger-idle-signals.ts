import type { LlmMessage } from "@kagami/llm-client";
import { isWaitToolCall, type InnerVoiceIdleSignals } from "./idle-detector.js";

/** 注入进上下文的 `<inner_thought>` 伪标签，回扫时凭它辨识历史注入。 */
const INNER_THOUGHT_TAG = "<inner_thought>";

/**
 * 从 ledger 记录（时间升序或任意序）重建摸鱼判定信号：
 * - assistant 消息的 toolCalls 里 name==="wait" 即一次 wait；
 * - 含 `<inner_thought>` 的 user 消息即历史注入（见下方「已知偏差」）。
 *
 * 纯函数：重启回扫恢复与 14 天回放脚本共用同一套辨识逻辑。
 *
 * 已知偏差（重启后偏「宽松侧」，有意接受，不建表）：attemptAt 只能从 `<inner_thought>`
 * 消息重建，而「产出空念头」的尝试（operation 返回 null）不注入、不落 ledger，重启后
 * 无从恢复。后果：重启当天该 attempt 的不应期丢失，最坏情形是重启后紧接着多触发一次内心
 * 独白。判定为可接受：①重启是低频事件（部署/崩溃）；②后果有界且无害——多一句自言自语，
 * 既非崩溃也非 token 空转/死循环；③换取「零新表、状态全部可从 ledger 派生」的简化收益。
 */
export function collectInnerVoiceIdleSignals(
  records: ReadonlyArray<{ message: LlmMessage; createdAt: Date }>,
): InnerVoiceIdleSignals {
  const waitAt: Date[] = [];
  const attemptAt: Date[] = [];

  for (const record of records) {
    const { message, createdAt } = record;
    if (message.role === "assistant") {
      for (const toolCall of message.toolCalls) {
        if (isWaitToolCall(toolCall.name)) {
          waitAt.push(createdAt);
        }
      }
      continue;
    }

    if (message.role === "user" && isInnerThoughtMessage(message.content)) {
      attemptAt.push(createdAt);
    }
  }

  return { waitAt, attemptAt };
}

function isInnerThoughtMessage(content: Extract<LlmMessage, { role: "user" }>["content"]): boolean {
  if (typeof content === "string") {
    return content.includes(INNER_THOUGHT_TAG);
  }

  return content.some(part => part.type === "text" && part.text.includes(INNER_THOUGHT_TAG));
}
