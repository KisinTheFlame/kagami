import {
  AppManager,
  createAppSubtoolOwner,
  type ToolComponent,
  type ToolContext,
} from "@kagami/agent-runtime";
import { describe, expect, it, vi } from "vitest";
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
 *   - appOwner：从传入的 AppManager 摊平所有 App tools
 *   - stateTreeOwner：显式接收状态树工具列表，依赖 ctx 里挂的 mock session 的
 *     getAvailableInvokeTools 做 gate
 *
 * App 工具放到 appManager 里；状态树工具走 stateTreeTools。
 */
function createTestInvokeTool(opts: {
  stateTreeTools?: ToolComponent[];
  appManager?: AppManager;
}): InvokeTool {
  const appManager = opts.appManager ?? new AppManager();
  const stateTreeTools = opts.stateTreeTools ?? [];
  return new InvokeTool({
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
        tools: stateTreeTools,
      }),
    ],
  });
}

describe("invoke tool", () => {
  it("should expose minimal invoke parameters that do not depend on subtool list", () => {
    // 暴露给 LLM 的 schema 只声明 tool 字段，子工具参数走 additionalProperties。
    // 这条不变量保住主 Agent 顶层 tools 数组的 KV cache 稳定性——加 / 删 / 改子工具
    // 不会让这一份 schema 漂移。
    const tool = createTestInvokeTool({
      stateTreeTools: [
        new SendMessageTool({
          agentMessageService: createAgentMessageService(),
        }),
      ],
    });

    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        tool: {
          type: "string",
          description: "要调用的子工具名。",
        },
      },
      additionalProperties: true,
    });
  });

  it("should invoke send_message in qq group state", async () => {
    const agentMessageService = createAgentMessageService();
    agentMessageService.sendGroupMessage.mockResolvedValue({ messageId: 9527 });
    const tool = createTestInvokeTool({
      stateTreeTools: [new SendMessageTool({ agentMessageService })],
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
      stateTreeTools: [new SendMessageTool({ agentMessageService })],
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

  it("should describe available tools when invoke subtool does not exist", async () => {
    const tool = createTestInvokeTool({
      stateTreeTools: [new SendMessageTool({ agentMessageService: createAgentMessageService() })],
    });

    const result = await tool.execute(
      {
        tool: "unknown_tool",
      },
      {
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

    // NOT_FOUND 回带的可用清单按 owner.canInvokeNow 过滤成"当前真正可调"的子集。
    // 这里 send_message 在当前状态可调，所以仍会出现在清单里。
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVOKE_TOOL_NOT_FOUND",
      availableTools: ["send_message"],
    });
    expect(JSON.parse(result.content).message).toContain("invoke 子工具 unknown_tool 不存在。");
    expect(JSON.parse(result.content).message).toContain("当前可用的 invoke 工具说明：");
    expect(JSON.parse(result.content).message).toContain("`send_message`");
  });

  it("should bypass state-tree availableTools check for App-owned tools", async () => {
    // 回归测试：之前 InvokeTool 把 App 工具也走状态树 availableTools 检查，
    // 导致 Kagami 进 calc 后调 calculate 被"Portal 没有 invoke 子工具"挡住。
    const { CalcApp } = await import("../../src/agent/apps/calc/calc.app.js");
    const appManager = new AppManager();
    appManager.register(new CalcApp());

    const tool = createTestInvokeTool({
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

  it("should treat App-owned tool as NOT_FOUND when not in the owning App", async () => {
    // 「子工具存在但当前不允许调用」与「子工具不存在」合并：没进 calc 时调
    // calculate，统一按 NOT_FOUND 返回，且该工具不会出现在可用清单里。
    const { CalcApp } = await import("../../src/agent/apps/calc/calc.app.js");
    const appManager = new AppManager();
    appManager.register(new CalcApp());

    const tool = createTestInvokeTool({
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

    const parsed = JSON.parse(result.content);
    expect(parsed).toMatchObject({
      ok: false,
      error: "INVOKE_TOOL_NOT_FOUND",
      tool: "calculate",
      availableTools: [],
    });
    expect(parsed.message).toContain("invoke 子工具 calculate 不存在。");
  });
});
