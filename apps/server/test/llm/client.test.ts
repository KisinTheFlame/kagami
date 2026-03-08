import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmChatCallDao } from "../../src/dao/llm-chat-call.dao.js";
import type { LlmProvider } from "../../src/llm/provider.js";

const ORIGINAL_ENV = { ...process.env };

function applyBaseEnv(): void {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "https://example.com/database";
  process.env.LLM_ACTIVE_PROVIDER = "openai";
  process.env.LLM_TIMEOUT_MS = "45000";
  process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
  process.env.OPENAI_CHAT_MODEL = "gpt-4o-mini";
  process.env.OPENAI_API_KEY = "openai-key";
  process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
  process.env.DEEPSEEK_CHAT_MODEL = "deepseek-chat";
  delete process.env.DEEPSEEK_API_KEY;
  process.env.NAPCAT_WS_URL = "https://example.com/ws";
  process.env.NAPCAT_WS_RECONNECT_MS = "1000";
  process.env.NAPCAT_WS_REQUEST_TIMEOUT_MS = "1000";
  process.env.NAPCAT_LISTEN_GROUP_ID = "10001";
  process.env.BOT_QQ = "10002";
  delete process.env.TAVILY_API_KEY;
}

function createLlmChatCallDaoMock(): LlmChatCallDao {
  return {
    countByQuery: vi.fn().mockResolvedValue(0),
    listPage: vi.fn().mockResolvedValue([]),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createLlmClient", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    applyBaseEnv();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("should list configured providers with the active provider first", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-key";
    vi.resetModules();

    const { createLlmClient } = await import("../../src/llm/client.js");

    const client = createLlmClient({
      llmChatCallDao: createLlmChatCallDaoMock(),
    });

    expect(client.listAvailableProviders()).toEqual([
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
      llmChatCallDao,
      providers: {
        openai: provider,
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
