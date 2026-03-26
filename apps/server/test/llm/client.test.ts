import { describe, expect, it, vi } from "vitest";
import type {
  LlmProviderRuntimeConfig,
  LlmUsageRuntimeConfig,
  OpenAiCodexRuntimeConfig,
} from "../../src/config/config.manager.js";
import type { LlmChatCallDao } from "../../src/dao/llm-chat-call.dao.js";
import { BizError } from "../../src/errors/biz-error.js";
import { createLlmClient, type LlmClient } from "../../src/llm/client.js";
import {
  attachLlmProviderFailureContext,
  type LlmProvider,
  type LlmProviderChatResult,
} from "../../src/llm/provider.js";
import type { LlmChatResponsePayload, LlmProviderId, LlmUsageId } from "../../src/llm/types.js";

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
    contextSummarizer: {
      attempts: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          times: 1,
        },
      ],
    },
    vision: {
      attempts: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          times: 1,
        },
      ],
    },
    replyDecider: {
      attempts: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          times: 1,
        },
      ],
    },
    webSearchAgent: {
      attempts: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          times: 1,
        },
      ],
    },
    ...(overrides ?? {}),
  };
}

function createProviderConfigs(): Record<
  LlmProviderId,
  LlmProviderRuntimeConfig | OpenAiCodexRuntimeConfig
> {
  return {
    deepseek: {
      apiKey: undefined,
      baseUrl: "https://api.deepseek.com",
      models: ["deepseek-chat", "deepseek-reasoner"],
      timeoutMs: 45_000,
    },
    openai: {
      apiKey: undefined,
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4o-mini", "gpt-5.4"],
      timeoutMs: 45_000,
    },
    "openai-codex": {
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      models: ["gpt-5.3-codex"],
      timeoutMs: 45_000,
    },
    "claude-code": {
      apiKey: undefined,
      baseUrl: "https://api.anthropic.com",
      models: ["claude-sonnet-4-20250514"],
      timeoutMs: 45_000,
    },
  };
}

function createClient(params?: {
  llmChatCallDao?: LlmChatCallDao;
  providers?: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs?: Record<LlmProviderId, LlmProviderRuntimeConfig | OpenAiCodexRuntimeConfig>;
  usages?: Record<LlmUsageId, LlmUsageRuntimeConfig>;
}): { client: LlmClient; llmChatCallDao: LlmChatCallDao } {
  const llmChatCallDao = params?.llmChatCallDao ?? createLlmChatCallDaoMock();

  return {
    client: createLlmClient({
      llmChatCallDao,
      providers: params?.providers ?? {},
      providerConfigs: params?.providerConfigs ?? createProviderConfigs(),
      usages: params?.usages ?? createUsageConfig(),
    }),
    llmChatCallDao,
  };
}

function createChatResponse(
  overrides: Partial<LlmChatResponsePayload> = {},
): LlmChatResponsePayload {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "pong",
      toolCalls: [],
    },
    ...overrides,
  };
}

function createProviderChatResult(
  response: LlmChatResponsePayload,
  overrides: Partial<LlmProviderChatResult> = {},
): LlmProviderChatResult {
  return {
    response,
    nativeRequestPayload: {
      model: response.model,
      messages: [],
    },
    nativeResponsePayload: {
      id: `native-${response.model}`,
      model: response.model,
    },
    ...overrides,
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
        "claude-code": {
          id: "claude-code",
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
        models: ["gpt-4o-mini", "gpt-5.4"],
      },
      {
        id: "claude-code",
        models: ["claude-sonnet-4-20250514"],
      },
      {
        id: "deepseek",
        models: ["deepseek-chat", "deepseek-reasoner"],
      },
    ]);
  });

  it("should skip persistence when recordCall is false in direct mode", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi
        .fn()
        .mockResolvedValue(createProviderChatResult(createChatResponse({ provider: "openai" }))),
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

  it("should persist native request and response payloads on success", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(createChatResponse({ provider: "openai" }), {
          nativeRequestPayload: {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "ping" }],
          },
          nativeResponsePayload: {
            id: "chatcmpl_test",
            model: "gpt-4o-mini",
          },
        }),
      ),
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
      },
    );

    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        extension: {
          metadata: {
            actualModel: "gpt-4o-mini",
          },
        },
        nativeRequestPayload: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        },
        nativeResponsePayload: {
          id: "chatcmpl_test",
          model: "gpt-4o-mini",
        },
      }),
    );
  });

  it("should persist native failure context when provider throws with native payloads", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockRejectedValue(
        attachLlmProviderFailureContext(new Error("upstream failed"), {
          nativeRequestPayload: {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "ping" }],
          },
          nativeResponsePayload: {
            id: "response_partial",
          },
          nativeError: {
            status: 500,
            message: "provider boom",
          },
        }),
      ),
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        openai: provider,
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
          model: "gpt-4o-mini",
        },
      ),
    ).rejects.toThrow("upstream failed");

    expect(llmChatCallDao.recordError).toHaveBeenCalledWith(
      expect.objectContaining({
        extension: null,
        nativeRequestPayload: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        },
        nativeResponsePayload: {
          id: "response_partial",
        },
        nativeError: {
          status: 500,
          message: "provider boom",
        },
      }),
    );
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
      name: "BizError",
      message: "所选 LLM provider 当前不可用",
      meta: {
        provider: "deepseek",
      },
    } satisfies Partial<BizError>);
  });

  it("should reject direct chat when the model is not configured for the provider", async () => {
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
          model: "deepseek-chat",
        },
      ),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "所选 LLM 模型未在当前 provider 中配置",
      meta: {
        provider: "openai",
        model: "deepseek-chat",
      },
    } satisfies Partial<BizError>);
  });

  it("should retry next usage attempt, reuse requestId, and increment seq", async () => {
    const llmChatCallDao = createLlmChatCallDaoMock();
    const openaiProvider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockRejectedValue(new Error("openai failed")),
    };
    const deepseekProvider: LlmProvider = {
      id: "deepseek",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "deepseek",
            model: "deepseek-chat",
            message: {
              role: "assistant",
              content: "fallback pong",
              toolCalls: [],
            },
          }),
        ),
      ),
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
    expect(vi.mocked(llmChatCallDao.recordError).mock.calls[0]?.[0].seq).toBe(1);
    expect(vi.mocked(llmChatCallDao.recordSuccess).mock.calls[0]?.[0].seq).toBe(2);
    expect(vi.mocked(llmChatCallDao.recordSuccess).mock.calls[0]?.[0].nativeRequestPayload).toEqual(
      {
        model: "deepseek-chat",
        messages: [],
      },
    );
    expect(vi.mocked(llmChatCallDao.recordSuccess).mock.calls[0]?.[0].extension).toEqual({
      metadata: {
        actualModel: "deepseek-chat",
      },
    });
    expect(
      vi.mocked(llmChatCallDao.recordSuccess).mock.calls[0]?.[0].nativeResponsePayload,
    ).toEqual({
      id: "native-deepseek-chat",
      model: "deepseek-chat",
    });
  });

  it("should continue after an unavailable usage attempt", async () => {
    const llmChatCallDao = createLlmChatCallDaoMock();
    const deepseekProvider: LlmProvider = {
      id: "deepseek",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "deepseek",
            model: "deepseek-chat",
          }),
        ),
      ),
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
      seq: 1,
    });
    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llmChatCallDao.recordSuccess).mock.calls[0]?.[0]).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      extension: {
        metadata: {
          actualModel: "deepseek-chat",
        },
      },
      seq: 2,
    });
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

  it("should reject usage attempts when the configured model is not in provider models", async () => {
    const { client } = createClient({
      providers: {
        openai: {
          id: "openai",
          chat: vi.fn(),
        },
      },
      usages: createUsageConfig({
        agent: {
          attempts: [
            {
              provider: "openai",
              model: "non-existent-model",
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
    ).rejects.toMatchObject({
      name: "BizError",
      message: "所选 LLM 模型未在当前 provider 中配置",
      meta: {
        provider: "openai",
        model: "non-existent-model",
      },
    } satisfies Partial<BizError>);
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
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "deepseek",
            model: "deepseek-chat",
            message: {
              role: "assistant",
              content: "fallback pong",
              toolCalls: [],
            },
          }),
        ),
      ),
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
    expect(vi.mocked(llmChatCallDao.recordError).mock.calls.map(call => call[0].seq)).toEqual([
      1, 2,
    ]);
    expect(vi.mocked(llmChatCallDao.recordSuccess).mock.calls[0]?.[0].seq).toBe(3);
  });

  it("should reject unauthorized tool calls returned by provider", async () => {
    const llmChatCallDao = createLlmChatCallDaoMock();
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "openai",
            message: {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "call-1",
                  name: "send_group_message",
                  arguments: {
                    message: "hi",
                  },
                },
              ],
            },
          }),
        ),
      ),
    };
    const { client } = createClient({
      llmChatCallDao,
      providers: {
        openai: provider,
      },
    });

    await expect(
      client.chat(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [
            {
              name: "search_web",
              parameters: {
                type: "object",
                properties: {},
              },
            },
          ],
          toolChoice: { tool_name: "search_web" },
        },
        {
          usage: "agent",
        },
      ),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "LLM 返回了未授权的工具调用",
      meta: {
        invalidToolNames: ["send_group_message"],
        allowedToolNames: ["search_web"],
      },
    } satisfies Partial<BizError>);

    expect(llmChatCallDao.recordError).toHaveBeenCalledTimes(1);
    expect(llmChatCallDao.recordSuccess).not.toHaveBeenCalled();
    expect(vi.mocked(llmChatCallDao.recordError).mock.calls[0]?.[0].response).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            name: "send_group_message",
            arguments: {
              message: "hi",
            },
          },
        ],
      },
    });
    expect(vi.mocked(llmChatCallDao.recordError).mock.calls[0]?.[0].nativeRequestPayload).toEqual({
      model: "gpt-4o-mini",
      messages: [],
    });
    expect(vi.mocked(llmChatCallDao.recordError).mock.calls[0]?.[0].nativeResponsePayload).toEqual({
      id: "native-gpt-4o-mini",
      model: "gpt-4o-mini",
    });
    expect(vi.mocked(llmChatCallDao.recordError).mock.calls[0]?.[0].extension).toEqual({
      metadata: {
        actualModel: "gpt-4o-mini",
      },
    });
  });

  it("should reject tool calls that do not match the explicitly required tool", async () => {
    const llmChatCallDao = createLlmChatCallDaoMock();
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "openai",
            message: {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "call-1",
                  name: "finish",
                  arguments: {},
                },
              ],
            },
          }),
        ),
      ),
    };
    const { client } = createClient({
      llmChatCallDao,
      providers: {
        openai: provider,
      },
    });

    await expect(
      client.chat(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [
            {
              name: "finish",
              parameters: {
                type: "object",
                properties: {},
              },
            },
            {
              name: "search_web",
              parameters: {
                type: "object",
                properties: {},
              },
            },
          ],
          toolChoice: { tool_name: "search_web" },
        },
        {
          usage: "agent",
        },
      ),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "LLM 未按要求调用指定工具",
      meta: {
        requiredToolName: "search_web",
        mismatchedToolNames: ["finish"],
      },
    } satisfies Partial<BizError>);

    expect(llmChatCallDao.recordError).toHaveBeenCalledTimes(1);
    expect(llmChatCallDao.recordSuccess).not.toHaveBeenCalled();
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

  it("should support image content in chat and persist only image metadata", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "openai",
            message: {
              role: "assistant",
              content: "图片中是一只猫。",
              toolCalls: [],
            },
          }),
          {
            nativeRequestPayload: {
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: "请描述图片内容" },
                    {
                      type: "image_url",
                      image_url: {
                        url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
                      },
                    },
                  ],
                },
              ],
            },
          },
        ),
      ),
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        openai: provider,
      },
    });

    await expect(
      client.chat(
        {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请描述图片内容",
                },
                {
                  type: "image",
                  content: Buffer.from("image-bytes"),
                  mimeType: "image/png",
                  filename: "cat.png",
                },
              ],
            },
          ],
          tools: [],
          toolChoice: "none",
        },
        {
          usage: "vision",
        },
      ),
    ).resolves.toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      message: {
        role: "assistant",
        content: "图片中是一只猫。",
        toolCalls: [],
      },
    });

    expect(provider.chat).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请描述图片内容",
            },
            {
              type: "image",
              content: Buffer.from("image-bytes"),
              mimeType: "image/png",
              filename: "cat.png",
            },
          ],
        },
      ],
      tools: [],
      toolChoice: "none",
    });
    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        extension: {
          metadata: {
            actualModel: "gpt-4o-mini",
          },
        },
        request: {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请描述图片内容",
                },
                {
                  type: "image",
                  mimeType: "image/png",
                  filename: "cat.png",
                  sizeBytes: Buffer.from("image-bytes").byteLength,
                },
              ],
            },
          ],
          tools: [],
          toolChoice: "none",
        },
        response: {
          provider: "openai",
          model: "gpt-4o-mini",
          message: {
            role: "assistant",
            content: "图片中是一只猫。",
            toolCalls: [],
          },
        },
      }),
    );
  });

  it("should forward image content to the configured provider without local capability checks", async () => {
    const provider: LlmProvider = {
      id: "deepseek",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "deepseek",
            model: "deepseek-chat",
            message: {
              role: "assistant",
              content: "received",
              toolCalls: [],
            },
          }),
        ),
      ),
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        deepseek: provider,
      },
      usages: createUsageConfig({
        vision: {
          attempts: [
            {
              provider: "deepseek",
              model: "deepseek-chat",
              times: 1,
            },
          ],
        },
      }),
    });

    const imageBytes = Buffer.from("image-bytes");

    await expect(
      client.chat(
        {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "describe image",
                },
                {
                  type: "image",
                  content: imageBytes,
                  mimeType: "image/jpeg",
                },
              ],
            },
          ],
          tools: [],
          toolChoice: "none",
        },
        {
          usage: "vision",
        },
      ),
    ).resolves.toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      message: {
        content: "received",
      },
    });

    expect(provider.chat).toHaveBeenCalledWith({
      model: "deepseek-chat",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "describe image",
            },
            {
              type: "image",
              content: imageBytes,
              mimeType: "image/jpeg",
            },
          ],
        },
      ],
      tools: [],
      toolChoice: "none",
    });
    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-chat",
        extension: {
          metadata: {
            actualModel: "deepseek-chat",
          },
        },
        request: {
          model: "deepseek-chat",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "describe image",
                },
                {
                  type: "image",
                  mimeType: "image/jpeg",
                  filename: undefined,
                  sizeBytes: imageBytes.byteLength,
                },
              ],
            },
          ],
          tools: [],
          toolChoice: "none",
        },
      }),
    );
    expect(llmChatCallDao.recordError).not.toHaveBeenCalled();
  });

  it("should allow image content for models that are only configured locally", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "openai",
            model: "gpt-unknown-vision",
            message: {
              role: "assistant",
              content: "received",
              toolCalls: [],
            },
          }),
        ),
      ),
    };
    const providerConfigs = createProviderConfigs();
    providerConfigs.openai = {
      ...providerConfigs.openai,
      models: ["gpt-unknown-vision"],
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        openai: provider,
      },
      providerConfigs,
      usages: createUsageConfig({
        vision: {
          attempts: [
            {
              provider: "openai",
              model: "gpt-unknown-vision",
              times: 1,
            },
          ],
        },
      }),
    });

    const imageBytes = Buffer.from("image-bytes");

    await expect(
      client.chat(
        {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "describe image",
                },
                {
                  type: "image",
                  content: imageBytes,
                  mimeType: "image/png",
                },
              ],
            },
          ],
          tools: [],
          toolChoice: "none",
        },
        {
          usage: "vision",
        },
      ),
    ).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-unknown-vision",
      message: {
        content: "received",
      },
    });

    expect(provider.chat).toHaveBeenCalledWith({
      model: "gpt-unknown-vision",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "describe image",
            },
            {
              type: "image",
              content: imageBytes,
              mimeType: "image/png",
            },
          ],
        },
      ],
      tools: [],
      toolChoice: "none",
    });
    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledTimes(1);
    expect(llmChatCallDao.recordError).not.toHaveBeenCalled();
  });

  it("should persist configured model and extension actualModel when provider returns versioned model", async () => {
    const provider: LlmProvider = {
      id: "openai-codex",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(
          createChatResponse({
            provider: "openai-codex",
            model: "gpt-5.4-mini-2026-03-17",
          }),
          {
            nativeRequestPayload: {
              model: "gpt-5.4-mini",
              messages: [],
            },
            nativeResponsePayload: {
              id: "resp_1",
              model: "gpt-5.4-mini-2026-03-17",
            },
          },
        ),
      ),
    };
    const providerConfigs = createProviderConfigs();
    providerConfigs["openai-codex"] = {
      ...providerConfigs["openai-codex"],
      models: ["gpt-5.4-mini"],
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        "openai-codex": provider,
      },
      providerConfigs,
      usages: createUsageConfig({
        agent: {
          attempts: [
            {
              provider: "openai-codex",
              model: "gpt-5.4-mini",
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
      provider: "openai-codex",
      model: "gpt-5.4-mini-2026-03-17",
    });

    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-codex",
        model: "gpt-5.4-mini",
        extension: {
          metadata: {
            actualModel: "gpt-5.4-mini-2026-03-17",
          },
        },
      }),
    );
  });

  it("should require explicit usage for listAvailableProviders", async () => {
    const { client } = createClient();

    await expect(client.listAvailableProviders({} as never)).rejects.toThrow("explicit usage");
  });
});
