import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../../src/llm/client.js";
import { VisionAgent } from "../../src/agent/agents/subagents/vision/vision-agent.js";

function createLlmClientMock(): LlmClient {
  return {
    chat: vi.fn(),
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn(),
  };
}

describe("VisionAgent", () => {
  it("should use the default prompt and vision usage", async () => {
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
        content: Buffer.from("image"),
        mimeType: "image/png",
        filename: "cat.png",
      }),
    ).resolves.toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      description: "图片里有一只猫。",
    });

    expect(llmClient.chat).toHaveBeenCalledWith(
      {
        messages: [
          {
            role: "user",
            content: [
              expect.objectContaining({
                type: "text",
              }),
              {
                type: "image",
                content: Buffer.from("image"),
                mimeType: "image/png",
                filename: "cat.png",
              },
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      },
      {
        usage: "vision",
      },
    );
    const firstMessage = vi.mocked(llmClient.chat).mock.calls[0]?.[0]?.messages[0];
    expect(firstMessage?.role).toBe("user");
    if (firstMessage?.role !== "user" || !Array.isArray(firstMessage.content)) {
      throw new Error("expected first message to be a multimodal user message");
    }
    const [promptPart] = firstMessage.content;
    expect(promptPart?.type).toBe("text");
    if (!promptPart || promptPart.type !== "text") {
      throw new Error("expected first content part to be text");
    }
    expect(promptPart.text).toContain("请把这张图片转成适合聊天上下文的一小段中文文本。");
  });

  it("should forward a custom prompt after trimming", async () => {
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
      content: Buffer.from("image"),
      mimeType: "image/jpeg",
      prompt: "  只提取文字  ",
    });

    expect(llmClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "只提取文字",
              },
              {
                type: "image",
                content: Buffer.from("image"),
                mimeType: "image/jpeg",
                filename: undefined,
              },
            ],
          },
        ],
      }),
      {
        usage: "vision",
      },
    );
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
        content: Buffer.from("image"),
        mimeType: "image/png",
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
        content: Buffer.from("not-image"),
        mimeType: "application/pdf",
      }),
    ).rejects.toThrow("only accepts image/* mime types");
  });
});
