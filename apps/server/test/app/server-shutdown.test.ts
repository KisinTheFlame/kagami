import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  shutdownServerResources,
  type AgentRuntimeController,
} from "../../src/app/server-shutdown.js";

type ShutdownLoggerStub = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  errorWithCause: ReturnType<typeof vi.fn>;
};

function createLoggerStub(): ShutdownLoggerStub {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithCause: vi.fn(),
  };
}

function createAgentRuntimeStub(order: string[], label: string): AgentRuntimeController {
  return {
    stop: vi.fn(async () => {
      order.push(label);
    }),
  };
}

describe("shutdownServerResources", () => {
  it("按预期顺序关闭资源，并先停 root agent 再停 story agent", async () => {
    const order: string[] = [];
    const logger = createLoggerStub();
    const app = {
      close: vi.fn(async () => {
        order.push("app.close");
      }),
    } as unknown as FastifyInstance;
    const napcatGatewayService = {
      stop: vi.fn(async () => {
        order.push("napcatGateway.stop");
      }),
    };
    const ithomePoller = {
      close: vi.fn(() => {
        order.push("ithomePoller.close");
      }),
    };
    const callbackServer = {
      stop: vi.fn(async () => {
        order.push("callbackServer.stop");
      }),
    };
    const authUsageCacheManager = {
      close: vi.fn(() => {
        order.push("authUsageCacheManager.close");
      }),
    };
    const claudeCodeAuthRefreshScheduler = {
      close: vi.fn(() => {
        order.push("claudeCodeAuthRefreshScheduler.close");
      }),
    };
    const rootAgentRuntime = createAgentRuntimeStub(order, "rootAgentRuntime.stop");
    const storyAgentRuntime = createAgentRuntimeStub(order, "storyAgentRuntime.stop");
    const closeLlmProviders = vi.fn(async () => {
      order.push("closeLlmProviders");
    });
    const closeLoggerRuntime = vi.fn(async () => {
      order.push("closeLoggerRuntime");
    });
    const closeDatabase = vi.fn(async () => {
      order.push("closeDb");
    });
    const exit = vi.fn((code: number) => {
      order.push(`exit(${code})`);
    });

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: true,
      app,
      database: {} as never,
      napcatGatewayService: napcatGatewayService as never,
      ithomePoller: ithomePoller as never,
      callbackServers: [callbackServer],
      authUsageCacheManager: authUsageCacheManager as never,
      claudeCodeAuthRefreshScheduler: claudeCodeAuthRefreshScheduler as never,
      rootAgentRuntime,
      storyAgentRuntime,
      closeLlmProviders,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(order).toEqual([
      "app.close",
      "napcatGateway.stop",
      "ithomePoller.close",
      "callbackServer.stop",
      "authUsageCacheManager.close",
      "claudeCodeAuthRefreshScheduler.close",
      "rootAgentRuntime.stop",
      "storyAgentRuntime.stop",
      "closeLlmProviders",
      "closeLoggerRuntime",
      "closeDb",
      "exit(0)",
    ]);
  });

  it("root agent 为空时仍能安全完成关停", async () => {
    const logger = createLoggerStub();
    const storyAgentRuntime = {
      stop: vi.fn(async () => {}),
    };
    const closeLoggerRuntime = vi.fn(async () => {});
    const closeDatabase = vi.fn(async () => {});
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGINT",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: {} as never,
      napcatGatewayService: null,
      ithomePoller: null,
      callbackServers: [],
      authUsageCacheManager: null,
      claudeCodeAuthRefreshScheduler: null,
      rootAgentRuntime: null,
      storyAgentRuntime,
      closeLlmProviders: null,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(storyAgentRuntime.stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("成功关停时 root agent stop 只调用一次", async () => {
    const logger = createLoggerStub();
    const rootAgentRuntime = {
      stop: vi.fn(async () => {}),
    };
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: null,
      napcatGatewayService: null,
      ithomePoller: null,
      callbackServers: [],
      authUsageCacheManager: null,
      claudeCodeAuthRefreshScheduler: null,
      rootAgentRuntime,
      storyAgentRuntime: null,
      closeLlmProviders: null,
      logger,
      closeLoggerRuntime: async () => {},
      closeDatabase: async () => {},
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(rootAgentRuntime.stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("root agent stop 失败时保持现有关停失败语义并退出 1", async () => {
    const logger = createLoggerStub();
    const rootStopError = new Error("root stop failed");
    const rootAgentRuntime = {
      stop: vi.fn(async () => {
        throw rootStopError;
      }),
    };
    const storyAgentRuntime = {
      stop: vi.fn(async () => {}),
    };
    const closeLlmProviders = vi.fn(async () => {});
    const closeLoggerRuntime = vi.fn(async () => {});
    const closeDatabase = vi.fn(async () => {});
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: {} as never,
      napcatGatewayService: null,
      ithomePoller: null,
      callbackServers: [],
      authUsageCacheManager: null,
      claudeCodeAuthRefreshScheduler: null,
      rootAgentRuntime,
      storyAgentRuntime,
      closeLlmProviders,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(rootAgentRuntime.stop).toHaveBeenCalledTimes(1);
    expect(storyAgentRuntime.stop).not.toHaveBeenCalled();
    expect(closeLlmProviders).not.toHaveBeenCalled();
    expect(closeLoggerRuntime).not.toHaveBeenCalled();
    expect(closeDatabase).not.toHaveBeenCalled();
    expect(logger.errorWithCause).toHaveBeenCalledWith("Shutdown failed", rootStopError, {
      event: "server.shutdown.failed",
      signal: "SIGTERM",
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
