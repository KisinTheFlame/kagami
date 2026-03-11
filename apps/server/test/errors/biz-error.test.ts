import { describe, expect, it } from "vitest";
import { BizError } from "../../src/errors/biz-error.js";

describe("BizError", () => {
  it("should preserve message, meta, and cause", () => {
    const cause = new Error("boom");
    const error = new BizError({
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai",
      },
      cause,
    });

    expect(error).toBeInstanceOf(BizError);
    expect(error).toMatchObject({
      name: "BizError",
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai",
      },
      cause,
    });
  });
});
