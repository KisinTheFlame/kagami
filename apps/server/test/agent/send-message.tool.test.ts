import { describe, expect, it, vi } from "vitest";
import { SendMessageTool } from "../../src/agent/capabilities/messaging/tools/send-message.tool.js";

describe("send_message tool", () => {
  it("should send message by injected gateway function", async () => {
    const agentMessageService = {
      sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 9527 }),
      sendPrivateMessage: vi.fn().mockResolvedValue({ messageId: 9528 }),
    };
    const tool = new SendMessageTool({ agentMessageService });

    const result = await tool.execute(
      {
        message: "  hello group  ",
      },
      {
        chatTarget: {
          chatType: "group",
          groupId: "987654",
        },
      } as Parameters<typeof tool.execute>[1],
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
        chatType: "group",
        groupId: "987654",
        messageId: 9527,
      }),
    );
  });

  it("should send private message in qq private state", async () => {
    const agentMessageService = {
      sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 9527 }),
      sendPrivateMessage: vi.fn().mockResolvedValue({ messageId: 9630 }),
    };
    const tool = new SendMessageTool({ agentMessageService });

    const result = await tool.execute(
      {
        message: "  hello friend  ",
      },
      {
        chatTarget: {
          chatType: "private",
          userId: "123456",
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(agentMessageService.sendPrivateMessage).toHaveBeenCalledWith({
      userId: "123456",
      message: "hello friend",
    });
    expect(result.signal).toBe("continue");
    expect(result.content).toBe(
      JSON.stringify({
        ok: true,
        chatType: "private",
        userId: "123456",
        messageId: 9630,
      }),
    );
  });

  it("should return invalid arguments result when message is empty", async () => {
    const agentMessageService = {
      sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
      sendPrivateMessage: vi.fn().mockResolvedValue({ messageId: 2 }),
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
      sendPrivateMessage: vi.fn().mockResolvedValue({ messageId: 2 }),
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
      error: "CHAT_CONTEXT_UNAVAILABLE",
    });
  });
});
