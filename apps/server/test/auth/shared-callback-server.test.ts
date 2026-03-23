import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedOAuthCallbackServer } from "../../src/auth/shared/callback-server.js";
import type { OAuthCallbackHandler } from "../../src/auth/shared/types.js";

type RequestLike = {
  method?: string;
  url?: string;
};

type ResponseLike = {
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

const mockState = vi.hoisted(() => {
  const state: {
    requestListener:
      | ((request: RequestLike, response: ResponseLike) => Promise<void> | void)
      | null;
    onceMock: ReturnType<typeof vi.fn>;
    offMock: ReturnType<typeof vi.fn>;
    listenMock: ReturnType<typeof vi.fn>;
    closeMock: ReturnType<typeof vi.fn>;
    createServerMock: ReturnType<typeof vi.fn>;
  } = {
    requestListener: null,
    onceMock: vi.fn(),
    offMock: vi.fn(),
    listenMock: vi.fn((_port: number, _host: string, callback: () => void) => {
      callback();
    }),
    closeMock: vi.fn((callback: (error?: Error | null) => void) => {
      callback(null);
    }),
    createServerMock: vi.fn(
      (handler: (request: RequestLike, response: ResponseLike) => Promise<void> | void) => {
        state.requestListener = handler;
        return {
          once: state.onceMock,
          off: state.offMock,
          listen: state.listenMock,
          close: state.closeMock,
        };
      },
    ),
  };

  return state;
});

vi.mock("node:http", () => ({
  createServer: mockState.createServerMock,
}));

describe("SharedOAuthCallbackServer", () => {
  let callbackServer: SharedOAuthCallbackServer<OAuthCallbackHandler> | null = null;

  beforeEach(() => {
    mockState.requestListener = null;
    mockState.onceMock.mockReset();
    mockState.offMock.mockReset();
    mockState.listenMock.mockClear();
    mockState.closeMock.mockClear();
    mockState.createServerMock.mockClear();
    vi.useRealTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (callbackServer) {
      await callbackServer.stop();
      callbackServer = null;
    }
  });

  it("should reject starting before auth service is bound", async () => {
    callbackServer = new SharedOAuthCallbackServer({
      host: "127.0.0.1",
      port: 54545,
      path: "/callback",
      displayName: "Shared OAuth",
    });

    await expect(callbackServer.start()).rejects.toMatchObject({
      message: "Shared OAuth 回调服务未绑定认证服务",
    });
  });

  it("should stop listening after a successful callback", async () => {
    const authService = createAuthService();
    callbackServer = new SharedOAuthCallbackServer({
      host: "127.0.0.1",
      port: 54545,
      path: "/callback",
      displayName: "Shared OAuth",
    });
    callbackServer.setAuthService(authService);

    await callbackServer.beginAuthorizationWindow(5_000);
    const response = createResponse();

    await mockState.requestListener?.(
      { method: "GET", url: "/callback?code=code-123&state=state-123" },
      response,
    );
    await flushMicrotasks();

    expect(mockState.listenMock).toHaveBeenCalledWith(54545, "127.0.0.1", expect.any(Function));
    expect(authService.handleCallback).toHaveBeenCalledWith({
      code: "code-123",
      state: "state-123",
    });
    expect(response.writeHead).toHaveBeenCalledWith(302, {
      Location: "http://localhost:20004/auth?result=success",
    });
    expect(mockState.closeMock).toHaveBeenCalledTimes(1);
  });

  it("should stop listening after an invalid callback request", async () => {
    const authService = createAuthService();
    callbackServer = new SharedOAuthCallbackServer({
      host: "127.0.0.1",
      port: 54545,
      path: "/callback",
      displayName: "Shared OAuth",
    });
    callbackServer.setAuthService(authService);

    await callbackServer.beginAuthorizationWindow(5_000);
    const response = createResponse();

    await mockState.requestListener?.({ method: "GET", url: "/callback?code=code-123" }, response);
    await flushMicrotasks();

    expect(authService.handleCallback).not.toHaveBeenCalled();
    expect(response.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "text/plain; charset=utf-8",
    });
    expect(response.end).toHaveBeenCalledWith("Missing code or state");
    expect(mockState.closeMock).toHaveBeenCalledTimes(1);
  });

  it("should stop listening when the authorization window expires", async () => {
    const authService = createAuthService();
    callbackServer = new SharedOAuthCallbackServer({
      host: "127.0.0.1",
      port: 54545,
      path: "/callback",
      displayName: "Shared OAuth",
    });
    callbackServer.setAuthService(authService);
    vi.useFakeTimers();

    await callbackServer.beginAuthorizationWindow(20);
    await vi.advanceTimersByTimeAsync(20);

    expect(mockState.closeMock).toHaveBeenCalledTimes(1);
  });
});

function createAuthService(): OAuthCallbackHandler {
  return {
    handleCallback: vi.fn().mockResolvedValue({
      redirectUrl: "http://localhost:20004/auth?result=success",
    }),
  };
}

function createResponse(): ResponseLike {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
