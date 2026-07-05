import {
  defineBinaryEnvelopeRoute,
  defineBinaryRawRoute,
  defineJsonRoute,
} from "@kagami/http/contract";
import { z } from "zod";
import {
  OssObjectListQuerySchema,
  OssObjectListResponseSchema,
  OssStatsResponseSchema,
} from "./oss-object.js";

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
    // content-type 随对象存取，是契约的一部分（不再是 client 里硬编码的裸 header）：两端共享同一份
    // schema——client 按它校验后写进请求头（createBinaryClient，#310），服务端也按它校验入站头再交
    // 给 handler（registerBinaryEnvelopeRoute，#324）。收紧此 schema 两端一起强制。
    headers: z.object({ "content-type": z.string().min(1) }),
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

/**
 * 控制台只读面（管理台对象浏览器）：分页列表 + 存储统计，均为 JSON 契约。挂 `/oss-object` 前缀，
 * 与写操作的 `/objects` 前缀物理隔离——gateway 只把 `/oss-object` 分流到 OSS，浏览器够不到写路由。
 */
export const ossConsoleContract = {
  queryObjects: defineJsonRoute({
    method: "GET",
    path: "/oss-object/query",
    input: OssObjectListQuerySchema,
    output: OssObjectListResponseSchema,
  }),
  getStats: defineJsonRoute({
    method: "GET",
    path: "/oss-object/stats",
    input: z.object({}),
    output: OssStatsResponseSchema,
  }),
};

/**
 * 对象字节透传（预览 / 下载）：binary-raw 路由，浏览器直接以 `<img src>` / 下载消费，不进 typed
 * client。复用现有 getObject 的流式管道与安全头（nosniff + attachment）。同挂 `/oss-object` 前缀。
 */
export const getOssObjectContent = defineBinaryRawRoute({
  method: "GET",
  path: "/oss-object/:key/content",
  params: KeyParams,
  bytesIn: false,
});
