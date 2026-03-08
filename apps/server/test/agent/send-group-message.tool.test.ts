import { describe, expect, it, vi } from "vitest";
import { executeToolCall } from "../../src/agent/tools/index.js";

describe("send_group_message tool", () => {
  it("should send message by injected gateway function", async () => {
    const sendGroupMessage = vi.fn().mockResolvedValue({ messageId: 9527 });
    const searchWeb = vi.fn();

    const result = await executeToolCall(
      {
        id: "tool-1",
        name: "send_group_message",
        arguments: {
          message: "  hello group  ",
        },
      },
      { sendGroupMessage, searchWeb },
    );

    expect(sendGroupMessage).toHaveBeenCalledWith({
      message: "hello group",
    });
    expect(result.shouldFinishRound).toBe(false);
    expect(result.content).toBe(
      JSON.stringify({
        ok: true,
        messageId: 9527,
      }),
    );
  });

  it("should return invalid arguments result when message is empty", async () => {
    const sendGroupMessage = vi.fn().mockResolvedValue({ messageId: 1 });
    const searchWeb = vi.fn();

    const result = await executeToolCall(
      {
        id: "tool-2",
        name: "send_group_message",
        arguments: {
          message: "   ",
        },
      },
      { sendGroupMessage, searchWeb },
    );

    expect(sendGroupMessage).not.toHaveBeenCalled();
    expect(result.shouldFinishRound).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });
});
