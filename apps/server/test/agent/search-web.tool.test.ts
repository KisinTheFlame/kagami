import { describe, expect, it, vi } from "vitest";
import { AsyncTaskManager, type AsyncTaskCompletion } from "@kagami/agent-runtime";
import {
  createSearchWebTool,
  prepareSearchWeb,
} from "../../src/agent/capabilities/web-search/tools/search-web.tool.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";

/** 造一个会捕获第一个 onComplete 的 manager，配 deterministic task id。 */
function makeManager() {
  let resolveCompletion: (c: AsyncTaskCompletion) => void = () => {};
  const completion = new Promise<AsyncTaskCompletion>(resolve => {
    resolveCompletion = resolve;
  });
  let n = 0;
  const manager = new AsyncTaskManager({
    maxTaskDurationMs: 60_000,
    generateId: () => `task-${++n}`,
    onComplete: c => resolveCompletion(c),
  });
  return { manager, completion };
}

describe("search_web tool (async)", () => {
  it("立即返回占位，结果经 onComplete 回流；优先透传 runtime inline 消息", async () => {
    const webSearchAgent = {
      search: vi.fn().mockResolvedValue("这是给主 Agent 的摘要结果。"),
    };
    const { manager, completion } = makeManager();
    const tool = createSearchWebTool({
      webSearchTaskAgent: webSearchAgent,
      asyncTaskManager: manager,
    });
    const toolContext = {
      systemPrompt: "runtime-system-prompt",
      messages: [{ role: "user" as const, content: "这份消息应该优先透传" }],
    };

    const result = await tool.execute({ question: "  OpenAI latest news  " }, toolContext);

    expect(tool.name).toBe("search_web");
    expect(result.content).toBe('<async_task_submitted task_id="task-1" tool="search_web" />');

    const c = await completion;
    expect(webSearchAgent.search).toHaveBeenCalledWith({
      question: "OpenAI latest news",
      systemPrompt: "runtime-system-prompt",
      contextMessages: [{ role: "user", content: "这份消息应该优先透传" }],
    });
    expect(c).toMatchObject({
      taskId: "task-1",
      toolName: "search_web",
      outcome: { status: "success", content: "这是给主 Agent 的摘要结果。" },
    });
  });

  it("submit 不阻塞：即便子 Agent 永不返回，execute 也立即返回占位", async () => {
    const webSearchAgent = {
      search: vi.fn(() => new Promise<string>(() => {})), // 永不 resolve
    };
    const { manager } = makeManager();
    const tool = createSearchWebTool({
      webSearchTaskAgent: webSearchAgent,
      asyncTaskManager: manager,
    });
    const toolContext = {
      systemPrompt: "sp",
      messages: [{ role: "user" as const, content: "m" }],
    };

    const result = await tool.execute({ question: "OpenAI latest news" }, toolContext);

    expect(result.content).toContain("async_task_submitted");
  });

  it("空 question 在 execute 层被拒，不发起任务", async () => {
    const { manager } = makeManager();
    const webSearchAgent = { search: vi.fn() };
    const tool = createSearchWebTool({
      webSearchTaskAgent: webSearchAgent,
      asyncTaskManager: manager,
    });

    const result = await tool.execute({ question: "   " }, {});

    expect(webSearchAgent.search).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });

  it("prepareSearchWeb：无任何上下文（无 inline 也无 agentContext）同步 reject CONTEXT_UNAVAILABLE", () => {
    // 门控已移除（web 搜索不再要求活跃 QQ 会话）：唯一的同步 reject 路径是真正拿不到上下文。
    const webSearchAgent = { search: vi.fn() };
    const prep = prepareSearchWeb({ question: "OpenAI latest news" }, {}, webSearchAgent);

    expect(prep).toEqual({
      kind: "reject",
      content: JSON.stringify({ ok: false, error: "CONTEXT_UNAVAILABLE" }),
    });
    expect(webSearchAgent.search).not.toHaveBeenCalled();
  });

  it("无 inline 时在后台 await agentContext 快照兜底", async () => {
    const agentContext = new DefaultAgentContext({
      systemPromptFactory: () => "main-system-prompt",
    });
    await agentContext.appendMessages([{ role: "user", content: "fork 前的消息" }]);
    const webSearchAgent = {
      search: vi.fn(async input => JSON.stringify(input)),
    };
    const { manager, completion } = makeManager();
    const tool = createSearchWebTool({
      webSearchTaskAgent: webSearchAgent,
      asyncTaskManager: manager,
    });
    const toolContext = {
      agentContext,
      systemPrompt: undefined,
      messages: undefined,
    };

    const result = await tool.execute({ question: "OpenAI latest news" }, toolContext);
    expect(result.content).toContain("async_task_submitted");

    const c = await completion;
    expect(webSearchAgent.search).toHaveBeenCalledWith({
      question: "OpenAI latest news",
      systemPrompt: "main-system-prompt",
      contextMessages: [{ role: "user", content: "fork 前的消息" }],
    });
    expect(c.outcome).toMatchObject({ status: "success" });
  });
});
