import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";

// —— 客户端超时（wire 事实，随契约走）——
// 比浏览器进程内部的 NAVIGATION_TIMEOUT_MS(30s) / ACTION_TIMEOUT_MS(10s) 各留出裕量，
// 让服务端自己的超时先触发、回出规整的 BrowserError；只有进程真挂/半开时客户端才中止。
const NAVIGATION_TIMEOUT_MS = 40_000;
const ACTION_TIMEOUT_MS = 20_000;

/** type 路由的 value：明文 text（原 secret 凭据变体随 browser_credential 废表删除，epic #539）。 */
export const TypeValueSchema = z.object({ text: z.string() });

/**
 * kagami-browser 进程对 agent 暴露的动作 RPC 契约（单一事实源，issue #230）。九条路由全是 JSON
 * wire；screenshot 的图片以 base64 over JSON 传输（localhost 低频，+33% 体积可接受），由 agent 侧
 * 门面解回 Buffer —— wire 契约与门面变换分层，契约只钉 wire 形状。
 *
 * KV 缓存字节契约（#173）：agent 侧 8 个工具都从这些 output 的**具名字段**重新 JSON.stringify 产出
 * tool_result，所以「output 字段值不变 ⇒ tool_result 字节不变」。改本契约的 output 字段，服务端
 * handler（registerJsonRoute 的 execute 返回类型）与 agent 门面（z.infer<output>）同时编译报错。
 *
 * 错误通道独立于 BizErrorWire：非 2xx 是 `{ code, message, context }`，agent 侧经 decodeError 重建
 * BrowserError，走 serializeBrowserError 的冻结字节序（字段顺序固定）。
 */
export const browserApiContract = {
  navigate: defineJsonRoute({
    method: "POST",
    path: "/navigate",
    input: z.object({ url: z.string().min(1) }),
    output: z.object({ url: z.string(), title: z.string() }),
    timeoutMs: NAVIGATION_TIMEOUT_MS,
  }),
  observe: defineJsonRoute({
    method: "POST",
    path: "/observe",
    input: z.object({}),
    output: z.object({
      epoch: z.number(),
      url: z.string(),
      title: z.string(),
      snapshot: z.string(),
    }),
    timeoutMs: ACTION_TIMEOUT_MS,
  }),
  click: defineJsonRoute({
    method: "POST",
    path: "/click",
    input: z.object({ target: z.string().min(1) }),
    output: z.object({ url: z.string() }),
    timeoutMs: ACTION_TIMEOUT_MS,
  }),
  type: defineJsonRoute({
    method: "POST",
    path: "/type",
    input: z.object({ target: z.string().min(1), value: TypeValueSchema, submit: z.boolean() }),
    output: z.object({ url: z.string() }),
    timeoutMs: ACTION_TIMEOUT_MS,
  }),
  press: defineJsonRoute({
    method: "POST",
    path: "/press",
    input: z.object({ key: z.string().min(1) }),
    output: z.object({}),
    timeoutMs: ACTION_TIMEOUT_MS,
  }),
  waitFor: defineJsonRoute({
    method: "POST",
    path: "/wait-for",
    input: z.object({
      selector: z.string().optional(),
      ms: z.number().int().positive().optional(),
    }),
    output: z.object({}),
    timeoutMs: ACTION_TIMEOUT_MS,
  }),
  screenshot: defineJsonRoute({
    method: "POST",
    path: "/screenshot",
    input: z.object({}),
    output: z.object({
      imageBase64: z.string(),
      mimeType: z.string(),
      width: z.number(),
      height: z.number(),
      url: z.string(),
    }),
    timeoutMs: ACTION_TIMEOUT_MS,
  }),
  eval: defineJsonRoute({
    method: "POST",
    path: "/eval",
    input: z.object({ script: z.string().min(1) }),
    output: z.object({ result: z.string() }),
    timeoutMs: ACTION_TIMEOUT_MS,
  }),
  location: defineJsonRoute({
    method: "GET",
    path: "/location",
    input: z.object({}),
    output: z.object({ lastUrl: z.string().nullable(), lastTitle: z.string().nullable() }),
    timeoutMs: ACTION_TIMEOUT_MS,
  }),
};
