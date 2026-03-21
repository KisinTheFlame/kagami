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

describe("createClaudeCodeProvider", () => {
  it("should map a final assistant message from the Claude response", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe("claude-sonnet-4-20250514");
      expect(body.max_tokens).toBe(4096);

      return new Response(
        JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "pong" }],
          usage: {
            input_tokens: 11,
            output_tokens: 7,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: {
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-4-20250514"],
        timeoutMs: 5_000,
      },
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toEqual({
      response: {
        provider: "claude-code",
        model: "claude-sonnet-4-20250514",
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
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
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
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "pong" }],
        usage: {
          input_tokens: 11,
          output_tokens: 7,
        },
      },
    });
  });

  it("should map tool calls from the Claude response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
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
            usage: {
              input_tokens: 9,
              output_tokens: 3,
            },
          }),
          {
            status: 200,
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
        models: ["claude-sonnet-4-20250514"],
        timeoutMs: 5_000,
      },
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-20250514",
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
        model: "claude-sonnet-4-20250514",
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
        model: "claude-sonnet-4-20250514",
        tool_choice: {
          type: "any",
        },
      }),
      nativeResponsePayload: expect.objectContaining({
        type: "message",
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
        JSON.stringify({
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "图片里有一只猫。" }],
          usage: {
            input_tokens: 12,
            output_tokens: 6,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: {
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-4-20250514"],
        timeoutMs: 5_000,
      },
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-20250514",
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
        model: "claude-sonnet-4-20250514",
        message: {
          content: "图片里有一只猫。",
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
        new Response(
          JSON.stringify({
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [{ type: "text", text: "pong" }],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createClaudeCodeProvider({
      config: {
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-4-20250514"],
        timeoutMs: 5_000,
      },
      authStore,
    });

    await expect(
      provider.chat({
        model: "claude-sonnet-4-20250514",
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
        models: ["claude-sonnet-4-20250514"],
        timeoutMs: 5_000,
      },
      authStore,
    });

    await provider
      .chat({
        model: "claude-sonnet-4-20250514",
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
            model: "claude-sonnet-4-20250514",
          },
          nativeError: {
            reason: "UNAUTHORIZED",
            status: 401,
          },
        });
      });
  });
});
