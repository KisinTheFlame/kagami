import { defineBinaryEnvelopeRoute, defineBinaryRawRoute } from "@kagami/http/contract";
import { z } from "zod";

const KeyParams = z.object({ key: z.string().min(1) });

/**
 * kagami-oss 进程的对象存储 RPC 契约（单一事实源，issue #230）。负载是二进制：字节流不进 Zod，
 * 契约只钉路径 / 方法 / 路径参数 / JSON 信封 —— putObject 的 `{ key }` 信封两端共享 schema
 * （服务端 execute 返回类型由它反推、agent 门面对响应 parse），get/head/delete 是 raw 路由
 * （下行字节流 / 元数据 header / 空体，服务端全权控制流式管道与安全头）。
 */
export const ossApiContract = {
  putObject: defineBinaryEnvelopeRoute({
    method: "POST",
    path: "/objects",
    params: z.object({}),
    bytesIn: true,
    output: z.object({ key: z.string().min(1) }),
    statusCode: 201,
  }),
  getObject: defineBinaryRawRoute({
    method: "GET",
    path: "/objects/:key",
    params: KeyParams,
    bytesIn: false,
  }),
  headObject: defineBinaryRawRoute({
    method: "HEAD",
    path: "/objects/:key",
    params: KeyParams,
    bytesIn: false,
  }),
  deleteObject: defineBinaryRawRoute({
    method: "DELETE",
    path: "/objects/:key",
    params: KeyParams,
    bytesIn: false,
  }),
};
