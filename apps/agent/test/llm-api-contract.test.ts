import { createClient } from "@kagami/rpc-client/client";
import { llmApiContract } from "@kagami/llm-api/contract";
import type { LlmProviderOption } from "@kagami/shared/schemas/llm-chat";
import { describe, expect, it } from "vitest";

/**
 * 契约编译期强制的「试金石」（issue #230）。这些断言主要靠 `tsc --noEmit`（agent typecheck，经
 * tsconfig paths 对 @kagami/llm-api **源码**解析）把关：改 llmApiContract.listProviders 的 output，
 * 下面的类型断言与 @ts-expect-error 会立即失败 —— 证明「上游改契约、下游编译报错」。
 * vitest 只跑运行时那一行 expect，类型块用 `void (async …)` 包住不执行。
 */
describe("llm-api 契约：编译期类型强制", () => {
  it("createClient 派生的 listProviders 返回类型 == 契约 output（LlmProviderOption[]）", () => {
    const api = createClient(llmApiContract, { baseUrl: "http://llm" });
    // 门面 == 契约：返回类型必须精确赋给 Promise<LlmProviderOption[]>，否则编译失败。
    const assertReturnType = (): Promise<LlmProviderOption[]> =>
      api.listProviders({ usage: "agent" });
    void assertReturnType;
    expect(typeof api.listProviders).toBe("function");
  });

  it("传错 input / 读不存在的 output 字段 → 编译期报错", () => {
    const api = createClient(llmApiContract, { baseUrl: "http://llm" });
    void (async (): Promise<void> => {
      // @ts-expect-error usage 是必填 string，缺失必须报错
      await api.listProviders({});
      // @ts-expect-error 契约 input 无 wrongField
      await api.listProviders({ usage: "agent", wrongField: 1 });
      const providers = await api.listProviders({ usage: "agent" });
      // @ts-expect-error output 元素是 { id, models }，无 nonExistent 字段
      void providers[0]?.nonExistent;
    });
    expect(typeof api.listProviders).toBe("function");
  });

  it("chat/chatDirect/embed 是信封级：request/output 是 unknown，但信封字段仍编译期强制", () => {
    const api = createClient(llmApiContract, { baseUrl: "http://llm" });
    void (async (): Promise<void> => {
      // request 是 unknown：任意结构放行（信封级刻意不逐字段校验）
      await api.chat({ request: { whatever: true }, usage: "agent" });
      // @ts-expect-error 信封字段 usage 必填，缺失必须报错
      await api.chat({ request: {} });
      // @ts-expect-error chatDirect 信封要求 providerId/model，缺失必须报错
      await api.chatDirect({ request: {}, usage: "agent" });
      await api.chatDirect({ request: {}, providerId: "openai", model: "gpt" });
      // output 是 unknown：不暴露具体字段类型（信封级，门面按接口断言）
      const res: unknown = await api.chat({ request: {}, usage: "agent" });
      void res;
      await api.embed({ request: { content: "hi" } });
    });
    expect(typeof api.chat).toBe("function");
    expect(typeof api.embed).toBe("function");
  });
});
