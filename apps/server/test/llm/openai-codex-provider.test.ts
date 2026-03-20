import { afterEach, describe, expect, it, vi } from "vitest";
import { getLlmProviderFailureContext } from "../../src/llm/provider.js";
import { OpenAiCodexAuthStore } from "../../src/llm/providers/openai-codex-auth.js";
import { createOpenAiCodexProvider } from "../../src/llm/providers/openai-codex-provider.js";

function buildSseResponse(data: unknown, status = 200): Response {
  const payload = `event: response.completed\ndata: ${JSON.stringify(data)}\n\n`;
  return new Response(payload, {
    status,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createAuthStore(): OpenAiCodexAuthStore {
  return new OpenAiCodexAuthStore({
    codexAuthService: {
      hasCredentials: vi.fn().mockResolvedValue(true),
      getAuth: vi.fn().mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accountId: "account-id",
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

describe("createOpenAiCodexProvider", () => {
  it("should map a final assistant message from the Codex SSE response", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.instructions).toBe("You are a helpful assistant.");
      expect(body.stream).toBe(true);
      expect(body.store).toBe(false);

      return buildSseResponse({
        type: "response.completed",
        response: {
          status: "completed",
          model: "gpt-5.3-codex",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "pong" }],
            },
          ],
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            total_tokens: 18,
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCodexProvider({
      config: {
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        models: ["gpt-5.3-codex"],
        timeoutMs: 5_000,
      },
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "gpt-5.3-codex",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toEqual({
      response: {
        provider: "openai-codex",
        model: "gpt-5.3-codex",
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
        model: "gpt-5.3-codex",
        instructions: "You are a helpful assistant.",
        input: [{ role: "user", content: "ping" }],
        tools: [],
        tool_choice: "none",
        stream: true,
        store: false,
      },
      nativeResponsePayload: {
        type: "response.completed",
        response: {
          status: "completed",
          model: "gpt-5.3-codex",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "pong" }],
            },
          ],
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            total_tokens: 18,
          },
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should map function calls from the Codex SSE response", async () => {
    const fetchMock = vi.fn(async () => {
      return buildSseResponse({
        type: "response.completed",
        response: {
          status: "completed",
          model: "gpt-5.3-codex",
          output: [
            {
              type: "function_call",
              id: "fc_123",
              call_id: "call_123",
              name: "add",
              arguments: '{"a":1,"b":2}',
            },
          ],
          usage: {
            input_tokens: 9,
            output_tokens: 3,
            total_tokens: 12,
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCodexProvider({
      config: {
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        models: ["gpt-5.3-codex"],
        timeoutMs: 5_000,
      },
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "gpt-5.3-codex",
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
        provider: "openai-codex",
        model: "gpt-5.3-codex",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_123",
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
        model: "gpt-5.3-codex",
        tool_choice: "required",
      }),
      nativeResponsePayload: expect.objectContaining({
        type: "response.completed",
      }),
    });
  });

  it("should map multimodal user content to Responses API input items", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        input?: Array<{ role?: string; content?: unknown }>;
      };

      expect(body.input).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Describe this image",
            },
            {
              type: "input_image",
              image_url: "data:image/png;base64,aW1hZ2U=",
            },
          ],
        },
      ]);

      return buildSseResponse({
        type: "response.completed",
        response: {
          status: "completed",
          model: "gpt-5.4",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "图片里有一只猫。" }],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 6,
            total_tokens: 18,
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCodexProvider({
      config: {
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        models: ["gpt-5.4"],
        timeoutMs: 5_000,
      },
      authStore: createAuthStore(),
    });

    await expect(
      provider.chat({
        model: "gpt-5.4",
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
                content: Buffer.from("image"),
                mimeType: "image/png",
              },
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toMatchObject({
      response: {
        provider: "openai-codex",
        model: "gpt-5.4",
        message: {
          role: "assistant",
          content: "图片里有一只猫。",
        },
      },
    });
  });

  it("should retry with a refreshed token after a 401 response", async () => {
    const getAuth = vi
      .fn()
      .mockResolvedValueOnce({
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        accountId: "account-id",
        lastRefresh: new Date().toISOString(),
        expiresAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        accountId: "account-id",
        lastRefresh: new Date().toISOString(),
        expiresAt: Date.now() + 60_000,
      });
    const authStore = new OpenAiCodexAuthStore({
      codexAuthService: {
        hasCredentials: vi.fn().mockResolvedValue(true),
        getAuth,
        getStatus: vi.fn(),
        createLoginUrl: vi.fn(),
        handleCallback: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url === "https://chatgpt.com/backend-api/codex/responses" &&
        fetchMock.mock.calls.length === 1
      ) {
        return buildSseResponse(
          {
            type: "response.completed",
            response: {
              status: "failed",
              error: {
                message: "unauthorized",
              },
            },
          },
          401,
        );
      }

      expect(init?.headers).toMatchObject({
        Authorization: "Bearer fresh-access-token",
      });
      return buildSseResponse({
        type: "response.completed",
        response: {
          status: "completed",
          model: "gpt-5.3-codex",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "pong" }],
            },
          ],
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            total_tokens: 18,
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCodexProvider({
      config: {
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        models: ["gpt-5.3-codex"],
        timeoutMs: 5_000,
      },
      authStore,
    });

    await expect(
      provider.chat({
        model: "gpt-5.3-codex",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toMatchObject({
      response: {
        provider: "openai-codex",
        model: "gpt-5.3-codex",
        message: {
          role: "assistant",
          content: "pong",
        },
      },
      nativeResponsePayload: expect.objectContaining({
        type: "response.completed",
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAuth).toHaveBeenNthCalledWith(1, undefined);
    expect(getAuth).toHaveBeenNthCalledWith(2, { forceRefresh: true });
  });

  it("should expose native error details after repeated unauthorized responses", async () => {
    expect.assertions(2);
    const authStore = new OpenAiCodexAuthStore({
      codexAuthService: {
        hasCredentials: vi.fn().mockResolvedValue(true),
        getAuth: vi
          .fn()
          .mockResolvedValueOnce({
            accessToken: "stale-access-token",
            refreshToken: "stale-refresh-token",
            accountId: "account-id",
            lastRefresh: new Date().toISOString(),
            expiresAt: Date.now() + 60_000,
          })
          .mockResolvedValueOnce({
            accessToken: "fresh-access-token",
            refreshToken: "fresh-refresh-token",
            accountId: "account-id",
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
    const fetchMock = vi.fn(async () => {
      return buildSseResponse(
        {
          type: "response.completed",
          response: {
            status: "failed",
            error: {
              message: "unauthorized",
            },
          },
        },
        401,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCodexProvider({
      config: {
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        models: ["gpt-5.3-codex"],
        timeoutMs: 5_000,
      },
      authStore,
    });

    try {
      await provider.chat({
        model: "gpt-5.3-codex",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      });
    } catch (error) {
      expect(error).toMatchObject({
        name: "BizError",
        message: "所选 LLM provider 当前不可用",
        meta: {
          provider: "openai-codex",
          reason: "UNAUTHORIZED",
        },
      });
      expect(getLlmProviderFailureContext(error)).toEqual({
        nativeRequestPayload: {
          model: "gpt-5.3-codex",
          instructions: "You are a helpful assistant.",
          input: [{ role: "user", content: "ping" }],
          tools: [],
          tool_choice: "none",
          stream: true,
          store: false,
        },
        nativeResponsePayload: {
          type: "response.completed",
          response: {
            status: "failed",
            error: {
              message: "unauthorized",
            },
          },
        },
        nativeError: {
          status: 401,
          reason: "UNAUTHORIZED",
          responseText:
            'event: response.completed\ndata: {"type":"response.completed","response":{"status":"failed","error":{"message":"unauthorized"}}}\n\n',
        },
      });
    }
  });
});
