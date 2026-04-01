import { describe, expect, it, vi } from "vitest";
import { OpenIthomeArticleTool } from "../../src/agent/capabilities/news/tools/open-ithome-article.tool.js";
import { SendMessageTool } from "../../src/agent/capabilities/messaging/tools/send-message.tool.js";
import { InvokeTool } from "../../src/agent/runtime/root-agent/tools/invoke.tool.js";
import { ZoneOutTool } from "../../src/agent/runtime/root-agent/tools/zone-out.tool.js";

describe("invoke tool", () => {
  it("should expose flattened invoke parameters", () => {
    const tool = new InvokeTool({
      tools: [
        new SendMessageTool({
          agentMessageService: {
            sendGroupMessage: vi.fn(),
          },
        }),
        new ZoneOutTool(),
        new OpenIthomeArticleTool(),
      ],
    });

    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        tool: {
          type: "string",
          description:
            '要调用的子工具名，例如 "send_message"、"open_ithome_article" 或 "zone_out"。',
        },
        message: {
          type: "string",
          description: "仅 send_message 使用。要发送到群里的文本内容。",
        },
        thought: {
          type: "string",
          description: "仅 zone_out 使用。这次神游里想的内容。",
        },
        articleId: {
          type: "number",
          description: "仅 open_ithome_article 使用。要打开的文章 ID，来自当前 IT 之家文章列表。",
        },
      },
    });
  });

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
        message: "  hello group  ",
      },
      {
        groupId: "group-1",
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "qq_group:group-1" as const,
            stateStack: ["portal", "qq_group:group-1"] as const,
            waiting: null,
          }),
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
        message: "hello",
      },
      {
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "zone_out" as const,
            stateStack: ["portal", "zone_out"] as const,
            waiting: null,
          }),
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
        thought: "  先发会呆  ",
      },
      {
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "zone_out" as const,
            stateStack: ["portal", "zone_out"] as const,
            waiting: null,
          }),
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

  it("should invoke open_ithome_article in ithome state", async () => {
    const openIthomeArticle = vi.fn().mockResolvedValue({
      ok: true,
      kind: "ithome_article",
      articleId: 123,
    });
    const tool = new InvokeTool({
      tools: [
        new SendMessageTool({ agentMessageService: { sendGroupMessage: vi.fn() } }),
        new ZoneOutTool(),
        new OpenIthomeArticleTool(),
      ],
    });

    const result = await tool.execute(
      {
        tool: "open_ithome_article",
        articleId: 123,
      },
      {
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "ithome" as const,
            stateStack: ["portal", "ithome"] as const,
            waiting: null,
          }),
          getAvailableInvokeTools: () => ["open_ithome_article"],
          openIthomeArticle,
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(openIthomeArticle).toHaveBeenCalledWith({
      articleId: 123,
    });
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      kind: "ithome_article",
      articleId: 123,
    });
  });

  it("should return agent-friendly message when ithome article does not exist", async () => {
    const tool = new InvokeTool({
      tools: [
        new SendMessageTool({ agentMessageService: { sendGroupMessage: vi.fn() } }),
        new ZoneOutTool(),
        new OpenIthomeArticleTool(),
      ],
    });

    const result = await tool.execute(
      {
        tool: "open_ithome_article",
        articleId: 999,
      },
      {
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "ithome" as const,
            stateStack: ["portal", "ithome"] as const,
            waiting: null,
          }),
          getAvailableInvokeTools: () => ["open_ithome_article"],
          openIthomeArticle: vi.fn().mockResolvedValue({
            ok: false,
            error: "ARTICLE_NOT_FOUND",
            articleId: 999,
          }),
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "ARTICLE_NOT_FOUND",
      articleId: 999,
      availableTools: ["open_ithome_article"],
    });
    expect(JSON.parse(result.content).message).toBe("当前 IT 之家列表中找不到该文章 ID。");
  });
});
