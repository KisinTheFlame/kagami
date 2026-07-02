import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
 * JSON 与 binary 是**两种 route kind**，只共享 method / path / error 信封；二进制流（OSS）不进
 * Zod，见 {@link BinaryRouteContract}。
 */
export type HttpMethod = "GET" | "POST" | "DELETE";

export type JsonRouteContract<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: "json";
  method: HttpMethod;
  /** 路径。JSON kind 不含 `:param`（路径参数属 binary/OSS 形态）。 */
  path: string;
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

export function defineJsonRoute<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  contract: Omit<JsonRouteContract<TInput, TOutput>, "kind">,
): JsonRouteContract<TInput, TOutput> {
  return { kind: "json", ...contract };
}

/**
 * 二进制路由契约（OSS 用）：body / 响应是字节流，**不进 Zod**（一 parse 就得整块缓冲，破坏流式
 * 上传 + OOM 防线）。契约只类型化路径、方法、以及可选的 JSON 响应信封（如 putObject 的 `{ key }`）。
 * 实际 register / client 由 OSS 侧按需实现，这里只固定共享的形状。
 */
export type BinaryRouteContract<TResponse extends z.ZodTypeAny = z.ZodTypeAny> = {
  kind: "binary";
  method: HttpMethod;
  /** 可含 `:param`（如 `/objects/:key`）。 */
  path: string;
  /** 上行是否携带字节 body（PUT/POST 上传）。 */
  requestBody: "bytes" | "none";
  /** 下行：字节流，或 JSON 信封 schema（如 `{ key }`）。 */
  responseBody: "bytes" | TResponse;
};

export function defineBinaryRoute<TResponse extends z.ZodTypeAny>(
  contract: Omit<BinaryRouteContract<TResponse>, "kind">,
): BinaryRouteContract<TResponse> {
  return { kind: "binary", ...contract };
}

export type RouteContract = JsonRouteContract | BinaryRouteContract;

/** 一个生产者导出的契约集合：方法名 → 契约。消费端 `createClient` 消费它。 */
export type JsonContractMap = Record<string, JsonRouteContract>;

type JsonRouteExecute<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> = (args: {
  input: z.infer<TInput>;
  request: FastifyRequest;
  reply: FastifyReply;
}) => Promise<z.infer<TOutput>> | z.infer<TOutput>;

/**
 * 把一条 JSON 契约接到 Fastify handler。入参按 `contract.input` 解析（GET/DELETE 取 query，POST
 * 取 body），`execute` 返回值按 `contract.output` 解析后回出 —— 返回错形状即编译报错（`execute`
 * 的返回类型由 `output` 反推）。抛出的 BizError 交给 runtime 的 setErrorHandler 统一序列化成富错误
 * 信封，消费端据此重建。
 */
export function registerJsonRoute<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  app: FastifyInstance,
  contract: JsonRouteContract<TInput, TOutput>,
  execute: JsonRouteExecute<TInput, TOutput>,
): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const raw = contract.method === "POST" ? request.body : request.query;
    const input = contract.input.parse(raw) as z.infer<TInput>;
    const result = await execute({ input, request, reply });
    return contract.output.parse(result);
  };

  switch (contract.method) {
    case "GET":
      app.get(contract.path, handler);
      return;
    case "POST":
      app.post(contract.path, handler);
      return;
    case "DELETE":
      app.delete(contract.path, handler);
      return;
  }
}
