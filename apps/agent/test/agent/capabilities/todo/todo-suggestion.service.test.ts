import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@kagami/llm-client";
import { BizError } from "@kagami/kernel/errors/biz-error";
import {
  PROPOSE_TODOS_TOOL_NAME,
  TodoSuggestionService,
} from "../../../../src/agent/capabilities/todo/application/todo-suggestion.service.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

initTestLoggerRuntime();

function makeLlmClient(chat: ReturnType<typeof vi.fn>): {
  llmClient: LlmClient;
  chat: ReturnType<typeof vi.fn>;
} {
  const llmClient: LlmClient = {
    chat,
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn().mockResolvedValue([]),
  } as unknown as LlmClient;
  return { llmClient, chat };
}

function successResponse(args: unknown, toolName = PROPOSE_TODOS_TOOL_NAME): unknown {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "propose-1", name: toolName, arguments: args }],
    },
  };
}

function chatReturning(
  args: unknown,
  toolName = PROPOSE_TODOS_TOOL_NAME,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(successResponse(args, toolName));
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
  it("正常解析：读 propose_todos 的 suggestions 参数", async () => {
    const { llmClient, chat } = makeLlmClient(
      chatReturning({ suggestions: ["写周报", "回复闻震"] }),
    );
    const service = new TodoSuggestionService({ llmClient });
    const result = await service.propose(input);
    expect(result).toEqual(["写周报", "回复闻震"]);
    // 强制 propose_todos、tools 只挂这一个（异于主工具集）
    const [request, options] = chat.mock.calls[0];
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0].name).toBe(PROPOSE_TODOS_TOOL_NAME);
    expect(request.toolChoice).toEqual({ tool_name: PROPOSE_TODOS_TOOL_NAME });
    expect(options).toEqual({ usage: "todoSuggestionAgent" });
  });

  it("超过 5 条：截断到 5，并去空白项", async () => {
    const { llmClient } = makeLlmClient(
      chatReturning({ suggestions: ["a", "b", "c", "d", "e", "f", "g", "   "] }),
    );
    const service = new TodoSuggestionService({ llmClient });
    const result = await service.propose(input);
    expect(result).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("无 toolCall → []", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: { role: "assistant", content: "自由文本", toolCalls: [] },
    });
    const { llmClient } = makeLlmClient(chat);
    const service = new TodoSuggestionService({ llmClient });
    expect(await service.propose(input)).toEqual([]);
  });

  it("tool name 不符 → []", async () => {
    const { llmClient } = makeLlmClient(chatReturning({ suggestions: ["x"] }, "other_tool"));
    const service = new TodoSuggestionService({ llmClient });
    expect(await service.propose(input)).toEqual([]);
  });

  it("参数解析失败（suggestions 非数组）→ []", async () => {
    const { llmClient } = makeLlmClient(chatReturning({ suggestions: "not-an-array" }));
    const service = new TodoSuggestionService({ llmClient });
    expect(await service.propose(input)).toEqual([]);
  });

  it("chat 抛错 → []（digest 降级，不 rethrow）", async () => {
    const { llmClient } = makeLlmClient(vi.fn().mockRejectedValue(new Error("boom")));
    const service = new TodoSuggestionService({ llmClient });
    await expect(service.propose(input)).resolves.toEqual([]);
  });

  it("suggestions 缺省（模型只调工具没给参数）→ []", async () => {
    const { llmClient } = makeLlmClient(chatReturning({}));
    const service = new TodoSuggestionService({ llmClient });
    expect(await service.propose(input)).toEqual([]);
  });

  it("可重试失败后重试成功：先抖动一次，第二次拿到结果", async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(retryableFailure())
      .mockResolvedValueOnce(successResponse({ suggestions: ["写周报"] }));
    const { llmClient } = makeLlmClient(chat);
    immediateSleep.mockClear();
    const service = new TodoSuggestionService({ llmClient, sleep: immediateSleep });
    expect(await service.propose(input)).toEqual(["写周报"]);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(immediateSleep).toHaveBeenCalledTimes(1);
  });

  it("可重试失败耗尽尝试次数 → []（试满 maxAttempts 次）", async () => {
    const chat = vi.fn().mockRejectedValue(retryableFailure());
    const { llmClient } = makeLlmClient(chat);
    immediateSleep.mockClear();
    const service = new TodoSuggestionService({
      llmClient,
      maxAttempts: 3,
      sleep: immediateSleep,
    });
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(3);
    // 最后一次不再退避
    expect(immediateSleep).toHaveBeenCalledTimes(2);
  });

  it("不可重试异常不重试：只调一次即降级", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("boom"));
    const { llmClient } = makeLlmClient(chat);
    immediateSleep.mockClear();
    const service = new TodoSuggestionService({ llmClient, sleep: immediateSleep });
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(immediateSleep).not.toHaveBeenCalled();
  });

  it("maxAttempts 传 Infinity/0 被归一化：不会死循环，也不会跳过首轮调用", async () => {
    const chatInfinity = vi.fn().mockRejectedValue(retryableFailure());
    immediateSleep.mockClear();
    const serviceInfinity = new TodoSuggestionService({
      llmClient: makeLlmClient(chatInfinity).llmClient,
      maxAttempts: Infinity,
      sleep: immediateSleep,
    });
    expect(await serviceInfinity.propose(input)).toEqual([]);
    // Infinity 非法 → 回落默认 2 次
    expect(chatInfinity).toHaveBeenCalledTimes(2);

    const chatZero = chatReturning({ suggestions: ["写周报"] });
    const serviceZero = new TodoSuggestionService({
      llmClient: makeLlmClient(chatZero).llmClient,
      maxAttempts: 0,
      sleep: immediateSleep,
    });
    // 0 被抬到 1：首轮照常调用
    expect(await serviceZero.propose(input)).toEqual(["写周报"]);
    expect(chatZero).toHaveBeenCalledTimes(1);
  });

  it("畸形响应（无 toolCall）不重试：调用成功但内容不合规，直接降级", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: { role: "assistant", content: "自由文本", toolCalls: [] },
    });
    const { llmClient } = makeLlmClient(chat);
    immediateSleep.mockClear();
    const service = new TodoSuggestionService({ llmClient, sleep: immediateSleep });
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(immediateSleep).not.toHaveBeenCalled();
  });
});
