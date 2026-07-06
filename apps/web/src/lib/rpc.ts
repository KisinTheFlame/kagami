import { agentApiContract } from "@kagami/agent-api/contract";
import { consoleApiContract } from "@kagami/console-api/contract";
import { authApiContract } from "@kagami/llm-api/auth-contract";
import { metricApiContract } from "@kagami/metric-api/contract";
import { ossConsoleContract } from "@kagami/oss-api/contract";
import { createClient, type CreateClientOptions } from "@kagami/rpc-client/client";
import { resolveApiBaseUrl } from "@/lib/api";

// === 前端 → 后端的 typed RPC client（issue #499）===
//
// 后端 acl 层早已全面用 @kagami/rpc-client；本模块把前端这最后一个手写 fetch 的消费者也接上：
// 用 client.method(input) 一步取代「contractUrl 取 path + 手传 schema + apiGetWithSchema」，
// path / response schema / 入参类型全部从契约派生。
//
// baseUrl 统一 /api：gateway 按 path 前缀分流（/llm-chat-call→console、/auth→llm、/metric→metric、
// 其余→agent），契约 path 自带前缀，故所有契约共用一个 baseUrl，URL 与迁移前逐字一致、路由不变。

const FALLBACK_ERROR_MESSAGE = "请求失败，请稍后再试";

/**
 * 从非 2xx 响应体里抽人类可读的错误文案，镜像旧 lib/api.ts 的 ApiError 抽取逻辑（依次找
 * message / error / detail，及嵌套 error.message）。让 getApiErrorMessage(error) 继续复用。
 */
function readApiErrorBodyMessage(body: unknown): string | null {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof body !== "object" || body === null) {
    return null;
  }

  const recordBody = body as Record<string, unknown>;

  for (const key of ["message", "error", "detail"]) {
    const value = recordBody[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  const nestedError =
    typeof recordBody.error === "object" && recordBody.error !== null
      ? (recordBody.error as Record<string, unknown>)
      : null;
  if (nestedError && typeof nestedError.message === "string") {
    const trimmed = nestedError.message.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

// 自定义错误解码：非 2xx 时优先用响应体里的文案（保留旧前端的错误展示保真），否则退化成
// 「请求失败 (状态码)」。不可达 / 超时 / 坏响应体走 createClient 默认兜底（unreachableMessage）。
const clientOptions: CreateClientOptions = {
  baseUrl: resolveApiBaseUrl(),
  unreachableMessage: FALLBACK_ERROR_MESSAGE,
  decodeError: (status, body) => {
    const message = readApiErrorBodyMessage(body);
    return new Error(message ?? `请求失败 (${status})`);
  },
};

export const consoleClient = createClient(consoleApiContract, clientOptions);
export const agentClient = createClient(agentApiContract, clientOptions);
export const authClient = createClient(authApiContract, clientOptions);
export const metricClient = createClient(metricApiContract, clientOptions);
export const ossConsoleClient = createClient(ossConsoleContract, clientOptions);
