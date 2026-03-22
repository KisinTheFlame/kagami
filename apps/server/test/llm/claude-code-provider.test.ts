import { afterEach, describe, expect, it, vi } from "vitest";
import { getLlmProviderFailureContext } from "../../src/llm/provider.js";
import { ClaudeCodeAuthStore } from "../../src/llm/providers/claude-code-auth.js";
import { createClaudeCodeProvider } from "../../src/llm/providers/claude-code-provider.js";

afterEach(async () => {
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

describe("createClaudeCodeProvider", () => {
  it("should map a final assistant message from the Claude stream response", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const system = body.system as Array<Record<string, unknown>>;

      expect(body.model).toBe("claude-sonnet-4-6");
      expect(body.stream).toBe(true);
      expect(body.max_tokens).toBe(32000);
      expect(system[0]?.text).toMatch(/^x-anthropic-billing-header:/);
      expect(system[1]).toEqual({
        type: "text",
        text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
        cache_control: {
          type: "ephemeral",
          ttl: "1h",
        },
      });
      expect(system[2]?.text).toBe("你是一个测试助手。");
      expect(body.thinking).toEqual({
        type: "adaptive",
      });
      expect(body.output_config).toEqual({
        effort: "medium",
      });
      expect(body.context_management).toEqual({
        edits: [
          {
            type: "clear_thinking_20251015",
            keep: "all",
          },
        ],
      });
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        "Anthropic-Version": "2023-06-01",
      });

      return new Response(createTextMessageSse({ model: "claude-sonnet-4-6", text: "pong" }), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: {
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-4-6"],
        timeoutMs: 5_000,
      },
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
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
        },
      },
      nativeRequestPayload: {
        model: "claude-sonnet-4-6",
        stream: true,
        max_tokens: 32000,
        system: [
          {
            type: "text",
            text: expect.stringMatching(/^x-anthropic-billing-header:/),
          },
          {
            type: "text",
            text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
            cache_control: {
              type: "ephemeral",
              ttl: "1h",
            },
          },
          {
            type: "text",
            text: "你是一个测试助手。",
          },
        ],
        thinking: {
          type: "adaptive",
        },
        output_config: {
          effort: "medium",
        },
        context_management: {
          edits: [
            {
              type: "clear_thinking_20251015",
              keep: "all",
            },
          ],
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
      config: {
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-4-6"],
        timeoutMs: 5_000,
      },
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
      config: {
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-4-5-20250929"],
        timeoutMs: 5_000,
      },
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
                content: Buffer.from("image"),
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
          type: "enabled",
          budget_tokens: 1024,
        },
      },
    });
  });

  it("should refresh auth and retry once after an unauthorized response", async () => {
    const getAuth = vi
      .fn()
      .mockResolvedValueOnce({
        accessToken: "stale-access",
        refreshToken: "refresh-token",
        accountId: "user_123",
        email: "claude@example.com",
        lastRefresh: new Date().toISOString(),
        expiresAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        accessToken: "fresh-access",
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
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        new Response(createTextMessageSse({ model: "claude-sonnet-4-6", text: "pong" }), {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: {
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-4-6"],
        timeoutMs: 5_000,
      },
      authStore,
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
        provider: "claude-code",
        message: {
          content: "pong",
        },
      },
    });
    expect(getAuth).toHaveBeenNthCalledWith(1, undefined);
    expect(getAuth).toHaveBeenNthCalledWith(2, { forceRefresh: true });
  });

  it("should expose failure context when retry still fails with unauthorized", async () => {
    const getAuth = vi
      .fn()
      .mockResolvedValueOnce({
        accessToken: "stale-access",
        refreshToken: "refresh-token",
        accountId: "user_123",
        email: "claude@example.com",
        lastRefresh: new Date().toISOString(),
        expiresAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        accessToken: "still-stale-access",
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
      config: {
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-4-6"],
        timeoutMs: 5_000,
      },
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
});
