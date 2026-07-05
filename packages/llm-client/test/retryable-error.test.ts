import { describe, expect, it } from "vitest";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { bizErrorFromWire, toBizErrorWire } from "@kagami/kernel/errors/biz-error-wire";
import {
  isRetryableLlmFailure,
  llmProviderUnavailableError,
  llmUpstreamCallFailedError,
  LLM_PROVIDER_UNAVAILABLE_MESSAGE,
  LLM_UPSTREAM_CALL_FAILED_MESSAGE,
} from "../src/retryable-error.js";

describe("llm retryable-error factories", () => {
  it("llmProviderUnavailableError 盖 retryable 标记、保原文 message、并入调用方 meta", () => {
    const error = llmProviderUnavailableError({
      meta: { provider: "claude-code", reason: "UNAUTHORIZED" },
    });
    expect(error).toBeInstanceOf(BizError);
    expect(error.message).toBe(LLM_PROVIDER_UNAVAILABLE_MESSAGE);
    expect(error.meta).toEqual({
      provider: "claude-code",
      reason: "UNAUTHORIZED",
      retryable: true,
    });
  });

  it("llmUpstreamCallFailedError 盖 retryable 标记、保原文 message、透传 meta 与 cause", () => {
    const cause = new Error("socket hang up");
    const error = llmUpstreamCallFailedError({ meta: { provider: "openai" }, cause });
    expect(error.message).toBe(LLM_UPSTREAM_CALL_FAILED_MESSAGE);
    expect(error.meta).toEqual({ provider: "openai", retryable: true });
    expect(error.cause).toBe(cause);
  });

  it("两个工厂无参也能构造带标记的错误", () => {
    expect(llmProviderUnavailableError().meta).toEqual({ retryable: true });
    expect(llmUpstreamCallFailedError().meta).toEqual({ retryable: true });
    expect(llmUpstreamCallFailedError().cause).toBeUndefined();
  });
});

describe("isRetryableLlmFailure 真值表", () => {
  it("工厂造的错误 → 可重试", () => {
    expect(isRetryableLlmFailure(llmProviderUnavailableError())).toBe(true);
    expect(
      isRetryableLlmFailure(llmUpstreamCallFailedError({ meta: { reason: "HTTP_ERROR" } })),
    ).toBe(true);
  });

  it("裸 BizError 即使 message 撞魔法串、但无 marker → 不可重试（消除 message 匹配的误报）", () => {
    expect(isRetryableLlmFailure(new BizError({ message: LLM_UPSTREAM_CALL_FAILED_MESSAGE }))).toBe(
      false,
    );
    expect(isRetryableLlmFailure(new BizError({ message: LLM_PROVIDER_UNAVAILABLE_MESSAGE }))).toBe(
      false,
    );
  });

  it("普通 BizError / 非 BizError → 不可重试", () => {
    expect(isRetryableLlmFailure(new BizError({ message: "请求参数不合法" }))).toBe(false);
    expect(isRetryableLlmFailure(new Error("boom"))).toBe(false);
    expect(isRetryableLlmFailure(undefined)).toBe(false);
    expect(isRetryableLlmFailure({ meta: { retryable: true } })).toBe(false);
  });
});

describe("marker 穿越 HTTP wire 往返", () => {
  it("toBizErrorWire → bizErrorFromWire 保留 meta.retryable，判定仍为真", () => {
    const original = llmUpstreamCallFailedError({
      meta: { provider: "claude-code", reason: "EMPTY_CONTENT" },
    });
    const revived = bizErrorFromWire(toBizErrorWire(original));
    expect(revived.meta).toEqual({
      provider: "claude-code",
      reason: "EMPTY_CONTENT",
      retryable: true,
    });
    expect(isRetryableLlmFailure(revived)).toBe(true);
  });
});
