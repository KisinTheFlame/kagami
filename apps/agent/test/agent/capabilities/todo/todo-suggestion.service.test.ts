import { describe, expect, it, vi } from "vitest";
import type { LlmClient, Tool } from "@kagami/llm-client";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { INVOKE_TOOL_NAME } from "../../../../src/agent/runtime/root-agent/tools/invoke.tool.js";
import {
  PROPOSE_TODOS_TOOL_NAME,
  TodoSuggestionService,
} from "../../../../src/agent/capabilities/todo/application/todo-suggestion.service.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

initTestLoggerRuntime();

// 与主 Agent 字节相等的顶层工具定义在真实运行时由 factory 注入；测试只需一份含 invoke 的
// 桩即可，服务本身不解读工具 schema，只把它原样传给 chat。
const TOP_LEVEL_TOOLS: Tool[] = [
  {
    name: INVOKE_TOOL_NAME,
    description: "invoke dispatcher",
    parameters: { type: "object", properties: { tool: { type: "string" } } },
  },
  {
    name: "switch",
    description: "switch app",
    parameters: { type: "object", properties: {} },
  },
];

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

function makeService(
  llmClient: LlmClient,
  extra: {
    maxAttempts?: number;
    retryBackoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): TodoSuggestionService {
  return new TodoSuggestionService({
    llmClient,
    topLevelToolDefinitions: TOP_LEVEL_TOOLS,
    ...extra,
  });
}

/**
 * 模型经 invoke 提交：顶层 toolCall 是 invoke，其 arguments 里带 tool="propose_todos" 和业务字段。
 * topName / subtool 可覆盖，模拟「没走 invoke」或「invoke 了但子工具名不对」两种畸形。
 */
function successResponse(
  args: Record<string, unknown>,
  {
    topName = INVOKE_TOOL_NAME,
    subtool = PROPOSE_TODOS_TOOL_NAME,
  }: { topName?: string; subtool?: string } = {},
): unknown {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "invoke-1", name: topName, arguments: { tool: subtool, ...args } }],
    },
  };
}

function chatReturning(
  args: Record<string, unknown>,
  overrides?: { topName?: string; subtool?: string },
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
  it("正常解析：从 invoke(tool=propose_todos) 的 arguments 取 suggestions", async () => {
    const { llmClient, chat } = makeLlmClient(
      chatReturning({ suggestions: ["写周报", "回复闻震"] }),
    );
    const service = makeService(llmClient);
    const result = await service.propose(input);
    expect(result).toEqual(["写周报", "回复闻震"]);
    // tools 与主 Agent 字节相等（原样传入），toolChoice 也与主循环一致（"required"），保 KV 前缀。
    const [request, options] = chat.mock.calls[0];
    expect(request.tools).toBe(TOP_LEVEL_TOOLS);
    expect(request.toolChoice).toBe("required");
    expect(options).toEqual({ usage: "todoSuggestionAgent" });
  });

  it("超过 5 条：截断到 5，并去空白项", async () => {
    const { llmClient } = makeLlmClient(
      chatReturning({ suggestions: ["a", "b", "c", "d", "e", "f", "g", "   "] }),
    );
    const service = makeService(llmClient);
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
    const service = makeService(llmClient);
    expect(await service.propose(input)).toEqual([]);
  });

  it("顶层没走 invoke（自由选到别的工具）→ []", async () => {
    const { llmClient } = makeLlmClient(
      chatReturning({ suggestions: ["x"] }, { topName: "switch" }),
    );
    const service = makeService(llmClient);
    expect(await service.propose(input)).toEqual([]);
  });

  it("invoke 了但子工具名不对 → []", async () => {
    const { llmClient } = makeLlmClient(
      chatReturning({ suggestions: ["x"] }, { subtool: "something_else" }),
    );
    const service = makeService(llmClient);
    expect(await service.propose(input)).toEqual([]);
  });

  it("并行多个 toolCall（invoke 不在首位）：按名字找到 invoke，不假设 [0]", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-1", name: "switch", arguments: { tool: "qq" } },
          {
            id: "call-2",
            name: INVOKE_TOOL_NAME,
            arguments: { tool: PROPOSE_TODOS_TOOL_NAME, suggestions: ["写周报"] },
          },
        ],
      },
    });
    const { llmClient } = makeLlmClient(chat);
    const service = makeService(llmClient);
    expect(await service.propose(input)).toEqual(["写周报"]);
  });

  it("参数解析失败（suggestions 非数组）→ []", async () => {
    const { llmClient } = makeLlmClient(chatReturning({ suggestions: "not-an-array" }));
    const service = makeService(llmClient);
    expect(await service.propose(input)).toEqual([]);
  });

  it("chat 抛错 → []（digest 降级，不 rethrow）", async () => {
    const { llmClient } = makeLlmClient(vi.fn().mockRejectedValue(new Error("boom")));
    const service = makeService(llmClient);
    await expect(service.propose(input)).resolves.toEqual([]);
  });

  it("suggestions 缺省（模型只 invoke 没给 suggestions）→ []", async () => {
    const { llmClient } = makeLlmClient(chatReturning({}));
    const service = makeService(llmClient);
    expect(await service.propose(input)).toEqual([]);
  });

  it("可重试失败后重试成功：先抖动一次，第二次拿到结果", async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(retryableFailure())
      .mockResolvedValueOnce(successResponse({ suggestions: ["写周报"] }));
    const { llmClient } = makeLlmClient(chat);
    immediateSleep.mockClear();
    const service = makeService(llmClient, { sleep: immediateSleep });
    expect(await service.propose(input)).toEqual(["写周报"]);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(immediateSleep).toHaveBeenCalledTimes(1);
  });

  it("可重试失败耗尽尝试次数 → []（试满 maxAttempts 次）", async () => {
    const chat = vi.fn().mockRejectedValue(retryableFailure());
    const { llmClient } = makeLlmClient(chat);
    immediateSleep.mockClear();
    const service = makeService(llmClient, { maxAttempts: 3, sleep: immediateSleep });
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(3);
    // 最后一次不再退避
    expect(immediateSleep).toHaveBeenCalledTimes(2);
  });

  it("不可重试异常不重试：只调一次即降级", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("boom"));
    const { llmClient } = makeLlmClient(chat);
    immediateSleep.mockClear();
    const service = makeService(llmClient, { sleep: immediateSleep });
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(immediateSleep).not.toHaveBeenCalled();
  });

  it("maxAttempts 传 Infinity/0 被归一化：不会死循环，也不会跳过首轮调用", async () => {
    const chatInfinity = vi.fn().mockRejectedValue(retryableFailure());
    immediateSleep.mockClear();
    const serviceInfinity = makeService(makeLlmClient(chatInfinity).llmClient, {
      maxAttempts: Infinity,
      sleep: immediateSleep,
    });
    expect(await serviceInfinity.propose(input)).toEqual([]);
    // Infinity 非法 → 回落默认 2 次
    expect(chatInfinity).toHaveBeenCalledTimes(2);

    const chatZero = chatReturning({ suggestions: ["写周报"] });
    const serviceZero = makeService(makeLlmClient(chatZero).llmClient, {
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
    const service = makeService(llmClient, { sleep: immediateSleep });
    expect(await service.propose(input)).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(immediateSleep).not.toHaveBeenCalled();
  });
});
