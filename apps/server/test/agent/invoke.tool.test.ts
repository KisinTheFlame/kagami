import { describe, expect, it, vi } from "vitest";
import { SendMessageTool } from "../../src/agent/capabilities/messaging/tools/send-message.tool.js";
import { InvokeTool } from "../../src/agent/runtime/root-agent/tools/invoke.tool.js";
import { ZoneOutTool } from "../../src/agent/runtime/root-agent/tools/zone-out.tool.js";

describe("invoke tool", () => {
  it("should invoke send_message in qq group state", async () => {
    const agentMessageService = {
      sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 9527 }),
    };
    const tool = new InvokeTool({
      tools: [new SendMessageTool({ agentMessageService }), new ZoneOutTool()],
    });

    const result = await tool.execute(
      {
        tool: "send_message",
        args: {
          message: "  hello group  ",
        },
      },
      {
        groupId: "group-1",
        rootAgentSession: {
          getState: () => ({ kind: "qq_group" as const, groupId: "group-1" }),
          getAvailableInvokeTools: () => ["send_message"],
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(agentMessageService.sendGroupMessage).toHaveBeenCalledWith({
      groupId: "group-1",
      message: "hello group",
    });
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      groupId: "group-1",
      messageId: 9527,
    });
  });

  it("should return agent-friendly message when subtool is unavailable in current state", async () => {
    const agentMessageService = {
      sendGroupMessage: vi.fn(),
    };
    const tool = new InvokeTool({
      tools: [new SendMessageTool({ agentMessageService }), new ZoneOutTool()],
    });

    const result = await tool.execute(
      {
        tool: "send_message",
        args: {
          message: "hello",
        },
      },
      {
        rootAgentSession: {
          getState: () => ({ kind: "zone_out" as const }),
          getAvailableInvokeTools: () => ["zone_out"],
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVOKE_TOOL_NOT_AVAILABLE",
      availableTools: ["zone_out"],
    });
    expect(JSON.parse(result.content).message).toContain("不能在当前状态 zone_out 下调用");
  });

  it("should allow zone_out only in zone_out state", async () => {
    const tool = new InvokeTool({
      tools: [
        new SendMessageTool({
          agentMessageService: {
            sendGroupMessage: vi.fn(),
          },
        }),
        new ZoneOutTool(),
      ],
    });

    const result = await tool.execute(
      {
        tool: "zone_out",
        args: {
          thought: "  先发会呆  ",
        },
      },
      {
        rootAgentSession: {
          getState: () => ({ kind: "zone_out" as const }),
          getAvailableInvokeTools: () => ["zone_out"],
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      thought: "先发会呆",
    });
  });
});
