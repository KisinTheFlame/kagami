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
    activeProvider: "openai",
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
    ...overrides,
  };
}

function createConfigManagerMock(
  llmRuntimeConfig: LlmRuntimeConfig = createLlmRuntimeConfig(),
): ConfigManager {
  return {
    getBootConfig: vi.fn(),
    getLlmRuntimeConfig: vi.fn().mockResolvedValue(llmRuntimeConfig),
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
          activeProvider: "deepseek",
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
});
