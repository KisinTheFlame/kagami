import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@kagami/llm-client";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { createUnguardedSubtoolOwner, ToolCatalog } from "@kagami/agent-runtime";
import {
  InvokeTool,
  INVOKE_TOOL_NAME,
} from "../../../../src/agent/runtime/root-agent/tools/invoke.tool.js";
import { TodoSuggestionService } from "../../../../src/agent/capabilities/todo/application/todo-suggestion.service.js";
import { TodoSuggestionTaskAgent } from "../../../../src/agent/capabilities/todo/task-agent/todo-suggestion-task-agent.js";
import {
  PROPOSE_TODOS_TOOL_NAME,
  ProposeTodosTool,
} from "../../../../src/agent/capabilities/todo/task-agent/tools/propose-todos.tool.js";
import { createTodoSuggestionInstructionMessage } from "../../../../src/agent/runtime/context/context-message-factory.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

initTestLoggerRuntime();

/** TodoSuggestionTaskAgent 的 maxRounds；跑满仍未 propose 即降级。 */
const TASK_AGENT_MAX_ROUNDS = 4;

function makeLlmClient(chat: ReturnType<typeof vi.fn>): LlmClient {
  return {
    chat,
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn().mockResolvedValue([]),
  } as unknown as LlmClient;
}

/**
 * 与真实工厂同构的最小装配：taskTools 只放 invokeTool（owner 只挂 propose_todos），
 * 聚焦 invoke 调度 + 终止判定 + 服务层重试/降级语义。OutOfScope wrapper 是另一类
 * 测试的话题。
 */
function makeService(
  chat: ReturnType<typeof vi.fn>,
  extra: {
    maxAttempts?: number;
    retryBackoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): TodoSuggestionService {
  const invokeTool = new InvokeTool({
    owners: [createUnguardedSubtoolOwner({ tools: [new ProposeTodosTool()] })],
  });
  const taskAgent = new TodoSuggestionTaskAgent({
    llmClient: makeLlmClient(chat),
    taskTools: new ToolCatalog([invokeTool]).pick([INVOKE_TOOL_NAME]),
  });
  return new TodoSuggestionService({ taskAgent, ...extra });
}

/**
 * 模型经 invoke 提交：顶层 toolCall 是 invoke，其 arguments 里带 tool="propose_todos"
 * 和业务字段。subtool 可覆盖，模拟「invoke 了但子工具名不对」的畸形。
 */
function successResponse(
  args: Record<string, unknown>,
  { subtool = PROPOSE_TODOS_TOOL_NAME }: { subtool?: string } = {},
): unknown {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "invoke-1", name: INVOKE_TOOL_NAME, arguments: { tool: subtool, ...args } },
      ],
    },
  };
}

function chatReturning(
  args: Record<string, unknown>,
  overrides?: { subtool?: string },
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(successResponse(args, overrides));
}

/** isRetryableLlmFailure 只认这两条 message，模拟一次可重试的上游抖动。 */
function retryableFailure(): BizError {
  return new BizError({ message: "LLM 上游服务调用失败" });
}

/** 注入即时 sleep，避免测试真的等退避。 */
const immediateSleep = vi.fn(async () => {});

const input = {
  systemPrompt: "sys",
  messages: [{ role: "user" as const, content: "hi" }],
  openTodos: [{ title: "已有事项" }],
};

describe("TodoSuggestionService.propose", () => {
  it("正常解析：invoke(tool=propose_todos) 真 dispatch，返回归一化后的 suggestions", async () => {
    const chat = chatReturning({ suggestions: ["写周报", "回复闻震"] });
    const service = makeService(chat);
    const result = await service.propose(input);
    expect(result).toEqual(["写周报", "回复闻震"]);
    // toolChoice 与主循环一致（kernel 统一 "auto"），指令消息追加在消息尾部。
    const [request, options] = chat.mock.calls[0];
    expect(request.toolChoice).toBe("auto");
    expect(request.system).toBe("sys");
    expect(request.messages).toEqual([
      { role: "user", content: "hi" },
      createTodoSuggestionInstructionMessage(input.openTodos),
    ]);
    expect(options).toEqual({ usage: "todoSuggestionAgent" });
  });

  it("超过 5 条：截断到 5，并去空白项", async () => {
    const service = makeService(
      chatReturning({ suggestions: ["a", "b", "c", "d", "e", "f", "   "] }),
    );
    expect(await service.propose(input)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("suggestions 缺省（模型只 invoke 没给 suggestions）→ []（合法空提交，单轮终止）", async () => {
    const chat = chatReturning({});
    const service = makeService(chat);
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("纯文本轮（零 toolCall）：循环跑满 maxRounds 后降级为 []，且不重试", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: { role: "assistant", content: "自由文本", toolCalls: [] },
    });
    immediateSleep.mockClear();
    const service = makeService(chat, { sleep: immediateSleep });
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(TASK_AGENT_MAX_ROUNDS);
    expect(immediateSleep).not.toHaveBeenCalled();
  });

  it("invoke 了但子工具名不对：每轮 NOT_FOUND，跑满 maxRounds 后降级为 []", async () => {
    const chat = chatReturning({ suggestions: ["x"] }, { subtool: "something_else" });
    const service = makeService(chat);
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(TASK_AGENT_MAX_ROUNDS);
  });

  it("参数解析失败（suggestions 非数组）：不终止，跑满 maxRounds 后降级为 []", async () => {
    const service = makeService(chatReturning({ suggestions: "not-an-array" }));
    expect(await service.propose(input)).toEqual([]);
  });

  it("chat 抛不可重试错 → []（digest 降级，不 rethrow，只调一次）", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("boom"));
    immediateSleep.mockClear();
    const service = makeService(chat, { sleep: immediateSleep });
    await expect(service.propose(input)).resolves.toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(immediateSleep).not.toHaveBeenCalled();
  });

  it("可重试失败后重试成功：先抖动一次，第二次拿到结果", async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(retryableFailure())
      .mockResolvedValueOnce(successResponse({ suggestions: ["写周报"] }));
    immediateSleep.mockClear();
    const service = makeService(chat, { sleep: immediateSleep });
    expect(await service.propose(input)).toEqual(["写周报"]);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(immediateSleep).toHaveBeenCalledTimes(1);
  });

  it("可重试失败耗尽尝试次数 → []（试满 maxAttempts 次）", async () => {
    const chat = vi.fn().mockRejectedValue(retryableFailure());
    immediateSleep.mockClear();
    const service = makeService(chat, { maxAttempts: 3, sleep: immediateSleep });
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(3);
    // 最后一次不再退避
    expect(immediateSleep).toHaveBeenCalledTimes(2);
  });

  it("maxAttempts 传 Infinity/0 被归一化：不会死循环，也不会跳过首轮调用", async () => {
    const chatInfinity = vi.fn().mockRejectedValue(retryableFailure());
    immediateSleep.mockClear();
    const serviceInfinity = makeService(chatInfinity, {
      maxAttempts: Infinity,
      sleep: immediateSleep,
    });
    expect(await serviceInfinity.propose(input)).toEqual([]);
    // Infinity 非法 → 回落默认 2 次
    expect(chatInfinity).toHaveBeenCalledTimes(2);

    const chatZero = chatReturning({ suggestions: ["写周报"] });
    const serviceZero = makeService(chatZero, { maxAttempts: 0, sleep: immediateSleep });
    // 0 被抬到 1：首轮照常调用
    expect(await serviceZero.propose(input)).toEqual(["写周报"]);
    expect(chatZero).toHaveBeenCalledTimes(1);
  });
});
