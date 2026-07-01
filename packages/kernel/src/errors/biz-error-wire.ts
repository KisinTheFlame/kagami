import { BizError, type BizErrorMeta } from "./biz-error.js";

/**
 * BizError 的 HTTP 线格式。用于把 BizError 跨进程（如 agent → kagami-llm 服务）忠实往返：
 * 服务侧 `toBizErrorWire` 序列化进错误信封，客户端侧 `bizErrorFromWire` 重建等价 BizError。
 *
 * 注意：这是**内部 RPC 专用**的富错误信封，与面向前端的 `toHttpErrorResponse`（只回
 * `{ message }`）不同——后者刻意不外泄 meta/statusCode，前者需要 meta/statusCode 让
 * 调用方还原 `instanceof BizError` 的 retry / 控制流语义。
 */
export type BizErrorWire = {
  name: "BizError";
  message: string;
  meta?: BizErrorMeta;
  statusCode: number;
};

export function toBizErrorWire(error: BizError): BizErrorWire {
  return {
    name: "BizError",
    message: error.message,
    ...(error.meta ? { meta: error.meta } : {}),
    statusCode: error.statusCode,
  };
}

export function isBizErrorWire(value: unknown): value is BizErrorWire {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "BizError" &&
    typeof (value as { message?: unknown }).message === "string" &&
    typeof (value as { statusCode?: unknown }).statusCode === "number"
  );
}

export function bizErrorFromWire(wire: BizErrorWire): BizError {
  return new BizError({
    message: wire.message,
    meta: wire.meta,
    statusCode: wire.statusCode,
  });
}
