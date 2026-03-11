import { describe, expect, it, vi } from "vitest";
import type { LlmUsageRuntimeConfig } from "../../src/config/config.manager.js";
import type { LlmChatCallDao } from "../../src/dao/llm-chat-call.dao.js";
import { createLlmClient, type LlmClient } from "../../src/llm/client.js";
import type { LlmProvider } from "../../src/llm/provider.js";
import type { LlmProviderId, LlmUsageId } from "../../src/llm/types.js";

function createLlmChatCallDaoMock(): LlmChatCallDao {
  return {
    countByQuery: vi.fn().mockResolvedValue(0),
    listPage: vi.fn().mockResolvedValue([]),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn().mockResolvedValue(undefined),
  };
}

function createUsageConfig(
  overrides: Partial<Record<LlmUsageId, LlmUsageRuntimeConfig>> = {},
): Record<LlmUsageId, LlmUsageRuntimeConfig> {
  return {
    agent: {
      attempts: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          times: 1,
        },
      ],
    },
    ragQueryPlanner: {
      attempts: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          times: 1,
        },
      ],
    },
    ...overrides,
  };
}

function createClient(params?: {
  llmChatCallDao?: LlmChatCallDao;
  providers?: Partial<Record<LlmProviderId, LlmProvider>>;
  usages?: Record<LlmUsageId, LlmUsageRuntimeConfig>;
}): { client: LlmClient; llmChatCallDao: LlmChatCallDao } {
  const llmChatCallDao = params?.llmChatCallDao ?? createLlmChatCallDaoMock();

  return {
    client: createLlmClient({
      llmChatCallDao,
      providers: params?.providers ?? {},
      usages: params?.usages ?? createUsageConfig(),
    }),
    llmChatCallDao,
  };
}

describe("createLlmClient", () => {
  it("should list configured providers with the active provider first", async () => {
    const { client } = createClient({
      providers: {
        deepseek: {
          id: "deepseek",
          chat: vi.fn(),
        },
        openai: {
          id: "openai",
          chat: vi.fn(),
        },
        "openai-codex": {
          id: "openai-codex",
          isAvailable: vi.fn().mockResolvedValue(false),
          chat: vi.fn(),
        },
      },
      usages: createUsageConfig({
        agent: {
          attempts: [
            {
              provider: "openai",
              model: "gpt-4o-mini",
              times: 1,
            },
          ],
        },
      }),
    });

    await expect(client.listAvailableProviders({ usage: "agent" })).resolves.toEqual([
      {
        id: "openai",
        isActive: true,
      },
      {
        id: "deepseek",
        isActive: false,
      },
    ]);
  });

  it("should skip persistence when recordCall is false in direct mode", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "pong",
          toolCalls: [],
        },
      }),
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        openai: provider,
      },
    });

    await client.chatDirect(
      {
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      },
      {
        providerId: "openai",
        model: "gpt-4o-mini",
        recordCall: false,
      },
    );

    expect(llmChatCallDao.recordSuccess).not.toHaveBeenCalled();
    expect(llmChatCallDao.recordError).not.toHaveBeenCalled();
  });

  it("should reject unavailable providers in direct mode", async () => {
    const { client } = createClient();

    await expect(
      client.chatDirect(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          providerId: "deepseek",
          model: "deepseek-chat",
        },
      ),
    ).rejects.toMatchObject({
      name: "LlmProviderUnavailableError",
      provider: "deepseek",
    });
  });

  it("should retry next usage attempt after an error and reuse requestId", async () => {
    const llmChatCallDao = createLlmChatCallDaoMock();
    const openaiProvider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockRejectedValue(new Error("openai failed")),
    };
    const deepseekProvider: LlmProvider = {
      id: "deepseek",
      chat: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-chat",
        message: {
          role: "assistant",
          content: "fallback pong",
          toolCalls: [],
        },
      }),
    };
    const { client } = createClient({
      llmChatCallDao,
      providers: {
        openai: openaiProvider,
        deepseek: deepseekProvider,
      },
      usages: createUsageConfig({
        agent: {
          attempts: [
            {
              provider: "openai",
              model: "gpt-4o-mini",
              times: 1,
            },
            {
              provider: "deepseek",
              model: "deepseek-chat",
              times: 1,
            },
          ],
        },
      }),
    });

    await expect(
      client.chat(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          usage: "agent",
        },
      ),
    ).resolves.toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
    });

    expect(openaiProvider.chat).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "ping" }],
      tools: [],
      toolChoice: "none",
      model: "gpt-4o-mini",
    });
    expect(deepseekProvider.chat).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "ping" }],
      tools: [],
      toolChoice: "none",
      model: "deepseek-chat",
    });
    expect(llmChatCallDao.recordError).toHaveBeenCalledTimes(1);
    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledTimes(1);

    const errorRequestId = vi.mocked(llmChatCallDao.recordError).mock.calls[0]?.[0].requestId;
    const successRequestId = vi.mocked(llmChatCallDao.recordSuccess).mock.calls[0]?.[0].requestId;
    expect(errorRequestId).toBe(successRequestId);
  });

  it("should continue after an unavailable usage attempt", async () => {
    const llmChatCallDao = createLlmChatCallDaoMock();
    const deepseekProvider: LlmProvider = {
      id: "deepseek",
      chat: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-chat",
        message: {
          role: "assistant",
          content: "pong",
          toolCalls: [],
        },
      }),
    };
    const { client } = createClient({
      llmChatCallDao,
      providers: {
        deepseek: deepseekProvider,
      },
      usages: createUsageConfig({
        agent: {
          attempts: [
            {
              provider: "openai",
              model: "gpt-4o-mini",
              times: 1,
            },
            {
              provider: "deepseek",
              model: "deepseek-chat",
              times: 1,
            },
          ],
        },
      }),
    });

    await expect(
      client.chat(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          usage: "agent",
        },
      ),
    ).resolves.toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
    });

    expect(llmChatCallDao.recordError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llmChatCallDao.recordError).mock.calls[0]?.[0]).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("should throw the last error when all usage attempts fail", async () => {
    const llmChatCallDao = createLlmChatCallDaoMock();
    const firstError = new Error("openai failed");
    const lastError = new Error("deepseek failed");
    const { client } = createClient({
      llmChatCallDao,
      providers: {
        openai: {
          id: "openai",
          chat: vi.fn().mockRejectedValue(firstError),
        },
        deepseek: {
          id: "deepseek",
          chat: vi.fn().mockRejectedValue(lastError),
        },
      },
      usages: createUsageConfig({
        agent: {
          attempts: [
            {
              provider: "openai",
              model: "gpt-4o-mini",
              times: 1,
            },
            {
              provider: "deepseek",
              model: "deepseek-chat",
              times: 1,
            },
          ],
        },
      }),
    });

    await expect(
      client.chat(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          usage: "agent",
        },
      ),
    ).rejects.toBe(lastError);

    expect(llmChatCallDao.recordError).toHaveBeenCalledTimes(2);
    expect(llmChatCallDao.recordSuccess).not.toHaveBeenCalled();
  });

  it("should retry the same usage attempt for the configured times before fallback", async () => {
    const llmChatCallDao = createLlmChatCallDaoMock();
    const openaiProvider: LlmProvider = {
      id: "openai",
      chat: vi
        .fn()
        .mockRejectedValueOnce(new Error("openai failed #1"))
        .mockRejectedValueOnce(new Error("openai failed #2")),
    };
    const deepseekProvider: LlmProvider = {
      id: "deepseek",
      chat: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-chat",
        message: {
          role: "assistant",
          content: "fallback pong",
          toolCalls: [],
        },
      }),
    };
    const { client } = createClient({
      llmChatCallDao,
      providers: {
        openai: openaiProvider,
        deepseek: deepseekProvider,
      },
      usages: createUsageConfig({
        agent: {
          attempts: [
            {
              provider: "openai",
              model: "gpt-4o-mini",
              times: 2,
            },
            {
              provider: "deepseek",
              model: "deepseek-chat",
              times: 1,
            },
          ],
        },
      }),
    });

    await expect(
      client.chat(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          usage: "agent",
        },
      ),
    ).resolves.toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
    });

    expect(openaiProvider.chat).toHaveBeenCalledTimes(2);
    expect(deepseekProvider.chat).toHaveBeenCalledTimes(1);
    expect(llmChatCallDao.recordError).toHaveBeenCalledTimes(2);
    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("should require explicit usage for chat", async () => {
    const { client } = createClient();

    await expect(
      client.chat(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {} as never,
      ),
    ).rejects.toThrow("require an explicit usage");
  });

  it("should require explicit model for direct chat", async () => {
    const { client } = createClient({
      providers: {
        openai: {
          id: "openai",
          chat: vi.fn(),
        },
      },
    });

    await expect(
      client.chatDirect(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          providerId: "openai",
          model: "",
        },
      ),
    ).rejects.toThrow("requires model");
  });

  it("should require explicit usage for listAvailableProviders", async () => {
    const { client } = createClient();

    await expect(client.listAvailableProviders({} as never)).rejects.toThrow("explicit usage");
  });
});
