import { BizError } from "@kagami/kernel/errors/biz-error";

/**
 * 高德 Web 服务 API 的 HTTP 取数助手。结构照抄 hn 的 `hn-fetch.ts`，但多两件高德特有的事：
 *
 * 1. **infocode 分类**：高德即使 HTTP 200 也可能在 body 里回错误（`infocode !== "10000"`）。
 *    成功信号统一以 `infocode === "10000"` 判定（v5 的 POI 接口甚至不返回 `status` 字段，
 *    只回 `infocode`）。错误按 `info` 文本分三类：
 *      - quota（日配额耗尽）：短路、不重试。
 *      - retryable（限频 / QPS / 服务忙 / 网关超时 / 引擎瞬时错误）：退避重试。
 *      - fatal（key 非法 / 缺参 / 参数非法）：直接抛。
 * 2. **key 脱敏**：key（及未来 sig）在 URL query 里，任何抛出的错误 meta / message 里都
 *    用 `redactUrl` 抹掉，绝不把明文 key 带进日志或 tool_result。
 *
 * 退避策略与 hn-fetch 一致：只对 408/429/5xx/网络错误/超时 + retryable infocode 重试；
 * 指数退避 + 全抖动；每次请求用 `AbortSignal.timeout` 限时。
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export type AmapFetchOptions = {
  timeoutMs: number;
  /** 最大尝试次数（含首次）。 */
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
};

/** 高德业务错误（infocode != 10000）。message / meta 已脱敏，可安全进 tool_result。 */
export class AmapError extends BizError {
  public readonly infocode: string;
  public readonly info: string;

  public constructor(input: { infocode: string; info: string; url: string }) {
    // info 是高德状态文本，理论上不含 URL；但防御性地脱敏，万一错误页把含 key 的 URL 回显进
    // info，也不会经 message/meta 泄漏进 tool_result。
    const info = redactUrl(input.info);
    super({
      message: `高德接口错误 [${input.infocode}] ${info}`,
      meta: { reason: "AMAP_API_ERROR", infocode: input.infocode, info },
    });
    this.infocode = input.infocode;
    this.info = info;
  }
}

type InfoClass = "ok" | "retryable" | "quota" | "fatal";

/**
 * 高德限频 / 并发超限 / 服务瞬时忙的 infocode（可退避重试）。用 infocode 集合兜底，因为高德
 * 的 `info` 文本可能是中文（如"并发量已达到上限"）或缺失，只靠 ASCII 关键字会把可重试的
 * 限流误判成 fatal、白白丢掉重试机会。参考高德错误码表。
 */
const RETRYABLE_INFOCODES = new Set([
  "10004", // ACCESS_TOO_FREQUENT（访问过于频繁）
  "10014", // 服务响应繁忙 / QPS 超限
  "10015", // 服务器繁忙
  "10019", // CUQPS_HAS_EXCEEDED_THE_LIMIT
  "10020",
  "10021",
  "10022",
  "10029", // 各类并发/单位时间配额超限
]);

/** 高德把数字字段偶尔回成 JSON number；统一强转成字符串，避免 typeof 判定把成功当失败。 */
function coerceStr(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

/**
 * 按 infocode（+ `info` 文本兜底）给错误分类。限流类优先用 infocode 集合判定；引擎数据错误
 * （ENGINE_RESPONSE_DATA_ERROR 等）是确定性错误，不重试。
 */
function classifyInfo(info: string, infocode: string): InfoClass {
  if (infocode === "10000") {
    return "ok";
  }
  const t = (info || "").toUpperCase();
  if (t.includes("OVER_LIMIT") || t.includes("DAILY") || infocode === "10003") {
    return "quota";
  }
  if (
    RETRYABLE_INFOCODES.has(infocode) ||
    t.includes("TOO_FREQUENT") ||
    t.includes("QPS") ||
    t.includes("BUSY") ||
    t.includes("TIMEOUT")
  ) {
    return "retryable";
  }
  return "fatal";
}

/** 抹掉 URL 里的 key / sig，用于日志和错误信息。 */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|sig)=)[^&]*/gi, "$1***");
}

type AmapJsonEnvelope = {
  infocode?: unknown;
  info?: unknown;
  status?: unknown;
};

/**
 * 取一个高德 JSON 端点，校验 infocode 成功后返回 `unknown`（调用方用 zod 宽松解析）。
 * infocode 错误按分类决定重试 / 短路 / 抛出。
 */
export async function amapFetchJson(url: string, options: AmapFetchOptions): Promise<unknown> {
  const { timeoutMs, maxAttempts, backoffBaseMs, backoffMaxMs } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(computeBackoffMs(attempt, backoffBaseMs, backoffMaxMs));
        continue;
      }
      throw new BizError({
        message: "请求高德接口失败（网络错误或超时）",
        meta: { reason: "AMAP_FETCH_NETWORK_ERROR", url: redactUrl(url), attempts: attempt },
        cause: error,
      });
    }

    if (!response.ok) {
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
        await sleep(resolveWaitMs(response, attempt, backoffBaseMs, backoffMaxMs));
        continue;
      }
      throw new BizError({
        message: `请求高德接口失败（HTTP ${response.status}）`,
        meta: {
          reason: "AMAP_FETCH_HTTP_ERROR",
          url: redactUrl(url),
          status: response.status,
          attempts: attempt,
        },
      });
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch (error) {
      throw new BizError({
        message: "高德接口返回了无法解析的 JSON",
        meta: { reason: "AMAP_FETCH_BAD_JSON", url: redactUrl(url) },
        cause: error,
      });
    }

    const envelope = (body ?? {}) as AmapJsonEnvelope;
    const infocode = coerceStr(envelope.infocode);
    const info = typeof envelope.info === "string" ? envelope.info : "";
    const klass = classifyInfo(info, infocode);

    if (klass === "ok") {
      return body;
    }
    if (klass === "retryable" && attempt < maxAttempts) {
      lastError = new AmapError({ infocode, info, url });
      await sleep(computeBackoffMs(attempt, backoffBaseMs, backoffMaxMs));
      continue;
    }
    // fatal / quota / 重试耗尽：直接抛（已脱敏）。
    throw new AmapError({ infocode, info, url });
  }

  throw new BizError({
    message: "请求高德接口失败（重试耗尽）",
    meta: { reason: "AMAP_FETCH_EXHAUSTED", url: redactUrl(url) },
    cause: lastError,
  });
}

/** 取回的图片字节 + MIME。 */
export type AmapImage = { bytes: Buffer; mimeType: string };

/**
 * 取高德静态地图：成功是 `image/png`，失败是 JSON / 文本错误页。必须先验 HTTP 200 +
 * `content-type` 以 `image/` 开头，否则把 body 当错误解析——绝不把错误页当图片返回。
 */
export async function amapFetchImage(url: string, options: AmapFetchOptions): Promise<AmapImage> {
  const { timeoutMs, maxAttempts, backoffBaseMs, backoffMaxMs } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(computeBackoffMs(attempt, backoffBaseMs, backoffMaxMs));
        continue;
      }
      throw new BizError({
        message: "请求高德静态地图失败（网络错误或超时）",
        meta: { reason: "AMAP_STATICMAP_NETWORK_ERROR", url: redactUrl(url), attempts: attempt },
        cause: error,
      });
    }

    if (!response.ok) {
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
        await sleep(resolveWaitMs(response, attempt, backoffBaseMs, backoffMaxMs));
        continue;
      }
      throw new BizError({
        message: `请求高德静态地图失败（HTTP ${response.status}）`,
        meta: { reason: "AMAP_STATICMAP_HTTP_ERROR", url: redactUrl(url), status: response.status },
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    const subtype = contentType.split(";")[0].trim();
    if (subtype.startsWith("image/") && subtype.length > "image/".length) {
      const bytes = Buffer.from(await response.arrayBuffer());
      return { bytes, mimeType: subtype };
    }

    // 非图片：高德把错误塞在 JSON / 文本里。解析出 infocode/info 抛 AmapError。
    // 非 JSON 兜底文本可能回显含 key 的请求 URL，先脱敏再进 info，绝不让 key 泄漏进上下文。
    const text = await response.text();
    let infocode = "";
    let info = redactUrl(text.slice(0, 200));
    try {
      const parsed = JSON.parse(text) as AmapJsonEnvelope;
      infocode = coerceStr(parsed.infocode);
      if (typeof parsed.info === "string") {
        info = parsed.info;
      }
    } catch {
      // 非 JSON，info 保留脱敏后的文本前缀。
    }
    // 限流 / 繁忙类错误退避重试（与 JSON 路径一致），其余直接抛。
    if (classifyInfo(info, infocode) === "retryable" && attempt < maxAttempts) {
      lastError = new AmapError({ infocode, info, url });
      await sleep(computeBackoffMs(attempt, backoffBaseMs, backoffMaxMs));
      continue;
    }
    throw new AmapError({ infocode, info, url });
  }

  throw new BizError({
    message: "请求高德静态地图失败（重试耗尽）",
    meta: { reason: "AMAP_STATICMAP_EXHAUSTED", url: redactUrl(url) },
    cause: lastError,
  });
}

/**
 * 决定这次重试前睡多久：优先尊重服务端 `Retry-After`，但**夹到 `backoffMaxMs`**——否则一个
 * `Retry-After: 86400` 会让工具在主循环里睡一天，卡死整个 Agent（无覆盖物时的致命阻塞）。
 * 没有 Retry-After 时退回指数退避 + 抖动。
 */
function resolveWaitMs(response: Response, attempt: number, baseMs: number, maxMs: number): number {
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, maxMs);
  }
  return computeBackoffMs(attempt, baseMs, maxMs);
}

function computeBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
  return Math.floor(Math.random() * exp);
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
