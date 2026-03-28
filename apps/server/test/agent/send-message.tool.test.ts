import { describe, expect, it, vi } from "vitest";
import { SendMessageTool } from "../../src/agent/capabilities/messaging/tools/send-message.tool.js";

describe("send_message tool", () => {
  it("should send message by injected gateway function", async () => {
    const agentMessageService = {
      sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 9527 }),
    };
    const tool = new SendMessageTool({ agentMessageService });

    const result = await tool.execute(
      {
        message: "  hello group  ",
      },
      {
        groupId: "987654",
      },
    );

    expect(tool.name).toBe("send_message");
    expect(agentMessageService.sendGroupMessage).toHaveBeenCalledWith({
      groupId: "987654",
      message: "hello group",
    });
    expect(result.signal).toBe("continue");
    expect(result.content).toBe(
      JSON.stringify({
        ok: true,
        groupId: "987654",
        messageId: 9527,
      }),
    );
  });

  it("should return invalid arguments result when message is empty", async () => {
    const agentMessageService = {
      sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
    };
    const tool = new SendMessageTool({ agentMessageService });

    const result = await tool.execute(
      {
        message: "   ",
      },
      {},
    );

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  it("should return group context unavailable when current group is missing", async () => {
    const agentMessageService = {
      sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
    };
    const tool = new SendMessageTool({ agentMessageService });

    const result = await tool.execute(
      {
        message: "hello",
      },
      {},
    );

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "GROUP_CONTEXT_UNAVAILABLE",
    });
  });
});
