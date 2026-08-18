import { describe, expect, it } from "vitest";
import {
  assembleRequestPayload,
  buildRequestSkeleton,
  parseRequestSkeleton,
  splitRequestPayload,
} from "../src/app/llm-request-payload.js";

function roundTrip(request: Record<string, unknown>): Record<string, unknown> {
  const split = splitRequestPayload(request);
  const skeleton = buildRequestSkeleton(split, { systemBlobId: 1, toolsBlobId: 2 });

  return assembleRequestPayload({
    skeleton: parseRequestSkeleton(JSON.parse(JSON.stringify(skeleton)) as unknown),
    systemRaw: split.systemRaw,
    toolsRaw: split.toolsRaw,
    messageRaws: split.messageRaws,
  });
}

describe("llm-request-payload — 拆分与重组", () => {
  it("完整请求往返深度相等", () => {
    const request = {
      system: "你是小镜",
      model: "claude-opus-4-6",
      toolChoice: "auto",
      thinking: "low",
      tools: [{ name: "invoke", parameters: { type: "object", properties: {} } }],
      messages: [
        { role: "user", content: "在吗" },
        { role: "assistant", content: "在", toolCalls: [] },
      ],
    };

    expect(roundTrip(request)).toEqual(request);
  });

  it("未知字段原样透传（skeleton 不是白名单）", () => {
    const request = { messages: [], futureKnob: { nested: [1, 2] }, count: 3 };

    expect(roundTrip(request)).toEqual(request);
  });

  it("system 缺省与空串可区分", () => {
    expect("system" in roundTrip({ messages: [] })).toBe(false);
    expect(roundTrip({ system: "", messages: [] }).system).toBe("");
  });

  it("tools 是空数组也照存，不退化成 null", () => {
    const split = splitRequestPayload({ tools: [], messages: [] });

    expect(split.toolsRaw?.toString("utf8")).toBe("[]");
    expect(roundTrip({ tools: [], messages: [] }).tools).toEqual([]);
  });

  it("system / tools 类型不对时留在 rest 里走 JSON 透传，不强转", () => {
    const request = { system: { unexpected: true }, tools: "not-an-array", messages: [] };
    const split = splitRequestPayload(request);

    expect(split.systemRaw).toBeNull();
    expect(split.toolsRaw).toBeNull();
    expect(roundTrip(request)).toEqual(request);
  });

  it("没有 messages 键时重组也不会凭空造一个", () => {
    const request = { system: "x", tools: [] };

    expect("messages" in roundTrip(request)).toBe(false);
  });

  it("skeleton 不是对象说明行损坏，抛错", () => {
    expect(() => parseRequestSkeleton("坏了")).toThrow(/request_skeleton 不是对象/);
  });
});
