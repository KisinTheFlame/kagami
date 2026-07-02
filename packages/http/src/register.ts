import type { ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type {
  BinaryEnvelopeRouteContract,
  BinaryHttpMethod,
  BinaryRawRouteContract,
  JsonRouteContract,
  JsonRouteParams,
} from "./contract.js";

// === 服务端注册原语（fastify 侧）===
//
// 与 contract.ts 拆开的原因：契约类型会经各 *-api 包的 d.ts 传导进 web 前端的类型空间，
// 这里哪怕 type-only 引用 fastify / node:* 都会把 @types/node 拖给 web（全局 setTimeout 变型）。
// 注册原语只被服务端消费，收在本模块。

type JsonRouteExecute<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
  TParams extends z.ZodTypeAny | undefined,
> = (args: {
  input: z.infer<TInput>;
  /** 路径参数（按 `contract.params` 解析）；无 params 的路由恒为 undefined。 */
  params: JsonRouteParams<TParams>;
  request: FastifyRequest;
  reply: FastifyReply;
}) => Promise<z.infer<TOutput>> | z.infer<TOutput>;

/**
 * 把一条 JSON 契约接到 Fastify handler。入参按 `contract.input` 解析（GET/DELETE 取 query，POST
 * 取 body），路径参数按 `contract.params` 解析（未声明则为 undefined），`execute` 返回值按
 * `contract.output` 解析后回出 —— 返回错形状即编译报错（`execute` 的返回类型由 `output` 反推）。
 * 抛出的 BizError 交给 runtime 的 setErrorHandler 统一序列化成富错误信封，消费端据此重建。
 */
export function registerJsonRoute<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
  TParams extends z.ZodTypeAny | undefined,
>(
  app: FastifyInstance,
  contract: JsonRouteContract<TInput, TOutput, TParams>,
  execute: JsonRouteExecute<TInput, TOutput, TParams>,
): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    // POST 空 body（无 content-type）时 Fastify 给 undefined；归一化成 {}，让「无入参的 POST」
    // （如 /scheduler/tasks/:name/trigger）以 input: z.object({}) 建模而不被 parse(undefined) 打成 500。
    const raw = contract.method === "POST" ? (request.body ?? {}) : request.query;
    const input = contract.input.parse(raw) as z.infer<TInput>;
    const params = (
      contract.params ? contract.params.parse(request.params) : undefined
    ) as JsonRouteParams<TParams>;
    const result = await execute({ input, params, request, reply });
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
