import type { LlmMessage } from "@kagami/llm-client";
import { renderLlmMessagePlainText } from "../../../runtime/context/context-item.utils.js";

export const DEFAULT_DASHBOARD_CONTEXT_LIMIT = 40;
export const DEFAULT_DASHBOARD_PREVIEW_LENGTH = 160;

export function renderStoryBatchMessage(input: {
  firstSeq: number;
  lastSeq: number;
  renderedBatchMessages: LlmMessage[];
}): string {
  const batchBody = input.renderedBatchMessages
    .map((message, index) => {
      const seq = input.firstSeq + index;
      return [`[${seq}] ${message.role}`, renderLlmMessagePlainText(message)].join("\n");
    })
    .join("\n\n");

  return [`<ledger_batch>`, batchBody, `</ledger_batch>`].join("\n");
}

export async function createSleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function safeJsonStringify(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export function createPreview(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= DEFAULT_DASHBOARD_PREVIEW_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, DEFAULT_DASHBOARD_PREVIEW_LENGTH - 1)}…`;
}
