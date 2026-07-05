import type { z } from "zod";
import type {
  BinaryContractMap,
  BinaryEnvelopeRouteContract,
  BinaryRawRouteContract,
} from "@kagami/http/contract";
import { interpolatePath } from "@kagami/http/url";
import {
  DEFAULT_UNREACHABLE_MESSAGE,
  decodeBizErrorWire,
  defaultFallbackErrorMapper,
  type CreateClientOptions,
  type ErrorDecoder,
  type FallbackErrorMapper,
} from "./client.js";

/**
 * 契约驱动的 typed **二进制** HTTP client 工厂（issue #310）。`createClient` 只吃 JSON 路由；OSS
 * 这类二进制服务的字节流不进 Zod（一 parse 就得整块缓冲，破坏流式 + OOM 防线），所以走这个独立工厂。
 *
 * 按 route kind 分派两种截然不同的方法形状：
 *
 * - **binary-envelope**（上行字节 + 请求头、下行 JSON 信封，如 putObject）：完整处理。body 是原始
 *   `Uint8Array`（不 `JSON.stringify`），请求头从契约的 `headers` 通道取并按 schema 校验，下行按
 *   `output` parse。成功判定只看 `response.ok`（任意 2xx），**不**强校验 `statusCode`——契约里的
 *   201 是服务端成功码事实，客户端拒 200/204 是无收益兼容风险。错误通道与 `createClient` 一致
 *   （decodeError / mapFallbackError），但 `output.parse` 的 ZodError 会**显式**归入
 *   `invalid_response_body`（JSON client 那条裸 parse 不进 mapper）。
 *
 * - **binary-raw**（下行裸流 / header / 空体，如 getObject/head/delete）：**只生成传输**。插值 path、
 *   `fetch`，把裸 `Response` 原样交回调用方——不读 body、不判 status、不加 timeout、不 try/catch。
 *   下行字节 / content-length 早拒 / 404→领域错误这类语义是**领域逻辑**，留在调用方（如 oss-client）。
 *   这道刻意的窄边界把字节 / 流语义挡在通用层之外。
 *
 * 与 `createClient` 一样：门面 == 契约，改契约 output/headers → 调用点编译报错。
 */
type FetchLike = typeof fetch;

/** binary-envelope 的调用实参：headers 仅当契约声明了 `headers` 通道时出现。 */
type BinaryEnvelopeArgs<C extends BinaryEnvelopeRouteContract> = C["headers"] extends z.ZodTypeAny
  ? { params: z.infer<C["params"]>; headers: z.infer<C["headers"]>; bytes: Uint8Array }
  : { params: z.infer<C["params"]>; bytes: Uint8Array };

/**
 * 单条二进制路由的调用形状：
 * - envelope → `(args) => Promise<z.infer<output>>`（args 见 {@link BinaryEnvelopeArgs}）
 * - raw → `({ params }) => Promise<Response>`（裸响应交回调用方）
 */
// envelope 与 raw 靠结构判别：raw 缺 output / headers，不会误配到 envelope 分支。
type BinaryCall<C extends BinaryEnvelopeRouteContract | BinaryRawRouteContract> =
  C extends BinaryEnvelopeRouteContract
    ? (args: BinaryEnvelopeArgs<C>) => Promise<z.infer<C["output"]>>
    : C extends BinaryRawRouteContract
      ? (args: { params: z.infer<C["params"]> }) => Promise<Response>
      : never;

export type BinaryClient<TContracts extends BinaryContractMap> = {
  [K in keyof TContracts]: BinaryCall<TContracts[K]>;
};

export function createBinaryClient<TContracts extends BinaryContractMap>(
  contracts: TContracts,
  options: CreateClientOptions,
): BinaryClient<TContracts> {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const unreachableMessage = options.unreachableMessage ?? DEFAULT_UNREACHABLE_MESSAGE;
  const decodeError = options.decodeError ?? decodeBizErrorWire;
  const mapFallbackError =
    options.mapFallbackError ?? defaultFallbackErrorMapper(unreachableMessage);

  const client = {} as BinaryClient<TContracts>;
  for (const key of Object.keys(contracts) as (keyof TContracts)[]) {
    const contract = contracts[key];
    if (contract.kind === "binary-envelope") {
      const call = (args: {
        params?: Record<string, unknown>;
        headers?: Record<string, unknown>;
        bytes: Uint8Array;
      }): Promise<unknown> =>
        callBinaryEnvelope(contract, args, { baseUrl, fetchImpl, decodeError, mapFallbackError });
      client[key] = call as BinaryClient<TContracts>[typeof key];
    } else {
      const call = (args: { params?: Record<string, unknown> }): Promise<Response> =>
        callBinaryRaw(contract, args.params, { baseUrl, fetchImpl });
      client[key] = call as BinaryClient<TContracts>[typeof key];
    }
  }
  return client;
}

type EnvelopeCallContext = {
  baseUrl: string;
  fetchImpl: FetchLike;
  decodeError: ErrorDecoder;
  mapFallbackError: FallbackErrorMapper;
};

async function callBinaryEnvelope(
  contract: BinaryEnvelopeRouteContract,
  args: { params?: Record<string, unknown>; headers?: Record<string, unknown>; bytes: Uint8Array },
  ctx: EnvelopeCallContext,
): Promise<unknown> {
  const url = `${ctx.baseUrl}${interpolateContractPath(contract.path, contract.params, args.params)}`;
  // Uint8Array 是合法 fetch body；cast 抹平新版 lib 里 Uint8Array<ArrayBufferLike> 与 BodyInit
  // （不含 SharedArrayBuffer）的类型摩擦。
  const init: RequestInit = { method: contract.method, body: args.bytes as BodyInit };
  if (contract.headers) {
    // 请求头走契约的 headers schema：先校验、再逐值 String() 化写进 HTTP header。
    const parsed = contract.headers.parse(args.headers ?? {}) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      headers[name] = String(value);
    }
    init.headers = headers;
  }

  let response: Response;
  try {
    response = await ctx.fetchImpl(url, init);
  } catch (cause) {
    throw ctx.mapFallbackError({ reason: "unreachable", cause });
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
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

  try {
    return contract.output.parse(payload);
  } catch (cause) {
    // JSON client 的裸 output.parse 不进 mapper；binary-envelope 显式归入 invalid_response_body，
    // 让消费者（OSS）能把它映射成 OSS_PUT_INVALID_RESPONSE。
    throw ctx.mapFallbackError({ reason: "invalid_response_body", cause });
  }
}

/**
 * raw 路由：只做 URL 插值 + fetch，返回裸 `Response`。故意不 try/catch——网络失败原样抛给调用方
 * （与迁移前 oss-client 手写 getObject 一致），status / body / 早拒全归调用方。
 */
function callBinaryRaw(
  contract: BinaryRawRouteContract,
  params: Record<string, unknown> | undefined,
  ctx: { baseUrl: string; fetchImpl: FetchLike },
): Promise<Response> {
  const url = `${ctx.baseUrl}${interpolateContractPath(contract.path, contract.params, params)}`;
  return ctx.fetchImpl(url, { method: contract.method });
}

/** 按契约 params schema 校验路径参数、String() 化后插进路径段（与 JSON client 同款逻辑）。 */
function interpolateContractPath(
  path: string,
  paramsSchema: z.ZodTypeAny,
  params: Record<string, unknown> | undefined,
): string {
  const parsed = paramsSchema.parse(params ?? {}) as Record<string, unknown>;
  const stringified: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    stringified[name] = String(value);
  }
  return interpolatePath(path, stringified);
}
