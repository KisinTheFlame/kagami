import { beforeAll, describe, expect, it } from "vitest";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { LogEvent, LogSink } from "@kagami/kernel/logger/types";
import {
  normalizeInputJsonValue,
  toInputJsonObject,
  toJsonRecord,
} from "../src/common/prisma-json.js";

const logs: LogEvent[] = [];

beforeAll(() => {
  const sink: LogSink = {
    write(event) {
      logs.push(event);
    },
  };
  initLoggerRuntime({ sinks: [sink] });
});

describe("normalizeInputJsonValue — JSON 归一化", () => {
  it("普通对象原样通过", () => {
    expect(normalizeInputJsonValue({ x: 1, y: "z" })).toEqual({ x: 1, y: "z" });
  });

  it("Date → ISO 字符串，bigint → 十进制字符串", () => {
    expect(normalizeInputJsonValue({ t: new Date(0), n: 10n })).toEqual({
      t: "1970-01-01T00:00:00.000Z",
      n: "10",
    });
  });

  it("function / symbol 字段被丢弃（JSON 语义）", () => {
    expect(normalizeInputJsonValue({ f: () => 1, s: Symbol("x"), keep: true })).toEqual({
      keep: true,
    });
  });

  it("顶层 undefined / null 归一为字符串标记", () => {
    expect(normalizeInputJsonValue(undefined)).toBe("undefined");
    expect(normalizeInputJsonValue(null)).toBe("null");
  });

  it("循环引用不再静默降级成 '[object Object]'：返回可诊断标记并记结构化日志", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const before = logs.length;

    const normalized = normalizeInputJsonValue(circular);

    expect(normalized).toMatchObject({ __unserializable: true, valueType: "Object" });
    expect((normalized as { reason: string }).reason).toContain("circular");
    // 绝不是旧行为的 "[object Object]"
    expect(normalized).not.toBe("[object Object]");
    // 落了 error 日志（事件名锁定，供线上检索）
    const emitted = logs.slice(before);
    expect(
      emitted.some(
        event =>
          event.level === "error" &&
          event.metadata.event === "persistence.prisma_json.serialize_failed",
      ),
    ).toBe(true);
  });
});

describe("toJsonRecord / toInputJsonObject", () => {
  it("record 原样返回，非 record 包一层 { value }", () => {
    expect(toJsonRecord({ a: 1 })).toEqual({ a: 1 });
    expect(toJsonRecord("plain")).toEqual({ value: "plain" });
  });

  it("toInputJsonObject 对非对象归一结果包一层 { value }", () => {
    expect(toInputJsonObject({ a: new Date(0) })).toEqual({ a: "1970-01-01T00:00:00.000Z" });
  });
});
