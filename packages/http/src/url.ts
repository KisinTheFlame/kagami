import type { z } from "zod";
import type { JsonRouteContract } from "./contract.js";

// === 契约 URL 构造：浏览器安全（零 fastify / Node 运行时依赖），web 前端与 rpc-client 共用 ===

/**
 * 把契约里的 `:param` 路径插值成实际 URL 路径段（encodeURIComponent）。client 门面用它从契约取
 * 路径（如 `/objects/:key` + `{key:"res-1"}` → `/objects/res-1`），保证 client 与服务端路由共享
 * 同一份 path 字符串。缺参数直接抛错（编程错误，不进业务错误通道）。
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

/**
 * query 对象 → querystring。undefined/null 跳过（空值不上 wire），string 原样、number/boolean/
 * bigint String() 化；对象 / symbol / 函数不属于 query，跳过（避免 `[object Object]`）。
 * 与 rpc-client 服务端消费者的序列化行为保持同一份语义。
 */
export function toQueryString(query: unknown): string {
  if (query === undefined || query === null || typeof query !== "object") {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
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

type ContractUrlArgs<TParams extends z.ZodTypeAny | undefined> = TParams extends z.ZodTypeAny
  ? { params: z.infer<TParams>; query?: Record<string, unknown> }
  : { query?: Record<string, unknown> } | undefined;

/**
 * 从一条 JSON 契约构造相对 URL（路径插值 + query 序列化），给 web 前端这类**不走 createClient**
 * 的消费者用：path/method/schema 的单一事实源仍是契约，fetch 层与错误模型保持消费方自己的
 * （web 的 `apiGetWithSchema` + `ApiError` 链路零改动）。
 *
 * 例：`contractUrl(consoleApiContract.getLlmChatCallDetail, { params: { id: 42 } })`
 * → `/llm-chat-call/42`。
 */
export function contractUrl<C extends JsonRouteContract>(
  contract: C,
  args?: ContractUrlArgs<C["params"]>,
): string {
  const withParams = args as { params?: Record<string, unknown>; query?: unknown } | undefined;
  let path = contract.path;
  if (contract.params) {
    const parsed = contract.params.parse(withParams?.params ?? {}) as Record<string, unknown>;
    const stringified: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      stringified[key] = String(value);
    }
    path = interpolatePath(path, stringified);
  }
  const qs = toQueryString(withParams?.query);
  return qs ? `${path}?${qs}` : path;
}
