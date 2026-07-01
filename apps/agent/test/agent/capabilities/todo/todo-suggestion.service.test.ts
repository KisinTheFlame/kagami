import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../../../../src/llm/client.js";
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

function chatReturning(
  args: unknown,
  toolName = PROPOSE_TODOS_TOOL_NAME,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "propose-1", name: toolName, arguments: args }],
    },
  });
}

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
});
