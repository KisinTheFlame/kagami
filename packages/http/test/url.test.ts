import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineJsonRoute } from "../src/contract.js";
import { contractUrl, interpolatePath, toQueryString } from "../src/url.js";

describe("interpolatePath", () => {
  it("插值并 encodeURIComponent", () => {
    expect(interpolatePath("/objects/:key", { key: "res 1/x" })).toBe("/objects/res%201%2Fx");
  });

  it("多参数逐一替换", () => {
    expect(interpolatePath("/a/:x/b/:y", { x: "1", y: "2" })).toBe("/a/1/b/2");
  });

  it("缺参数抛错（编程错误）", () => {
    expect(() => interpolatePath("/a/:x", {})).toThrow("路径参数缺失：x");
  });
});

describe("toQueryString", () => {
  it("undefined/null 值跳过（空值不上 wire）", () => {
    expect(toQueryString({ a: "1", b: undefined, c: null })).toBe("a=1");
  });

  it("number/boolean String() 化，对象跳过", () => {
    expect(toQueryString({ n: 2, ok: true, obj: { x: 1 } })).toBe("n=2&ok=true");
  });

  it("非对象输入返回空串", () => {
    expect(toQueryString(undefined)).toBe("");
    expect(toQueryString("x")).toBe("");
  });
});

describe("contractUrl", () => {
  const plainRoute = defineJsonRoute({
    method: "GET",
    path: "/app-log/query",
    input: z.object({ page: z.number().optional() }),
    output: z.object({}),
  });

  const paramRoute = defineJsonRoute({
    method: "GET",
    path: "/llm-chat-call/:id",
    params: z.object({ id: z.coerce.number().int().positive() }),
    input: z.object({}),
    output: z.object({}),
  });

  it("无 params 路由：纯路径", () => {
    expect(contractUrl(plainRoute)).toBe("/app-log/query");
  });

  it("query 序列化（空值跳过）", () => {
    expect(contractUrl(plainRoute, { query: { page: 2, keyword: undefined } })).toBe(
      "/app-log/query?page=2",
    );
  });

  it("params 路由：schema 校验后插值", () => {
    expect(contractUrl(paramRoute, { params: { id: 42 } })).toBe("/llm-chat-call/42");
  });

  it("params 不合 schema 抛错", () => {
    expect(() => contractUrl(paramRoute, { params: { id: -1 } })).toThrow();
  });

  it("params + query 并存", () => {
    expect(contractUrl(paramRoute, { params: { id: 7 }, query: { verbose: true } })).toBe(
      "/llm-chat-call/7?verbose=true",
    );
  });
});

describe("浏览器安全守护（web bundle 不得含 fastify / Node 运行时依赖）", () => {
  it("wire/url/contract 三模块对 fastify 与 node: 只允许 type-only import", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    for (const name of ["wire.ts", "url.ts", "contract.ts"]) {
      const src = await readFile(path.join(srcDir, name), "utf8");
      // 连 type-only import 都不行：d.ts 的类型引用会把 @types/node 拖进 web 的类型空间。
      const anyImport = /import\s+[^;]*from\s+"(fastify|node:[^"]+)"/;
      expect(src, `${name} 引用了 fastify/node（含 type import）`).not.toMatch(anyImport);
    }
  });
});
