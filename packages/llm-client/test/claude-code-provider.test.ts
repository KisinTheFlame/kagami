import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { getLlmProviderFailureContext } from "../src/provider.js";
import type { ClaudeCodeAuth, ClaudeCodeAuthProvider } from "../src/providers/claude-code-auth.js";
import { createClaudeCodeProvider } from "../src/providers/claude-code-provider.js";
import type { ClaudeFileCacheDao } from "../src/providers/claude-file-cache.dao.js";

// 测试内桩：真正的 ClaudeCodeAuthStore 适配器已随 llm-client/auth 边界移到 agent 装配层，
// 它只对 provider 暴露 ClaudeCodeAuthProvider 接口。此处复刻其「包住一个 auth service」的形态，
// 参数用 `& Record<string, unknown>` 放行 mock 上多出来的服务方法（绕过对象字面量多余属性检查）。
class ClaudeCodeAuthStore implements ClaudeCodeAuthProvider {
  private readonly service: ClaudeCodeAuthProvider;

  public constructor(deps: {
    claudeCodeAuthService: ClaudeCodeAuthProvider & Record<string, unknown>;
  }) {
    this.service = deps.claudeCodeAuthService;
  }

  public hasCredentials(): Promise<boolean> {
    return this.service.hasCredentials();
  }

  public getAuth(options?: { forceRefresh?: boolean }): Promise<ClaudeCodeAuth> {
    return this.service.getAuth(options);
  }
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createAuthStore(): ClaudeCodeAuthStore {
  return new ClaudeCodeAuthStore({
    claudeCodeAuthService: {
      hasCredentials: vi.fn().mockResolvedValue(true),
      getAuth: vi.fn().mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accountId: "user_123",
        email: "claude@example.com",
        lastRefresh: new Date().toISOString(),
        expiresAt: Date.now() + 60_000,
      }),
      getStatus: vi.fn(),
      createLoginUrl: vi.fn(),
      handleCallback: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
      getUsageLimits: vi.fn(),
      getAuthWithoutRefresh: vi.fn(),
    },
  });
}

function createSseResponse(events: unknown[]): string {
  return events.map(event => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function createTextMessageSse(input: {
  model: string;
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}): string {
  return createSseResponse([
    {
      type: "message_start",
      message: {
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: input.model,
        usage: {
          input_tokens: input.inputTokens ?? 11,
          output_tokens: 0,
          ...(input.cacheReadInputTokens !== undefined
            ? { cache_read_input_tokens: input.cacheReadInputTokens }
            : {}),
          ...(input.cacheCreationInputTokens !== undefined
            ? { cache_creation_input_tokens: input.cacheCreationInputTokens }
            : {}),
        },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "text",
        text: "",
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text: input.text,
      },
    },
    {
      type: "content_block_stop",
      index: 0,
    },
    {
      type: "message_delta",
      delta: {
        stop_reason: "end_turn",
      },
      usage: {
        output_tokens: input.outputTokens ?? 7,
      },
    },
    {
      type: "message_stop",
    },
  ]);
}

function createToolUseSse(input: {
  model: string;
  toolId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}): string {
  return createSseResponse([
    {
      type: "message_start",
      message: {
        type: "message",
        role: "assistant",
        model: input.model,
        usage: {
          input_tokens: 9,
          output_tokens: 0,
        },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: input.toolId,
        name: input.toolName,
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(input.toolInput),
      },
    },
    {
      type: "content_block_stop",
      index: 0,
    },
    {
      type: "message_delta",
      usage: {
        output_tokens: 3,
      },
    },
    {
      type: "message_stop",
    },
  ]);
}

function createProviderConfig(
  overrides: Partial<{
    baseUrl: string;
    models: string[];
    timeoutMs: number;
    keepAliveReplayIntervalMinutes: number;
    useFileApi: boolean;
  }> = {},
): {
  baseUrl: string;
  models: string[];
  timeoutMs: number;
  keepAliveReplayIntervalMinutes: number;
  useFileApi: boolean;
} {
  return {
    baseUrl: "https://api.anthropic.com",
    models: ["claude-sonnet-4-6"],
    timeoutMs: 5_000,
    keepAliveReplayIntervalMinutes: 30,
    // 现有黑盒测试都发文本、且不注入 fileCacheDao → File API 分支短路，逐字节走 base64 旧路。
    // 默认对齐生产（true）；图片相关行为由文件末尾的 File API 专项 describe 覆盖。
    useFileApi: true,
    ...overrides,
  };
}

describe("createClaudeCodeProvider", () => {
  it("should map a completed zero-block stream to an empty assistant message (auto 空轮)", async () => {
    // 生产实况（2026-07-03 部署 #270 后）：toolChoice auto + thinking disabled 下
    // 模型可以合法地"什么都不说"——流完整走完（message_start → end_turn →
    // message_stop）但零个 content block。必须映射为空 assistant 消息而非
    // INVALID_RESPONSE，否则 agent 会陷入退避重试循环。
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            createSseResponse([
              {
                type: "message_start",
                message: {
                  id: "msg_empty",
                  type: "message",
                  role: "assistant",
                  model: "claude-opus-4-6",
                  content: [],
                  usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 165183 },
                },
              },
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 165183 },
              },
              { type: "message_stop" },
            ]),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );

    const provider = createClaudeCodeProvider({
      config: createProviderConfig({ models: ["claude-opus-4-6"] }),
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        system: "你是一个测试助手。",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "auto",
        model: "claude-opus-4-6",
      }),
    ).resolves.toMatchObject({
      response: {
        provider: "claude-code",
        model: "claude-opus-4-6",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [],
        },
        usage: {
          completionTokens: 2,
          cacheHitTokens: 165183,
        },
      },
    });

    vi.unstubAllGlobals();
  });

  it("should still reject a truncated stream with zero blocks (no message_stop)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            createSseResponse([
              {
                type: "message_start",
                message: {
                  id: "msg_trunc",
                  type: "message",
                  role: "assistant",
                  model: "claude-opus-4-6",
                  content: [],
                  usage: { input_tokens: 1, output_tokens: 0 },
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );

    const provider = createClaudeCodeProvider({
      config: createProviderConfig({ models: ["claude-opus-4-6"] }),
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        system: "你是一个测试助手。",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "auto",
        model: "claude-opus-4-6",
      }),
    ).rejects.toMatchObject({
      message: "LLM 上游服务调用失败",
    });

    vi.unstubAllGlobals();
  });

  it("should map a final assistant message from the Claude stream response", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const system = body.system as Array<Record<string, unknown>>;

      expect(body.model).toBe("claude-sonnet-4-6");
      expect(body.stream).toBe(true);
      expect(body.max_tokens).toBe(32000);
      expect(body.cache_control).toEqual({
        type: "ephemeral",
        ttl: "1h",
      });
      expect(system[0]?.text).toMatch(/^x-anthropic-billing-header:/);
      expect(system[1]).toEqual({
        type: "text",
        text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
      });
      expect(system[2]).toEqual({
        type: "text",
        text: "你是一个测试助手。",
      });
      expect(body.thinking).toEqual({
        type: "disabled",
      });
      expect(body.output_config).toBeUndefined();
      expect(body.context_management).toBeUndefined();
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        "Anthropic-Version": "2023-06-01",
      });

      return new Response(
        createTextMessageSse({
          model: "claude-sonnet-4-6",
          text: "pong",
          cacheReadInputTokens: 6,
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-6",
        system: "你是一个测试助手。",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toEqual({
      response: {
        provider: "claude-code",
        model: "claude-sonnet-4-6",
        message: {
          role: "assistant",
          content: "pong",
          toolCalls: [],
        },
        usage: {
          promptTokens: 17,
          completionTokens: 7,
          totalTokens: 24,
          cacheHitTokens: 6,
          cacheMissTokens: 11,
        },
      },
      nativeRequestPayload: {
        model: "claude-sonnet-4-6",
        stream: true,
        max_tokens: 32000,
        cache_control: {
          type: "ephemeral",
          ttl: "1h",
        },
        system: [
          {
            type: "text",
            text: expect.stringMatching(/^x-anthropic-billing-header:/),
          },
          {
            type: "text",
            text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
          },
          {
            type: "text",
            text: "你是一个测试助手。",
          },
        ],
        thinking: {
          type: "disabled",
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "ping",
              },
            ],
          },
        ],
      },
      nativeResponsePayload: {
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "pong" }],
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          cache_read_input_tokens: 6,
        },
      },
    });
  });

  it("should normalize Claude prompt caching usage fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          createTextMessageSse({
            model: "claude-sonnet-4-6",
            text: "pong",
            inputTokens: 11,
            outputTokens: 7,
            cacheReadInputTokens: 100,
            cacheCreationInputTokens: 20,
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        );
      }),
    );

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toMatchObject({
      response: {
        usage: {
          promptTokens: 131,
          completionTokens: 7,
          totalTokens: 138,
          cacheHitTokens: 100,
          cacheMissTokens: 31,
        },
      },
      nativeResponsePayload: {
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 20,
        },
      },
    });
  });

  it("should disable thinking when tool_choice forces tool use", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

        expect(body.thinking).toEqual({
          type: "disabled",
        });
        expect(body.output_config).toBeUndefined();
        expect(body.tool_choice).toEqual({
          type: "any",
        });

        return new Response(
          createToolUseSse({
            model: "claude-sonnet-4-6",
            toolId: "toolu_123",
            toolName: "add",
            toolInput: { a: 1, b: 2 },
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        );
      }),
    );

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "ping" }],
        tools: [
          {
            name: "add",
            description: "Add two numbers",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
        toolChoice: "required",
      }),
    ).resolves.toEqual({
      response: {
        provider: "claude-code",
        model: "claude-sonnet-4-6",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "toolu_123",
              name: "add",
              arguments: {
                a: 1,
                b: 2,
              },
            },
          ],
        },
        usage: {
          promptTokens: 9,
          completionTokens: 3,
          totalTokens: 12,
          cacheMissTokens: 9,
        },
      },
      nativeRequestPayload: expect.objectContaining({
        model: "claude-sonnet-4-6",
        tool_choice: {
          type: "any",
        },
        thinking: {
          type: "disabled",
        },
      }),
      nativeResponsePayload: expect.objectContaining({
        type: "message",
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "add",
            input: {
              a: 1,
              b: 2,
            },
          },
        ],
      }),
    });
  });

  it("should map multimodal user content to Claude message blocks", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{ role?: string; content?: unknown }>;
      };

      expect(body.messages).toEqual([
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image",
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "aW1hZ2U=",
              },
            },
          ],
        },
      ]);

      return new Response(
        createTextMessageSse({
          model: "claude-sonnet-4-5-20250929",
          text: "图片里有一只猫。",
          inputTokens: 12,
          outputTokens: 6,
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: createProviderConfig({
        models: ["claude-sonnet-4-5-20250929"],
      }),
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image",
              },
              {
                type: "image",
                mimeType: "image/png",
                content: Buffer.from("image").toString("base64"),
              },
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toMatchObject({
      response: {
        provider: "claude-code",
        model: "claude-sonnet-4-5-20250929",
        message: {
          content: "图片里有一只猫。",
        },
      },
      nativeRequestPayload: {
        model: "claude-sonnet-4-5-20250929",
        thinking: {
          type: "disabled",
        },
      },
    });
  });

  it("should not retry auth refresh after an unauthorized response", async () => {
    const getAuth = vi.fn().mockResolvedValueOnce({
      accessToken: "stale-access",
      refreshToken: "refresh-token",
      accountId: "user_123",
      email: "claude@example.com",
      lastRefresh: new Date().toISOString(),
      expiresAt: Date.now() + 60_000,
    });
    const authStore = new ClaudeCodeAuthStore({
      claudeCodeAuthService: {
        hasCredentials: vi.fn().mockResolvedValue(true),
        getAuth,
        getStatus: vi.fn(),
        createLoginUrl: vi.fn(),
        handleCallback: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        getUsageLimits: vi.fn(),
        getAuthWithoutRefresh: vi.fn(),
      },
    });

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: "unauthorized",
          },
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore,
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
    ).rejects.toMatchObject({
      message: "所选 LLM provider 当前不可用",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAuth).toHaveBeenCalledTimes(1);
    expect(getAuth).toHaveBeenCalledWith(undefined);
  });

  it("should expose failure context when the upstream responds with unauthorized", async () => {
    const getAuth = vi.fn().mockResolvedValueOnce({
      accessToken: "stale-access",
      refreshToken: "refresh-token",
      accountId: "user_123",
      email: "claude@example.com",
      lastRefresh: new Date().toISOString(),
      expiresAt: Date.now() + 60_000,
    });
    const authStore = new ClaudeCodeAuthStore({
      claudeCodeAuthService: {
        hasCredentials: vi.fn().mockResolvedValue(true),
        getAuth,
        getStatus: vi.fn(),
        createLoginUrl: vi.fn(),
        handleCallback: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        getUsageLimits: vi.fn(),
        getAuthWithoutRefresh: vi.fn(),
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: "unauthorized",
            },
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }),
    );

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore,
    });

    await provider
      .chat({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      })
      .catch(error => {
        expect(error).toMatchObject({
          message: "所选 LLM provider 当前不可用",
        });
        expect(getLlmProviderFailureContext(error)).toMatchObject({
          nativeRequestPayload: {
            model: "claude-sonnet-4-6",
          },
          nativeError: {
            reason: "UNAUTHORIZED",
            status: 401,
          },
        });
      });
  });

  it("should replay the last successful request with max_tokens set to 1 after the keep alive interval", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          createTextMessageSse({
            model: "claude-sonnet-4-6",
            text: "pong",
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          createTextMessageSse({
            model: "claude-sonnet-4-6",
            text: "keepalive",
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: createProviderConfig({
        keepAliveReplayIntervalMinutes: 1,
      }),
      authStore: createAuthStore(),
    });

    await provider.chat({
      model: "claude-sonnet-4-6",
      system: "你是一个测试助手。",
      messages: [{ role: "user", content: "ping" }],
      tools: [],
      toolChoice: "none",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      model: "claude-sonnet-4-6",
      max_tokens: 1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "ping",
            },
          ],
        },
      ],
    });

    provider.close?.();
  });

  it("should reset the replay countdown when a new successful request arrives", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        createTextMessageSse({
          model: "claude-sonnet-4-6",
          text: "pong",
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: createProviderConfig({
        keepAliveReplayIntervalMinutes: 1,
      }),
      authStore: createAuthStore(),
    });

    await provider.chat({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "first" }],
      tools: [],
      toolChoice: "none",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await provider.chat({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "second" }],
      tools: [],
      toolChoice: "none",
    });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      max_tokens: 1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "second",
            },
          ],
        },
      ],
    });

    provider.close?.();
  });

  it("should continue scheduling replays after a replay failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          createTextMessageSse({
            model: "claude-sonnet-4-6",
            text: "pong",
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        ),
      )
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          createTextMessageSse({
            model: "claude-sonnet-4-6",
            text: "keepalive",
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: createProviderConfig({
        keepAliveReplayIntervalMinutes: 1,
      }),
      authStore: createAuthStore(),
    });

    await provider.chat({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "ping" }],
      tools: [],
      toolChoice: "none",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      max_tokens: 1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "ping",
            },
          ],
        },
      ],
    });

    provider.close?.();
  });

  it("should clear the scheduled replay when the provider is closed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        createTextMessageSse({
          model: "claude-sonnet-4-6",
          text: "pong",
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: createProviderConfig({
        keepAliveReplayIntervalMinutes: 1,
      }),
      authStore: createAuthStore(),
    });

    await provider.chat({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "ping" }],
      tools: [],
      toolChoice: "none",
    });

    provider.close?.();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createClaudeCodeProvider · 图片 File API", () => {
  const IMAGE_B64 = Buffer.from("fake-png-bytes").toString("base64");
  const IMAGE_SIZE = Buffer.from(IMAGE_B64, "base64").byteLength;

  function imageRequest() {
    return {
      messages: [
        {
          role: "user" as const,
          content: [{ type: "image" as const, content: IMAGE_B64, mimeType: "image/png" }],
        },
      ],
      tools: [],
      toolChoice: "auto" as const,
      model: "claude-sonnet-4-6",
    };
  }

  function createFileCacheDao(record: {
    findByHash?: Mock;
    save?: Mock;
  }): ClaudeFileCacheDao & { findByHash: Mock; save: Mock } {
    const findByHash = record.findByHash ?? vi.fn().mockResolvedValue(null);
    const save = record.save ?? vi.fn().mockResolvedValue(undefined);
    return { findByHash, save };
  }

  /** 路由 /v1/files（上传）与 /v1/messages（SSE）。filesStatus!=200 时模拟上传失败。 */
  function stubRoutedFetch(input: { fileId?: string; filesStatus?: number }): Mock {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/v1/files")) {
        const status = input.filesStatus ?? 200;
        if (status !== 200) {
          return new Response("upload rejected", { status });
        }
        return new Response(JSON.stringify({ id: input.fileId ?? "file_uploaded" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(createTextMessageSse({ model: "claude-sonnet-4-6", text: "ok" }), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function imageSourceFromMessagesCall(fetchMock: Mock): Record<string, unknown> {
    for (const call of fetchMock.mock.calls) {
      if (!String(call[0]).includes("/v1/messages")) {
        continue;
      }
      const body = JSON.parse((call[1] as { body: string }).body) as {
        messages: Array<{ content: Array<{ type: string; source?: Record<string, unknown> }> }>;
      };
      const imagePart = body.messages
        .flatMap(message => message.content)
        .find(part => part.type === "image");
      if (!imagePart?.source) {
        throw new Error("no image part in /v1/messages body");
      }
      return imagePart.source;
    }
    throw new Error("no /v1/messages call captured");
  }

  it("缓存命中：以 file_id 引用，不上传、不写缓存", async () => {
    const findByHash = vi.fn().mockResolvedValue({
      contentSha256: "sha",
      fileId: "file_cached",
      mimeType: "image/png",
      sizeBytes: IMAGE_SIZE,
    });
    const save = vi.fn();
    const fileCacheDao = createFileCacheDao({ findByHash, save });
    const fetchMock = stubRoutedFetch({});

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore: createAuthStore(),
      fileCacheDao,
    });

    await provider.chat(imageRequest());

    expect(imageSourceFromMessagesCall(fetchMock)).toEqual({
      type: "file",
      file_id: "file_cached",
    });
    expect(save).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/v1/files"))).toBe(false);

    vi.unstubAllGlobals();
  });

  it("缓存未命中：上传一次、写缓存、以 file_id 引用", async () => {
    const findByHash = vi.fn().mockResolvedValue(null);
    const save = vi.fn().mockResolvedValue(undefined);
    const fileCacheDao = createFileCacheDao({ findByHash, save });
    const fetchMock = stubRoutedFetch({ fileId: "file_new" });

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore: createAuthStore(),
      fileCacheDao,
    });

    await provider.chat(imageRequest());

    const filesCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes("/v1/files"));
    expect(filesCalls).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "file_new",
        mimeType: "image/png",
        sizeBytes: IMAGE_SIZE,
      }),
    );
    expect(imageSourceFromMessagesCall(fetchMock)).toEqual({
      type: "file",
      file_id: "file_new",
    });

    vi.unstubAllGlobals();
  });

  it("上传失败：该图回退 base64 内联，请求仍成功", async () => {
    const fileCacheDao = createFileCacheDao({});
    const fetchMock = stubRoutedFetch({ filesStatus: 403 });

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore: createAuthStore(),
      fileCacheDao,
    });

    await expect(provider.chat(imageRequest())).resolves.toMatchObject({
      response: { provider: "claude-code" },
    });

    expect(imageSourceFromMessagesCall(fetchMock)).toEqual({
      type: "base64",
      media_type: "image/png",
      data: IMAGE_B64,
    });
    expect(fileCacheDao.save).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("0 字节坏图：绝不上传/写缓存，回退 base64", async () => {
    const fileCacheDao = createFileCacheDao({});
    const fetchMock = stubRoutedFetch({});

    const provider = createClaudeCodeProvider({
      config: createProviderConfig(),
      authStore: createAuthStore(),
      fileCacheDao,
    });

    await provider.chat({
      messages: [
        {
          role: "user" as const,
          content: [{ type: "image" as const, content: "", mimeType: "image/png" }],
        },
      ],
      tools: [],
      toolChoice: "auto" as const,
      model: "claude-sonnet-4-6",
    });

    expect(imageSourceFromMessagesCall(fetchMock)).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "",
    });
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/v1/files"))).toBe(false);
    expect(fileCacheDao.save).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("useFileApi=false：全走 base64，不查缓存、不上传", async () => {
    const fileCacheDao = createFileCacheDao({});
    const fetchMock = stubRoutedFetch({});

    const provider = createClaudeCodeProvider({
      config: createProviderConfig({ useFileApi: false }),
      authStore: createAuthStore(),
      fileCacheDao,
    });

    await provider.chat(imageRequest());

    expect(imageSourceFromMessagesCall(fetchMock)).toEqual({
      type: "base64",
      media_type: "image/png",
      data: IMAGE_B64,
    });
    expect(fileCacheDao.findByHash).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/v1/files"))).toBe(false);

    vi.unstubAllGlobals();
  });
});
