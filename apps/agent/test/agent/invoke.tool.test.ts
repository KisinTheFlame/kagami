import {
  AppManager,
  createAppSubtoolOwner,
  type App,
  type ToolComponent,
  type ToolContext,
} from "@kagami/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import { SendMessageTool } from "../../src/agent/capabilities/messaging/tools/send-message.tool.js";
import { PendingDraftStore } from "../../src/agent/capabilities/messaging/application/pending-draft.store.js";
import type { NapcatChatTarget } from "../../src/napcat/application/napcat-gateway.service.js";
import { InvokeTool } from "../../src/agent/runtime/root-agent/tools/invoke.tool.js";

const TEST_QQ_APP_ID = "qq";

function createAgentMessageService() {
  return {
    sendGroupMessage: vi.fn(),
    sendPrivateMessage: vi.fn(),
    sendImage: vi.fn(),
  };
}

// AI 味门控不是本套件的关注点：以 enabled=false 构造，完全退化为原发送行为，
// 保证这些断言只校验 InvokeTool 的路由与发送语义。chatTarget 由 getChatTarget 注入
// （手机 OS 模型下来自 QqApp 当前会话），不再走 tool 执行上下文。
function createSendMessageTool(
  agentMessageService = createAgentMessageService(),
  getChatTarget: () => NapcatChatTarget | undefined = () => undefined,
) {
  return new SendMessageTool({
    agentMessageService,
    aiToneScorer: { proba: () => 0 } as unknown as ConstructorParameters<
      typeof SendMessageTool
    >[0]["aiToneScorer"],
    pendingDraftStore: new PendingDraftStore(),
    aiTone: { enabled: false, blockThreshold: 0.8 },
    getChatTarget,
  });
}

/** 最小测试 App：手机 OS 模型下 send_message 是 QQ App 的工具。 */
function createTestQqApp(tools: ToolComponent[]): App {
  return {
    id: TEST_QQ_APP_ID,
    displayName: "QQ",
    tools,
    canInvoke: () => true,
    help: async () => "",
  };
}

/**
 * 测试用 InvokeTool 工厂。手机 OS 模型下所有子工具都由 App 拥有，gate 走
 * createAppSubtoolOwner（按 ctx 里 mock session 的 getCurrentApp）。
 */
function createTestInvokeTool(opts: {
  appTools?: ToolComponent[];
  appManager?: AppManager;
}): InvokeTool {
  const appManager = opts.appManager ?? new AppManager();
  if (opts.appTools && opts.appTools.length > 0) {
    appManager.register(createTestQqApp(opts.appTools));
  }
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
    ],
  });
}

describe("invoke tool", () => {
  it("should expose minimal invoke parameters that do not depend on subtool list", () => {
    // 暴露给 LLM 的 schema 只声明 tool 字段，子工具参数走 additionalProperties。
    // 这条不变量保住主 Agent 顶层 tools 数组的 KV cache 稳定性——加 / 删 / 改子工具
    // 不会让这一份 schema 漂移。
    const tool = createTestInvokeTool({
      appTools: [createSendMessageTool()],
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

  it("should invoke send_message to the current group conversation", async () => {
    const agentMessageService = createAgentMessageService();
    agentMessageService.sendGroupMessage.mockResolvedValue({ messageId: 9527 });
    const tool = createTestInvokeTool({
      appTools: [
        createSendMessageTool(agentMessageService, () => ({
          chatType: "group",
          groupId: "group-1",
        })),
      ],
    });

    const result = await tool.execute(
      {
        tool: "send_message",
        message: "  hello group  ",
      },
      {
        rootAgentSession: {
          getCurrentApp: () => TEST_QQ_APP_ID,
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

  it("should invoke send_message to the current private conversation", async () => {
    const agentMessageService = createAgentMessageService();
    agentMessageService.sendPrivateMessage.mockResolvedValue({ messageId: 9630 });
    const tool = createTestInvokeTool({
      appTools: [
        createSendMessageTool(agentMessageService, () => ({
          chatType: "private",
          userId: "user-1",
        })),
      ],
    });

    const result = await tool.execute(
      {
        tool: "send_message",
        message: "  hello private  ",
      },
      {
        rootAgentSession: {
          getCurrentApp: () => TEST_QQ_APP_ID,
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
      appTools: [createSendMessageTool()],
    });

    const result = await tool.execute(
      {
        tool: "unknown_tool",
      },
      {
        rootAgentSession: {
          getCurrentApp: () => TEST_QQ_APP_ID,
        },
      } as Parameters<typeof tool.execute>[1],
    );

    // NOT_FOUND 回带的可用清单按 owner.canInvokeNow 过滤成"当前真正可调"的子集。
    // 当前在 QQ App 里，send_message 可调，所以仍会出现在清单里。
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
        // Kagami 已经 enter 进了 calc App
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
