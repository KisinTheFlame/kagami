import {
  AppManager,
  createAppSubtoolOwner,
  type ToolComponent,
  type ToolContext,
} from "@kagami/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import { OpenIthomeArticleTool } from "../../src/agent/capabilities/news/tools/open-ithome-article.tool.js";
import { SendMessageTool } from "../../src/agent/capabilities/messaging/tools/send-message.tool.js";
import { InvokeTool } from "../../src/agent/runtime/root-agent/tools/invoke.tool.js";
import { createStateTreeSubtoolOwner } from "../../src/agent/runtime/root-agent/tools/state-tree-subtool-owner.js";

function createAgentMessageService() {
  return {
    sendGroupMessage: vi.fn(),
    sendPrivateMessage: vi.fn(),
  };
}

/**
 * 测试用 InvokeTool 工厂。模拟 factory 的 owners 装配：
 *   - appOwner：用提供的 AppManager 控制
 *   - stateTreeOwner：catch-all，依赖 ctx 里挂的 mock session 的
 *     getAvailableInvokeTools
 *
 * 如果不传 appManager，默认建一个空的。
 */
function createTestInvokeTool(opts: {
  tools: ToolComponent[];
  appManager?: AppManager;
}): InvokeTool {
  const appManager = opts.appManager ?? new AppManager();
  const invokeToolDefinitionByName = new Map(opts.tools.map(t => [t.name, t.llmTool]));
  return new InvokeTool({
    tools: opts.tools,
    owners: [
      createAppSubtoolOwner({
        appManager,
        getCurrentApp: (ctx: ToolContext) => {
          const session = (
            ctx as ToolContext & {
              rootAgentSession?: { getCurrentApp(): string | undefined };
            }
          ).rootAgentSession;
          return session?.getCurrentApp();
        },
      }),
      createStateTreeSubtoolOwner({
        appManager,
        invokeToolDefinitionByName,
      }),
    ],
  });
}

describe("invoke tool", () => {
  it("should expose flattened invoke parameters", () => {
    const tool = createTestInvokeTool({
      tools: [
        new SendMessageTool({
          agentMessageService: createAgentMessageService(),
        }),
        new OpenIthomeArticleTool(),
      ],
    });

    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        tool: {
          type: "string",
          description: '要调用的子工具名，例如 "send_message" 或 "open_ithome_article"。',
        },
        message: {
          type: "string",
          description: "仅 send_message 使用。要发送到当前会话里的文本内容。",
        },
        articleId: {
          type: "number",
          description: "仅 open_ithome_article 使用。要打开的文章 ID，来自当前 IT 之家文章列表。",
        },
      },
    });
  });

  it("should invoke send_message in qq group state", async () => {
    const agentMessageService = createAgentMessageService();
    agentMessageService.sendGroupMessage.mockResolvedValue({ messageId: 9527 });
    const tool = createTestInvokeTool({
      tools: [new SendMessageTool({ agentMessageService })],
    });

    const result = await tool.execute(
      {
        tool: "send_message",
        message: "  hello group  ",
      },
      {
        chatTarget: {
          chatType: "group",
          groupId: "group-1",
        },
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "qq_group:group-1" as const,
            stateStack: ["portal", "qq_group:group-1"] as const,
            waiting: null,
          }),
          getAvailableInvokeTools: () => ["send_message"],
          getCurrentApp: () => undefined,
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(agentMessageService.sendGroupMessage).toHaveBeenCalledWith({
      groupId: "group-1",
      message: "hello group",
    });
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      chatType: "group",
      groupId: "group-1",
      messageId: 9527,
    });
  });

  it("should invoke send_message in qq private state", async () => {
    const agentMessageService = createAgentMessageService();
    agentMessageService.sendPrivateMessage.mockResolvedValue({ messageId: 9630 });
    const tool = createTestInvokeTool({
      tools: [new SendMessageTool({ agentMessageService })],
    });

    const result = await tool.execute(
      {
        tool: "send_message",
        message: "  hello private  ",
      },
      {
        chatTarget: {
          chatType: "private",
          userId: "user-1",
        },
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "qq_private:user-1" as const,
            stateStack: ["portal", "qq_private:user-1"] as const,
            waiting: null,
          }),
          getAvailableInvokeTools: () => ["send_message"],
          getCurrentApp: () => undefined,
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(agentMessageService.sendPrivateMessage).toHaveBeenCalledWith({
      userId: "user-1",
      message: "hello private",
    });
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      chatType: "private",
      userId: "user-1",
      messageId: 9630,
    });
  });

  it("should return agent-friendly message when subtool is unavailable in current state", async () => {
    const agentMessageService = createAgentMessageService();
    const tool = createTestInvokeTool({
      tools: [new SendMessageTool({ agentMessageService }), new OpenIthomeArticleTool()],
    });

    const result = await tool.execute(
      {
        tool: "send_message",
        message: "hello",
      },
      {
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "ithome" as const,
            stateStack: ["portal", "ithome"] as const,
            waiting: null,
          }),
          getAvailableInvokeTools: () => ["open_ithome_article"],
          getCurrentApp: () => undefined,
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVOKE_TOOL_NOT_AVAILABLE",
      availableTools: ["open_ithome_article"],
    });
    expect(JSON.parse(result.content).message).toContain("不能在当前状态 ithome 下调用");
    expect(JSON.parse(result.content).message).toContain("当前状态可用的 invoke 工具说明：");
    expect(JSON.parse(result.content).message).toContain("`open_ithome_article`");
    expect(JSON.parse(result.content).message).toContain("`articleId` (number)");
  });

  it("should invoke open_ithome_article in ithome state", async () => {
    const openIthomeArticle = vi.fn().mockResolvedValue({
      ok: true,
      kind: "ithome_article",
      articleId: 123,
    });
    const tool = createTestInvokeTool({
      tools: [
        new SendMessageTool({ agentMessageService: createAgentMessageService() }),
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
          getCurrentApp: () => undefined,
          openIthomeArticle,
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(openIthomeArticle).toHaveBeenCalledWith({
      articleId: 123,
    });
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      kind: "ithome_article",
      articleId: 123,
    });
  });

  it("should return agent-friendly message when ithome article does not exist", async () => {
    const tool = createTestInvokeTool({
      tools: [
        new SendMessageTool({ agentMessageService: createAgentMessageService() }),
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
          getCurrentApp: () => undefined,
          openIthomeArticle: vi.fn().mockResolvedValue({
            ok: false,
            error: "ARTICLE_NOT_FOUND",
            articleId: 999,
          }),
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "ARTICLE_NOT_FOUND",
      articleId: 999,
      availableTools: ["open_ithome_article"],
    });
    expect(JSON.parse(result.content).message).toContain("当前 IT 之家列表中找不到该文章 ID。");
    expect(JSON.parse(result.content).message).toContain("当前子工具说明：");
    expect(JSON.parse(result.content).message).toContain("`open_ithome_article`");
    expect(JSON.parse(result.content).message).toContain("`articleId` (number)");
  });

  it("should describe available tools when invoke subtool does not exist", async () => {
    const tool = createTestInvokeTool({
      tools: [
        new SendMessageTool({ agentMessageService: createAgentMessageService() }),
        new OpenIthomeArticleTool(),
      ],
    });

    const result = await tool.execute(
      {
        tool: "unknown_tool",
      },
      {
        rootAgentSession: {
          getState: () => ({
            focusedStateId: "ithome" as const,
            stateStack: ["portal", "ithome"] as const,
            waiting: null,
          }),
          getAvailableInvokeTools: () => ["open_ithome_article"],
          getCurrentApp: () => undefined,
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVOKE_TOOL_NOT_FOUND",
      availableTools: ["open_ithome_article"],
    });
    expect(JSON.parse(result.content).message).toContain("invoke 子工具 unknown_tool 不存在。");
    expect(JSON.parse(result.content).message).toContain("当前状态可用的 invoke 工具说明：");
    expect(JSON.parse(result.content).message).toContain("`open_ithome_article`");
  });

  it("should bypass state-tree availableTools check for App-owned tools", async () => {
    // 回归测试：之前 InvokeTool 把 App 工具也走状态树 availableTools 检查，
    // 导致 Kagami 进 calc 后调 calculate 被"Portal 没有 invoke 子工具"挡住。
    const { CalcApp } = await import("../../src/agent/apps/calc/calc.app.js");
    const appManager = new AppManager();
    appManager.register(new CalcApp());

    const calcTool = appManager.getApp("calc")!.tools[0];
    const tool = createTestInvokeTool({
      tools: [calcTool],
      appManager,
    });

    const result = await tool.execute({ tool: "calculate", a: 6, op: "*", b: 7 }, {
      rootAgentSession: {
        getState: () => ({
          focusedStateId: "portal" as const,
          stateStack: ["portal"] as const,
          waiting: null,
        }),
        // Portal 状态树视野下 availableTools 是空的
        getAvailableInvokeTools: () => [],
        // 但 Kagami 已经 enter 进了 calc App
        getCurrentApp: () => "calc",
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      result: 42,
    });
  });

  it("should reject App-owned tool with APP_GUARD when not in the owning App", async () => {
    const { CalcApp } = await import("../../src/agent/apps/calc/calc.app.js");
    const appManager = new AppManager();
    appManager.register(new CalcApp());

    const calcTool = appManager.getApp("calc")!.tools[0];
    const tool = createTestInvokeTool({
      tools: [calcTool],
      appManager,
    });

    const result = await tool.execute({ tool: "calculate", a: 1, op: "+", b: 1 }, {
      rootAgentSession: {
        getState: () => ({
          focusedStateId: "portal" as const,
          stateStack: ["portal"] as const,
          waiting: null,
        }),
        getAvailableInvokeTools: () => [],
        // 没在 calc 里
        getCurrentApp: () => undefined,
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVOKE_TOOL_APP_GUARD",
    });
  });
});
