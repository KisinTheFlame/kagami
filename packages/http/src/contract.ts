import type { ServerResponse } from "node:http";
import type { Readable } from "node:stream";
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
 * JSON 与 binary 是**不同的 route kind**，只共享 method / path / error 信封；二进制流（OSS）不进
 * Zod，见 {@link BinaryEnvelopeRouteContract} / {@link BinaryRawRouteContract}。
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

type BinaryEnvelopeExecute<TParams extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> = (args: {
  params: z.infer<TParams>;
  /** bytesIn 时为未消费的原始上行字节流；否则 undefined。 */
  body: Readable | undefined;
  request: FastifyRequest;
  reply: FastifyReply;
}) => Promise<z.infer<TOutput>> | z.infer<TOutput>;

/**
 * 把一条二进制信封契约接到 Fastify handler：上行字节流透传给 execute（不缓冲、不进 Zod），
 * 下行按 `contract.output` 解析后以 `statusCode`（默认 200）回出 —— execute 返回错形状即编译报错。
 *
 * 前提：bytesIn 的应用须先调 {@link useRawBodyPassthrough}（移除内建 body parser、全部透传），
 * 否则 application/json 等内建类型会被 Fastify 缓冲消费，破坏流式与字节保真。
 */
export function registerBinaryEnvelopeRoute<
  TParams extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(
  app: FastifyInstance,
  contract: BinaryEnvelopeRouteContract<TParams, TOutput>,
  execute: BinaryEnvelopeExecute<TParams, TOutput>,
): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const params = contract.params.parse(request.params) as z.infer<TParams>;
    // 透传 parser 下 body 即原始流；无 content-type 时 Fastify 跳过 parser，退回 request.raw。
    const body = contract.bytesIn
      ? ((request.body as Readable | undefined) ?? request.raw)
      : undefined;
    const result = await execute({ params, body, request, reply });
    const parsed = contract.output.parse(result) as z.infer<TOutput>;
    return reply.code(contract.statusCode ?? 200).send(parsed);
  };
  registerByMethod(app, contract.method, contract.path, handler);
}

type BinaryRawExecute<TParams extends z.ZodTypeAny> = (args: {
  params: z.infer<TParams>;
  request: FastifyRequest;
  /** 已 hijack 的裸响应：状态码 / header / 流式管道 / fd 生命周期全权归 execute。 */
  raw: ServerResponse;
}) => Promise<void>;

/**
 * 把一条 raw 契约接到 Fastify handler：`reply.hijack()` 后把裸 `ServerResponse` 交给 execute
 * 全权处理。用于下行是字节流 / 空体 / 自定 header 的路由（OSS get/head/delete）——流式管道、
 * 中途出错销毁 socket、安全头这类语义在裸 res 上已经过实战检验，契约只钉路径与参数，不改写它们。
 * execute 抛错时兜底：header 未发则 500，随后 end（与裸 node:http 实现的 catch-all 同款）。
 */
export function registerBinaryRawRoute<TParams extends z.ZodTypeAny>(
  app: FastifyInstance,
  contract: BinaryRawRouteContract<TParams>,
  execute: BinaryRawExecute<TParams>,
): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.hijack();
    const raw = reply.raw;
    try {
      const params = contract.params.parse(request.params) as z.infer<TParams>;
      await execute({ params, request, raw });
    } catch (error) {
      // 与裸 node:http 版 handleRequest 的 catch-all 行为一致。
      console.error("[http] binary raw route failed", error);
      if (!raw.headersSent) {
        raw.writeHead(500);
      }
      raw.end();
    }
  };
  registerByMethod(app, contract.method, contract.path, handler);
}

/**
 * 移除内建 body parser、注册全类型透传 parser：上行 body 一律以原始流交给路由（不缓冲、不解析）。
 * 二进制服务（OSS）在建 app 后调用一次。注意这会让该 Fastify 实例上的 JSON 路由拿不到解析后的
 * body —— 二进制服务与 JSON 服务不要混在同一实例。
 */
export function useRawBodyPassthrough(app: FastifyInstance): void {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, payload, done) => {
    done(null, payload);
  });
}

function registerByMethod(
  app: FastifyInstance,
  method: BinaryHttpMethod,
  path: string,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
): void {
  switch (method) {
    case "GET":
      app.get(path, handler);
      return;
    case "POST":
      app.post(path, handler);
      return;
    case "HEAD":
      app.head(path, handler);
      return;
    case "DELETE":
      app.delete(path, handler);
      return;
  }
}
