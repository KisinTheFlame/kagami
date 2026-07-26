import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@kagami/llm-client";
import { VisionAgent } from "../src/vision/application/vision-agent.js";

function createLlmClientMock(): LlmClient {
  return {
    chat: vi.fn(),
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn(),
  };
}

describe("VisionAgent", () => {
  it("should put the default prompt in the system field and images in the user turn", async () => {
    const llmClient = createLlmClientMock();
    vi.mocked(llmClient.chat).mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: {
        role: "assistant",
        content: "图片里有一只猫。",
        toolCalls: [],
      },
    });
    const agent = new VisionAgent({ llmClient });

    await expect(
      agent.analyzeImage({
        images: [{ content: Buffer.from("image"), mimeType: "image/png", filename: "cat.png" }],
      }),
    ).resolves.toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      description: "图片里有一只猫。",
    });

    // 稳定指令进 system 字段（#594）；单图场景 user turn 只有图片、无文本块。
    expect(llmClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("只输出最终描述本身"),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                content: Buffer.from("image").toString("base64"),
                mimeType: "image/png",
                filename: "cat.png",
              },
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      }),
      {
        usage: "vision",
        scene: "vision",
      },
    );
  });

  it("should forward a custom prompt to the system field after trimming", async () => {
    const llmClient = createLlmClientMock();
    vi.mocked(llmClient.chat).mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: {
        role: "assistant",
        content: "done",
        toolCalls: [],
      },
    });
    const agent = new VisionAgent({ llmClient });

    await agent.analyzeImage({
      images: [{ content: Buffer.from("image"), mimeType: "image/jpeg" }],
      prompt: "  只提取文字  ",
    });

    expect(llmClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "只提取文字",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                content: Buffer.from("image").toString("base64"),
                mimeType: "image/jpeg",
                filename: undefined,
              },
            ],
          },
        ],
      }),
      {
        usage: "vision",
        scene: "vision",
      },
    );
  });

  it("should keep the sliced-image tile note in the user turn, not the cached system prefix", async () => {
    const llmClient = createLlmClientMock();
    vi.mocked(llmClient.chat).mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: {
        role: "assistant",
        content: "一张长截图。",
        toolCalls: [],
      },
    });
    const agent = new VisionAgent({ llmClient });

    await agent.analyzeImage({
      images: [
        { content: Buffer.from("a"), mimeType: "image/png" },
        { content: Buffer.from("b"), mimeType: "image/png" },
      ],
    });

    const request = vi.mocked(llmClient.chat).mock.calls[0]?.[0];
    // tileCount 是每次会变的运行时值，绝不进被缓存的 system 前缀（KV 红线，#594）。
    expect(request?.system).toEqual(expect.any(String));
    expect(request?.system).not.toContain("分片");
    // 分片说明在 user turn 首块、图片之前。
    const content = request?.messages[0]?.content;
    if (!Array.isArray(content)) {
      throw new Error("expected multimodal user content");
    }
    const [note, first, second] = content;
    expect(note).toMatchObject({ type: "text" });
    if (!note || note.type !== "text") {
      throw new Error("expected first content part to be the tile note text");
    }
    expect(note.text).toContain("2 张图");
    expect(first).toMatchObject({ type: "image" });
    expect(second).toMatchObject({ type: "image" });
  });

  it("should reject empty assistant content", async () => {
    const llmClient = createLlmClientMock();
    vi.mocked(llmClient.chat).mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: {
        role: "assistant",
        content: "   ",
        toolCalls: [],
      },
    });
    const agent = new VisionAgent({ llmClient });

    await expect(
      agent.analyzeImage({
        images: [{ content: Buffer.from("image"), mimeType: "image/png" }],
      }),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "图片理解结果为空",
    });
  });

  it("should reject non-image mime types", async () => {
    const agent = new VisionAgent({ llmClient: createLlmClientMock() });

    await expect(
      agent.analyzeImage({
        images: [{ content: Buffer.from("not-image"), mimeType: "application/pdf" }],
      }),
    ).rejects.toThrow("only accepts image/* mime types");
  });
});
