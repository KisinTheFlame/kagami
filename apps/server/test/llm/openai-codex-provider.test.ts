import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLlmProviderFailureContext } from "../../src/llm/provider.js";
import { createOpenAiCodexProvider } from "../../src/llm/providers/openai-codex-provider.js";

const tempDirs: string[] = [];

function buildSseResponse(data: unknown, status = 200): Response {
  const payload = `event: response.completed\ndata: ${JSON.stringify(data)}\n\n`;
  return new Response(payload, {
    status,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

async function createAuthFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kagami-codex-provider-"));
  tempDirs.push(dir);

  const authFilePath = path.join(dir, "auth.json");
  await writeFile(
    authFilePath,
    `${JSON.stringify(
      {
        auth_mode: "chatgpt",
        tokens: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          account_id: "account-id",
        },
        last_refresh: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return authFilePath;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("createOpenAiCodexProvider", () => {
  it("should map a final assistant message from the Codex SSE response", async () => {
    const authFilePath = await createAuthFile();
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
      authFilePath,
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      models: ["gpt-5.3-codex"],
      refreshLeewayMs: 60_000,
      timeoutMs: 5_000,
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
    const authFilePath = await createAuthFile();
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
      authFilePath,
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      models: ["gpt-5.3-codex"],
      refreshLeewayMs: 60_000,
      timeoutMs: 5_000,
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

  it("should retry with a refreshed token after a 401 response", async () => {
    const authFilePath = await createAuthFile();
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

      if (url === "https://auth.openai.com/oauth/token") {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
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
      authFilePath,
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      models: ["gpt-5.3-codex"],
      refreshLeewayMs: 60_000,
      timeoutMs: 5_000,
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("should expose native error details after repeated unauthorized responses", async () => {
    expect.assertions(2);
    const authFilePath = await createAuthFile();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://auth.openai.com/oauth/token") {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

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
      authFilePath,
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      models: ["gpt-5.3-codex"],
      refreshLeewayMs: 60_000,
      timeoutMs: 5_000,
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
