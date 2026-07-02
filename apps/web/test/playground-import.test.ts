import { describe, expect, it } from "vitest";
import type { LlmChatCallItem, LlmChatRequestPayload } from "@kagami/shared/schemas/llm-chat";
import {
  buildPlaygroundImportDraftFromHistory,
  getPlaygroundImportDraftFromLocationState,
  resolvePlaygroundImportDraft,
  type PlaygroundImportDraft,
} from "@/pages/llm-playground/playground-import";

const item = {
  id: 7,
  requestId: "req-1",
  createdAt: "2026-07-02T00:00:00.000Z",
  provider: "deepseek",
  model: "deepseek-chat",
  status: "success",
} as LlmChatCallItem;

function buildRequest(overrides: Partial<LlmChatRequestPayload> = {}): LlmChatRequestPayload {
  return {
    model: "deepseek-chat",
    messages: [{ role: "user", content: "hi" }],
    ...overrides,
  } as LlmChatRequestPayload;
}

describe("buildPlaygroundImportDraftFromHistory", () => {
  it("纯文本消息原样进 payload，无告警", () => {
    const draft = buildPlaygroundImportDraftFromHistory({ item, request: buildRequest() });
    expect(draft.payload.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(draft.warnings).toEqual([]);
    expect(draft.source).toMatchObject({ itemId: 7, provider: "deepseek" });
  });

  it("图片片段替换为文本占位并产生 image_omitted 告警（含张数与元信息）", () => {
    const request = buildRequest({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "看图" },
            { type: "image", filename: "a.png", mimeType: "image/png", sizeBytes: 123 },
            { type: "image" },
          ],
        },
      ],
    } as Partial<LlmChatRequestPayload>);

    const draft = buildPlaygroundImportDraftFromHistory({ item, request });

    const [message] = draft.payload.messages;
    expect(Array.isArray(message.content) ? message.content : []).toEqual([
      { type: "text", text: "看图" },
      {
        type: "text",
        text: "[图片已忽略：原图未保存在历史记录中；文件名：a.png；MIME：image/png；大小：123 B]",
      },
      { type: "text", text: "[图片已忽略：原图未保存在历史记录中]" },
    ]);
    expect(draft.warnings).toEqual([
      expect.objectContaining({ code: "image_omitted", message: expect.stringContaining("2 个") }),
    ]);
  });
});

describe("resolvePlaygroundImportDraft", () => {
  const baseDraft = (): PlaygroundImportDraft =>
    buildPlaygroundImportDraftFromHistory({ item, request: buildRequest() });

  it("provider + model 都可用：直接选中，无新增告警", () => {
    const resolved = resolvePlaygroundImportDraft({
      draft: baseDraft(),
      providers: [{ id: "deepseek", models: ["deepseek-chat"] }],
    });
    expect(resolved.selectedProviderId).toBe("deepseek");
    expect(resolved.selectedModel).toBe("deepseek-chat");
    expect(resolved.warnings).toEqual([]);
  });

  it("provider 不可用：回落到第一个可用 provider 并告警", () => {
    const resolved = resolvePlaygroundImportDraft({
      draft: baseDraft(),
      providers: [{ id: "openai", models: ["gpt-x"] }],
    });
    expect(resolved.selectedProviderId).toBe("openai");
    expect(resolved.selectedModel).toBe("gpt-x");
    expect(resolved.warnings.map(warning => warning.code)).toEqual([
      "provider_unavailable",
      "model_unavailable",
    ]);
  });

  it("无可用 provider：保留 payload、选择置空、no_provider_available 告警", () => {
    const resolved = resolvePlaygroundImportDraft({ draft: baseDraft(), providers: [] });
    expect(resolved.selectedProviderId).toBe("");
    expect(resolved.selectedModel).toBe("");
    expect(resolved.warnings.map(warning => warning.code)).toEqual(["no_provider_available"]);
  });
});

describe("getPlaygroundImportDraftFromLocationState", () => {
  it("非 record / 缺字段 / 字段非 record 一律返回 null", () => {
    expect(getPlaygroundImportDraftFromLocationState(null)).toBeNull();
    expect(getPlaygroundImportDraftFromLocationState("x")).toBeNull();
    expect(getPlaygroundImportDraftFromLocationState({})).toBeNull();
    expect(getPlaygroundImportDraftFromLocationState({ playgroundImport: 42 })).toBeNull();
  });

  it("形状正确时透传", () => {
    const draft = buildPlaygroundImportDraftFromHistory({ item, request: buildRequest() });
    expect(getPlaygroundImportDraftFromLocationState({ playgroundImport: draft })).toBe(draft);
  });
});
