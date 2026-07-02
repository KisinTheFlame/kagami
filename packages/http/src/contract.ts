import type { z } from "zod";

/**
 * 服务间调用的**单一事实源**：一条路由的方法 / 路径 / 入参 schema / 出参 schema。
 *
 * 生产者用 {@link registerJsonRoute} 把契约接到自己的 Fastify handler（execute 返回类型由
 * `output` 反推）；消费者用 `@kagami/rpc-client` 的 `createClient(contract)` 拿到 typed client。
 * 两端从同一份 Zod schema 派生类型 —— 改契约的 `output`，服务端 handler 与消费端调用点会**同时**
 * 编译报错。这解决了「HTTP 这一跳的类型空洞」（服务端 `z.unknown()` + 客户端 `as` 各写一遍）。
 *
 * 前提（issue #230「强制机制」）：消费端接口的返回类型必须**就是** `z.infer<contract.output>`
 * （门面 == 契约），且 api 包走 tsconfig `paths` 让 tsc 对源码而非过期 dist 解析，跨包漂移才真的
 * 被 typecheck 抓到 —— 本仓库无 TS project references。
 *
 * JSON 与 binary 是**不同的 route kind**，只共享 method / path / error 信封；二进制流（OSS）不进
 * Zod，见 {@link BinaryEnvelopeRouteContract} / {@link BinaryRawRouteContract}。
 *
 * 本模块（连同 wire/url）必须**类型层面**浏览器安全：连 `import type` 都不得引 fastify / node:*——
 * d.ts 里的类型引用会把 @types/node 拖进 web 的类型空间（全局 setTimeout 变型）。服务端注册
 * 原语在 register.ts。
 */
export type HttpMethod = "GET" | "POST" | "DELETE";

export type JsonRouteContract<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
  TParams extends z.ZodTypeAny | undefined = z.ZodTypeAny | undefined,
> = {
  kind: "json";
  method: HttpMethod;
  /** 路径。声明了 `params` 时可含 `:param` 段（如 `/auth/:provider/status`）。 */
  path: string;
  /**
   * 路径参数 schema；无路径参数的路由为 `undefined`。与 `input` 是**分离的通道**：params 走
   * 路径插值（interpolatePath），input 走 query（GET/DELETE）或 body（POST）——若混进 input
   * 会拼出 `/auth/codex/status?provider=codex` 这类错误形态。
   */
  params: TParams;
  /** 入参 schema。GET/DELETE → 序列化进 query；POST → JSON body。 */
  input: TInput;
  /** 出参 schema。服务端 execute 返回类型由它反推；客户端对响应 `output.parse`。 */
  output: TOutput;
  /**
   * 客户端超时（ms）。缺省用 createClient 的 `timeoutMs`。与「这条路由天生慢」的事实同处，
   * 如 llm chat 需 600s、providers 只需 30s。服务端不消费此字段。
   */
  timeoutMs?: number;
};

export function defineJsonRoute<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(contract: {
  method: HttpMethod;
  path: string;
  input: TInput;
  output: TOutput;
  timeoutMs?: number;
}): JsonRouteContract<TInput, TOutput, undefined>;
export function defineJsonRoute<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
  TParams extends z.ZodTypeAny,
>(contract: {
  method: HttpMethod;
  path: string;
  params: TParams;
  input: TInput;
  output: TOutput;
  timeoutMs?: number;
}): JsonRouteContract<TInput, TOutput, TParams>;
export function defineJsonRoute(
  contract: Omit<JsonRouteContract, "kind" | "params"> & { params?: z.ZodTypeAny },
): JsonRouteContract {
  return { kind: "json", params: undefined, ...contract };
}

/**
 * 二进制路由契约（OSS 用），两种形状——字节流**不进 Zod**（一 parse 就得整块缓冲，破坏流式
 * 上传 + OOM 防线），契约只类型化路径 / 方法 / 路径参数 / JSON 信封：
 *
 * - **信封路由**（{@link BinaryEnvelopeRouteContract}）：上行可为字节流，下行是 JSON 信封
 *   （如 putObject 的 `{ key }`）。服务端走 {@link registerBinaryEnvelopeRoute}，output 反推
 *   execute 返回类型 —— 与 JSON 路由同级的编译期强制。
 * - **raw 路由**（{@link BinaryRawRouteContract}）：下行是字节流 / 空体 / 自定 header（GET 下载、
 *   HEAD 元数据、DELETE）。服务端走 {@link registerBinaryRawRoute}：`reply.hijack()` 后把裸
 *   `ServerResponse` 交给 execute 全权处理——流式管道 / fd 生命周期 / 安全头这类经过实战检验的
 *   逻辑原样保留，不强行塞进框架序列化。契约只钉路径与参数。
 */
export type BinaryHttpMethod = "GET" | "POST" | "HEAD" | "DELETE";

export type BinaryEnvelopeRouteContract<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: "binary-envelope";
  method: BinaryHttpMethod;
  /** 可含 `:param`（如 `/objects/:key`）。 */
  path: string;
  /** 路径参数 schema（无参数用 `z.object({})`）。 */
  params: TParams;
  /** 上行是否为原始字节流（透传，不进 Zod）。 */
  bytesIn: boolean;
  /** 下行 JSON 信封 schema。服务端 execute 返回类型由它反推；客户端对响应 parse。 */
  output: TOutput;
  /** 成功状态码，默认 200（putObject 用 201）。 */
  statusCode?: number;
};

export type BinaryRawRouteContract<TParams extends z.ZodTypeAny = z.ZodTypeAny> = {
  kind: "binary-raw";
  method: BinaryHttpMethod;
  path: string;
  params: TParams;
  bytesIn: boolean;
};

export function defineBinaryEnvelopeRoute<
  TParams extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(
  contract: Omit<BinaryEnvelopeRouteContract<TParams, TOutput>, "kind">,
): BinaryEnvelopeRouteContract<TParams, TOutput> {
  return { kind: "binary-envelope", ...contract };
}

export function defineBinaryRawRoute<TParams extends z.ZodTypeAny>(
  contract: Omit<BinaryRawRouteContract<TParams>, "kind">,
): BinaryRawRouteContract<TParams> {
  return { kind: "binary-raw", ...contract };
}

export type RouteContract =
  | JsonRouteContract
  | BinaryEnvelopeRouteContract
  | BinaryRawRouteContract;

/** 一个生产者导出的契约集合：方法名 → 契约。消费端 `createClient` 消费它。 */
export type JsonContractMap = Record<string, JsonRouteContract>;

/** params 通道的推导：声明了 schema → `z.infer`；未声明 → `undefined`。 */
export type JsonRouteParams<TParams extends z.ZodTypeAny | undefined> = TParams extends z.ZodTypeAny
  ? z.infer<TParams>
  : undefined;
