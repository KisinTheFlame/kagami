import { describe, expect, it, vi } from "vitest";
import type { ConfigManager, LlmRuntimeConfig } from "../../src/config/config.manager.js";
import type { LlmChatCallDao } from "../../src/dao/llm-chat-call.dao.js";
import type { LlmProvider } from "../../src/llm/provider.js";

function createLlmChatCallDaoMock(): LlmChatCallDao {
  return {
    countByQuery: vi.fn().mockResolvedValue(0),
    listPage: vi.fn().mockResolvedValue([]),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn().mockResolvedValue(undefined),
  };
}

function createLlmRuntimeConfig(overrides: Partial<LlmRuntimeConfig> = {}): LlmRuntimeConfig {
  return {
    timeoutMs: 45_000,
    deepseek: {
      apiKey: undefined,
      baseUrl: "https://api.deepseek.com",
      chatModel: "deepseek-chat",
      timeoutMs: 45_000,
    },
    openai: {
      apiKey: "openai-key",
      baseUrl: "https://api.openai.com/v1",
      chatModel: "gpt-4o-mini",
      timeoutMs: 45_000,
    },
    openaiCodex: {
      authFilePath: "/tmp/kagami-missing-codex-auth.json",
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      chatModel: "gpt-5.3-codex",
      refreshLeewayMs: 60_000,
      timeoutMs: 45_000,
    },
    usages: {
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
    },
    ...overrides,
  };
}

function createConfigManagerMock(
  llmRuntimeConfig: LlmRuntimeConfig = createLlmRuntimeConfig(),
): ConfigManager {
  return {
    getBootConfig: vi.fn(),
    getLlmRuntimeConfig: vi.fn().mockResolvedValue(llmRuntimeConfig),
    getRagRuntimeConfig: vi.fn(),
    getTavilyConfig: vi.fn(),
    getBotProfileConfig: vi.fn(),
  };
}

describe("createLlmClient", () => {
  it("should list configured providers with the active provider first", async () => {
    const { createLlmClient } = await import("../../src/llm/client.js");
    const configManager = createConfigManagerMock(
      createLlmRuntimeConfig({
        deepseek: {
          apiKey: "deepseek-key",
          baseUrl: "https://api.deepseek.com",
          chatModel: "deepseek-chat",
          timeoutMs: 45_000,
        },
      }),
    );

    const client = createLlmClient({
      configManager,
      llmChatCallDao: createLlmChatCallDaoMock(),
      providers: {
        "openai-codex": {
          id: "openai-codex",
          isAvailable: vi.fn().mockResolvedValue(false),
          chat: vi.fn(),
        },
      },
    });

    await expect(client.listAvailableProviders()).resolves.toEqual([
      {
        id: "openai",
        defaultModel: "gpt-4o-mini",
        isActive: true,
      },
      {
        id: "deepseek",
        defaultModel: "deepseek-chat",
        isActive: false,
      },
    ]);
  });

  it("should skip persistence when recordCall is false", async () => {
    const { createLlmClient } = await import("../../src/llm/client.js");
    const llmChatCallDao = createLlmChatCallDaoMock();
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

    const client = createLlmClient({
      configManager: createConfigManagerMock(),
      llmChatCallDao,
      providers: {
        openai: provider,
        "openai-codex": {
          id: "openai-codex",
          isAvailable: vi.fn().mockResolvedValue(false),
          chat: vi.fn(),
        },
      },
    });

    await client.chat(
      {
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      },
      {
        providerId: "openai",
        recordCall: false,
      },
    );

    expect(llmChatCallDao.recordSuccess).not.toHaveBeenCalled();
    expect(llmChatCallDao.recordError).not.toHaveBeenCalled();
  });

  it("should reject unavailable providers", async () => {
    const { createLlmClient } = await import("../../src/llm/client.js");

    const client = createLlmClient({
      configManager: createConfigManagerMock(
        createLlmRuntimeConfig({
          usages: {
            agent: {
              attempts: [
                {
                  provider: "deepseek",
                  model: "deepseek-chat",
                  times: 1,
                },
              ],
            },
            ragQueryPlanner: {
              attempts: [
                {
                  provider: "deepseek",
                  model: "deepseek-chat",
                  times: 1,
                },
              ],
            },
          },
          openai: {
            apiKey: undefined,
            baseUrl: "https://api.openai.com/v1",
            chatModel: "gpt-4o-mini",
            timeoutMs: 45_000,
          },
        }),
      ),
      llmChatCallDao: createLlmChatCallDaoMock(),
      providers: {},
    });

    await expect(
      client.chat(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          providerId: "deepseek",
        },
      ),
    ).rejects.toMatchObject({
      name: "LlmProviderUnavailableError",
      provider: "deepseek",
    });
  });

  it("should retry next usage attempt after an error and reuse requestId", async () => {
    const { createLlmClient } = await import("../../src/llm/client.js");
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

    const client = createLlmClient({
      configManager: createConfigManagerMock(
        createLlmRuntimeConfig({
          deepseek: {
            apiKey: "deepseek-key",
            baseUrl: "https://api.deepseek.com",
            chatModel: "deepseek-chat",
            timeoutMs: 45_000,
          },
          usages: {
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
            ragQueryPlanner: {
              attempts: [
                {
                  provider: "openai",
                  model: "gpt-4o-mini",
                  times: 1,
                },
              ],
            },
          },
        }),
      ),
      llmChatCallDao,
      providers: {
        openai: openaiProvider,
        deepseek: deepseekProvider,
        "openai-codex": {
          id: "openai-codex",
          isAvailable: vi.fn().mockResolvedValue(false),
          chat: vi.fn(),
        },
      },
    });

    await expect(
      client.chat({
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
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
    const { createLlmClient } = await import("../../src/llm/client.js");
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

    const client = createLlmClient({
      configManager: createConfigManagerMock(
        createLlmRuntimeConfig({
          deepseek: {
            apiKey: "deepseek-key",
            baseUrl: "https://api.deepseek.com",
            chatModel: "deepseek-chat",
            timeoutMs: 45_000,
          },
          usages: {
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
            ragQueryPlanner: {
              attempts: [
                {
                  provider: "openai",
                  model: "gpt-4o-mini",
                  times: 1,
                },
              ],
            },
          },
          openai: {
            apiKey: undefined,
            baseUrl: "https://api.openai.com/v1",
            chatModel: "gpt-4o-mini",
            timeoutMs: 45_000,
          },
        }),
      ),
      llmChatCallDao,
      providers: {
        deepseek: deepseekProvider,
        "openai-codex": {
          id: "openai-codex",
          isAvailable: vi.fn().mockResolvedValue(false),
          chat: vi.fn(),
        },
      },
    });

    await expect(
      client.chat({
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
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
    const { createLlmClient } = await import("../../src/llm/client.js");
    const llmChatCallDao = createLlmChatCallDaoMock();
    const firstError = new Error("openai failed");
    const lastError = new Error("deepseek failed");

    const client = createLlmClient({
      configManager: createConfigManagerMock(
        createLlmRuntimeConfig({
          deepseek: {
            apiKey: "deepseek-key",
            baseUrl: "https://api.deepseek.com",
            chatModel: "deepseek-chat",
            timeoutMs: 45_000,
          },
          usages: {
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
            ragQueryPlanner: {
              attempts: [
                {
                  provider: "openai",
                  model: "gpt-4o-mini",
                  times: 1,
                },
              ],
            },
          },
        }),
      ),
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
        "openai-codex": {
          id: "openai-codex",
          isAvailable: vi.fn().mockResolvedValue(false),
          chat: vi.fn(),
        },
      },
    });

    await expect(
      client.chat({
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
    ).rejects.toBe(lastError);

    expect(llmChatCallDao.recordError).toHaveBeenCalledTimes(2);
    expect(llmChatCallDao.recordSuccess).not.toHaveBeenCalled();
  });

  it("should retry the same usage attempt for the configured times before fallback", async () => {
    const { createLlmClient } = await import("../../src/llm/client.js");
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

    const client = createLlmClient({
      configManager: createConfigManagerMock(
        createLlmRuntimeConfig({
          deepseek: {
            apiKey: "deepseek-key",
            baseUrl: "https://api.deepseek.com",
            chatModel: "deepseek-chat",
            timeoutMs: 45_000,
          },
          usages: {
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
            ragQueryPlanner: {
              attempts: [
                {
                  provider: "openai",
                  model: "gpt-4o-mini",
                  times: 1,
                },
              ],
            },
          },
        }),
      ),
      llmChatCallDao,
      providers: {
        openai: openaiProvider,
        deepseek: deepseekProvider,
        "openai-codex": {
          id: "openai-codex",
          isAvailable: vi.fn().mockResolvedValue(false),
          chat: vi.fn(),
        },
      },
    });

    await expect(
      client.chat({
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
    });

    expect(openaiProvider.chat).toHaveBeenCalledTimes(2);
    expect(deepseekProvider.chat).toHaveBeenCalledTimes(1);
    expect(llmChatCallDao.recordError).toHaveBeenCalledTimes(2);
    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledTimes(1);
  });
});
