import type { LlmMessage } from "@kagami/llm-client";
import { isWaitToolCall, type InnerVoiceIdleSignals } from "./idle-detector.js";

/**
 * 注入进上下文的伪标签，回扫时凭它辨识历史注入。**两个都要认**：issue #592 起新注入用
 * `<inner_impulse>`，但历史 ledger 里存量全是 `<inner_thought>`，只认新的会让重启后丢掉
 * 全部历史注入、不应期归零。
 */
const INNER_THOUGHT_TAGS = ["<inner_impulse>", "<inner_thought>"] as const;

/**
 * 从 ledger 记录（时间升序或任意序）重建摸鱼判定信号：
 * - assistant 消息的 toolCalls 里 name==="wait" 即一次 wait；
 * - 含 `<inner_impulse>` / `<inner_thought>` 的 user 消息即历史注入（见下方「已知偏差」）。
 *
 * 纯函数：重启回扫恢复与 14 天回放脚本共用同一套辨识逻辑。
 *
 * 已知偏差（重启后偏「宽松侧」，有意接受，不建表）：attemptAt 只能从注入过的
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

function containsInnerThoughtTag(text: string): boolean {
  return INNER_THOUGHT_TAGS.some(tag => text.includes(tag));
}

function isInnerThoughtMessage(content: Extract<LlmMessage, { role: "user" }>["content"]): boolean {
  if (typeof content === "string") {
    return containsInnerThoughtTag(content);
  }

  return content.some(part => part.type === "text" && containsInnerThoughtTag(part.text));
}
