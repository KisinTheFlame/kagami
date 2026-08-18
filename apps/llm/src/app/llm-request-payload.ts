import { isRecord } from "@kagami/kernel/json/is-record";
import { serializeJsonBlob, serializeTextBlob } from "./llm-payload-codec.js";

/**
 * `request_payload` 的拆分 / 重组（issue #612）。
 *
 * 拆：`messages` 逐条成 blob，`system` / `tools` 各成一个 blob，**其余字段原样进 `rest`**。
 * `rest` 刻意不是白名单——将来 request 加字段会自动无损带上，不必回来改这里。
 *
 * 重组后必须与拆分前**深度相等**：`system` 键「原本就没有」和「是空串」要能区分，`tools`
 * 是空数组也照存（`[]` 只占两字节，比引入第二套 null 语义划算）。
 *
 * `system` / `tools` 若不是预期类型（string / array），就留在 `rest` 里走 JSON 原样透传，
 * 不猜、不强转——这样拆分对任意输入都是全函数，重组永远能还原。
 */

export type SplitRequestPayload = {
  rest: Record<string, unknown>;
  hasMessages: boolean;
  systemRaw: Buffer | null;
  toolsRaw: Buffer | null;
  messageRaws: Buffer[];
};

export type RequestSkeleton = {
  rest: Record<string, unknown>;
  hasMessages: boolean;
  systemBlobId: number | null;
  toolsBlobId: number | null;
};

export function splitRequestPayload(request: Record<string, unknown>): SplitRequestPayload {
  const rest: Record<string, unknown> = { ...request };

  const hasMessages = Array.isArray(rest.messages);
  const messageRaws = hasMessages
    ? (rest.messages as unknown[]).map(message => serializeJsonBlob(message))
    : [];
  if (hasMessages) {
    delete rest.messages;
  }

  let systemRaw: Buffer | null = null;
  if (typeof rest.system === "string") {
    systemRaw = serializeTextBlob(rest.system);
    delete rest.system;
  }

  let toolsRaw: Buffer | null = null;
  if (Array.isArray(rest.tools)) {
    toolsRaw = serializeJsonBlob(rest.tools);
    delete rest.tools;
  }

  return { rest, hasMessages, systemRaw, toolsRaw, messageRaws };
}

export function buildRequestSkeleton(
  split: SplitRequestPayload,
  blobIds: { systemBlobId: number | null; toolsBlobId: number | null },
): RequestSkeleton {
  return {
    rest: split.rest,
    hasMessages: split.hasMessages,
    systemBlobId: blobIds.systemBlobId,
    toolsBlobId: blobIds.toolsBlobId,
  };
}

export function parseRequestSkeleton(value: unknown): RequestSkeleton {
  if (!isRecord(value)) {
    throw new Error("request_skeleton 不是对象，行数据已损坏");
  }

  return {
    rest: isRecord(value.rest) ? value.rest : {},
    hasMessages: value.hasMessages !== false,
    systemBlobId: typeof value.systemBlobId === "number" ? value.systemBlobId : null,
    toolsBlobId: typeof value.toolsBlobId === "number" ? value.toolsBlobId : null,
  };
}

export function assembleRequestPayload(input: {
  skeleton: RequestSkeleton;
  systemRaw: Buffer | null;
  toolsRaw: Buffer | null;
  messageRaws: Buffer[];
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...input.skeleton.rest };

  if (input.systemRaw !== null) {
    payload.system = input.systemRaw.toString("utf8");
  }
  if (input.toolsRaw !== null) {
    payload.tools = JSON.parse(input.toolsRaw.toString("utf8")) as unknown;
  }
  if (input.skeleton.hasMessages) {
    payload.messages = input.messageRaws.map(raw => JSON.parse(raw.toString("utf8")) as unknown);
  }

  return payload;
}
