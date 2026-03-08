import { describe, expect, it, vi } from "vitest";
import { createSendGroupMessageTool } from "../../src/agent/tools/send-group-message.js";

describe("send_group_message tool", () => {
  it("should send message by injected gateway function", async () => {
    const sendGroupMessage = vi.fn().mockResolvedValue({ messageId: 9527 });
    const tool = createSendGroupMessageTool({ sendGroupMessage });

    const result = await tool.execute({
      message: "  hello group  ",
    });

    expect(tool.tool.name).toBe("send_group_message");
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
    const tool = createSendGroupMessageTool({ sendGroupMessage });

    const result = await tool.execute({
      message: "   ",
    });

    expect(sendGroupMessage).not.toHaveBeenCalled();
    expect(result.shouldFinishRound).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });
});
