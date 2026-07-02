import { BizError } from "@kagami/kernel/errors/biz-error";
import { bizErrorFromWire, isBizErrorWire } from "@kagami/kernel/errors/biz-error-wire";
import type { z } from "zod";
import type { JsonContractMap, JsonRouteContract } from "@kagami/http/contract";

/**
 * 契约驱动的 typed HTTP client 工厂。给一份生产者契约集合，回出一个方法名逐一对应的 client：
 * 每个方法入参是 `z.infer<contract.input>`、返回 `Promise<z.infer<contract.output>>`。
 *
 * 消费端接口（门面）直接用 `JsonClient<typeof someContract>` 或其成员类型 —— 门面 == 契约，
 * 改契约 output → 调用点编译报错（issue #230 强制机制）。运行期对响应 `output.parse`，堵掉旧
 * 手写 client 的 `as` 空洞。
 *
 * 放在独立 `@kagami/rpc-client` 而非 `@kagami/http`，是为了把「重建 BizError」对 `@kagami/kernel`
 * 的依赖隔离在消费端，让服务端 `@kagami/http` 维持零 kernel 依赖。
 */
type FetchLike = typeof fetch;

/** 非 2xx 时把 (status, body) 解码成要抛的 Error。返回 undefined → 用兜底错误。browser 用它重建 BrowserError。 */
export type ErrorDecoder = (status: number, body: unknown) => Error | undefined;

/** 兜底错误的三种成因：服务不可达（含超时）/ 非 2xx 且 decodeError 未接手 / 2xx 但响应体非 JSON。 */
export type FallbackErrorInfo =
  | { reason: "unreachable"; cause: unknown }
  | { reason: "bad_status"; status: number }
  | { reason: "invalid_response_body"; cause: unknown };

/** 把兜底成因映射成要抛的 Error。默认产 BizError(unreachableMessage)；browser 用它产 BrowserError。 */
export type FallbackErrorMapper = (info: FallbackErrorInfo) => Error;

export type CreateClientOptions = {
  baseUrl: string;
  fetch?: FetchLike;
  /** 默认超时（ms），可被 contract.timeoutMs 覆盖。默认 30s：服务真挂/半开的兜底，非每次调用时限。 */
  timeoutMs?: number;
  /**
   * 兜底 BizError 的 message：不可达 / 超时 / 非 2xx 无富信封 / 响应体无效时用。
   * llm 必须传 `"LLM 上游服务调用失败"` —— isRetryableLlmFailure 精确匹配它来决定退避重试。
   * 传了 mapFallbackError 时此项不生效（兜底错误形状完全交给 mapper）。
   */
  unreachableMessage?: string;
  /** 自定义非 2xx 错误通道。默认解码 `{ error: BizErrorWire }` → 重建 BizError（llm/oss）。 */
  decodeError?: ErrorDecoder;
  /**
   * 自定义兜底错误形状（默认 BizError）。给错误模型不是 BizError 的消费者用：browser 把三种
   * 成因统一映射成 BrowserError("BROWSER_NOT_READY", …)，保住 tool_result 的冻结序列化结构。
   */
  mapFallbackError?: FallbackErrorMapper;
};

export type JsonClient<TContracts extends JsonContractMap> = {
  [K in keyof TContracts]: (
    input: z.infer<TContracts[K]["input"]>,
  ) => Promise<z.infer<TContracts[K]["output"]>>;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_UNREACHABLE_MESSAGE = "上游服务调用失败";

export function createClient<TContracts extends JsonContractMap>(
  contracts: TContracts,
  options: CreateClientOptions,
): JsonClient<TContracts> {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const unreachableMessage = options.unreachableMessage ?? DEFAULT_UNREACHABLE_MESSAGE;
  const decodeError = options.decodeError ?? decodeBizErrorWire;
  const mapFallbackError =
    options.mapFallbackError ?? defaultFallbackErrorMapper(unreachableMessage);

  const client = {} as JsonClient<TContracts>;
  for (const key of Object.keys(contracts) as (keyof TContracts)[]) {
    const contract = contracts[key];
    const call = (input: unknown): Promise<unknown> =>
      callJsonRoute(contract, input, {
        baseUrl,
        fetchImpl,
        timeoutMs: contract.timeoutMs ?? defaultTimeoutMs,
        decodeError,
        mapFallbackError,
      });
    client[key] = call as JsonClient<TContracts>[typeof key];
  }
  return client;
}

type CallContext = {
  baseUrl: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  decodeError: ErrorDecoder;
  mapFallbackError: FallbackErrorMapper;
};

async function callJsonRoute(
  contract: JsonRouteContract,
  input: unknown,
  ctx: CallContext,
): Promise<unknown> {
  let url = `${ctx.baseUrl}${contract.path}`;
  const init: RequestInit = {
    method: contract.method,
    signal: AbortSignal.timeout(ctx.timeoutMs),
  };

  if (contract.method === "POST") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(input);
  } else {
    const qs = toQueryString(input);
    if (qs) {
      url += `?${qs}`;
    }
  }

  let response: Response;
  try {
    response = await ctx.fetchImpl(url, init);
  } catch (cause) {
    throw ctx.mapFallbackError({ reason: "unreachable", cause });
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const decoded = ctx.decodeError(response.status, body);
    if (decoded) {
      throw decoded;
    }
    throw ctx.mapFallbackError({ reason: "bad_status", status: response.status });
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch (cause) {
    throw ctx.mapFallbackError({ reason: "invalid_response_body", cause });
  }

  return contract.output.parse(payload);
}

/** 默认兜底：三种成因都映射成 BizError(unreachableMessage)，meta 带成因与状态码便于诊断。 */
function defaultFallbackErrorMapper(unreachableMessage: string): FallbackErrorMapper {
  return info => {
    switch (info.reason) {
      case "unreachable":
        return new BizError({
          message: unreachableMessage,
          meta: { reason: "unreachable" },
          cause: info.cause,
        });
      case "bad_status":
        return new BizError({
          message: unreachableMessage,
          meta: { reason: "bad_status", status: info.status },
        });
      case "invalid_response_body":
        return new BizError({
          message: unreachableMessage,
          meta: { reason: "invalid_response_body" },
          cause: info.cause,
        });
    }
  };
}

/** GET/DELETE 入参对象 → querystring。undefined/null 跳过，其余 String() 化。 */
function toQueryString(input: unknown): string {
  if (input === undefined || input === null || typeof input !== "object") {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // query 参数只接受原始值；对象/symbol/函数不属于 query，跳过（避免 [object Object]）。
    if (typeof value === "string") {
      search.set(key, value);
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

/** 默认错误解码：非 2xx body 若为 `{ error: BizErrorWire }` → 重建等价 BizError。 */
const decodeBizErrorWire: ErrorDecoder = (_status, body) => {
  if (body !== null && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (isBizErrorWire(error)) {
      return bizErrorFromWire(error);
    }
  }
  return undefined;
};

/**
 * 把契约里的 `:param` 路径插值成实际 URL 路径段（encodeURIComponent）。binary 路由的门面用它
 * 从契约取路径（如 `/objects/:key` + `{key:"res-1"}` → `/objects/res-1`），保证 client 与服务端
 * 路由共享同一份 path 字符串。缺参数直接抛错（编程错误，不进业务错误通道）。
 */
export function interpolatePath(path: string, params: Record<string, string>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`路径参数缺失：${name}（path: ${path}）`);
    }
    return encodeURIComponent(value);
  });
}
