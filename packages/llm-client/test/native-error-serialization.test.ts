import { describe, expect, it } from "vitest";

import { toSerializableLlmNativeRecord } from "../src/provider.js";

describe("toSerializableLlmNativeRecord", () => {
  it("展开 undici `fetch failed` 的 cause 链与网络诊断字段", () => {
    // 复现 undici 的形状：外层 TypeError 无细节，真正的 errno 在 cause 里。
    const cause = new Error("connect ECONNREFUSED 198.18.0.103:443");
    Object.assign(cause, {
      code: "ECONNREFUSED",
      errno: -61,
      syscall: "connect",
      address: "198.18.0.103",
      port: 443,
    });
    const error = new TypeError("fetch failed", { cause });

    const record = toSerializableLlmNativeRecord(error);

    expect(record.name).toBe("TypeError");
    expect(record.message).toBe("fetch failed");
    const serializedCause = record.cause as Record<string, unknown>;
    expect(serializedCause.code).toBe("ECONNREFUSED");
    expect(serializedCause.errno).toBe(-61);
    expect(serializedCause.syscall).toBe("connect");
    expect(serializedCause.address).toBe("198.18.0.103");
    expect(serializedCause.port).toBe(443);
  });

  it("展开 AggregateError 的 errors 子错误", () => {
    const error = new AggregateError(
      [new Error("attempt A failed"), new Error("attempt B failed")],
      "all attempts failed",
    );

    const record = toSerializableLlmNativeRecord(error);

    const errors = record.errors as Array<Record<string, unknown>>;
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toBe("attempt A failed");
    expect(errors[1].message).toBe("attempt B failed");
  });

  it("循环 cause 不抛异常，降级为字符串", () => {
    const error = new Error("self-referential");
    Object.assign(error, { cause: error });

    expect(() => toSerializableLlmNativeRecord(error)).not.toThrow();
  });
});
