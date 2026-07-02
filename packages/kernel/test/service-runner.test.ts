import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { runService, type ServiceHandle } from "../src/http/service-runner.js";

// runService 是六个卫星服务共用的进程启动器（issue #274）：这里用捕获式 process.on spy
// 把信号/崩溃 handler 截在测试内（不真挂到进程上），mock 掉 process.exit，驱动并断言
// 关停顺序（beforeClose → app.close → cleanup）、二次信号幂等、启动失败的尽力清理。

type Handler = (...args: unknown[]) => void;

function interceptProcess() {
  const handlers = new Map<string, Handler>();
  vi.spyOn(process, "on").mockImplementation(((event: string, handler: Handler) => {
    handlers.set(event, handler);
    return process;
  }) as never);
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  return { handlers, exitSpy };
}

function fakeApp(order: string[], { failListen = false } = {}): FastifyInstance {
  return {
    close: vi.fn(async () => {
      order.push("close");
    }),
    listen: vi.fn(async () => {
      if (failListen) {
        throw new Error("EADDRINUSE");
      }
    }),
  } as unknown as FastifyInstance;
}

describe("runService", () => {
  it("SIGTERM：beforeClose → app.close → cleanup 依序执行后 exit(0)；二次信号幂等", async () => {
    const { handlers, exitSpy } = interceptProcess();
    const order: string[] = [];
    const app = fakeApp(order);
    const handle: ServiceHandle = {
      app,
      bindHost: "127.0.0.1",
      port: 1,
      beforeClose: [
        () => {
          order.push("before");
        },
      ],
      cleanup: [
        () => {
          order.push("cleanup");
        },
      ],
    };

    runService({ name: "svc", source: "svc-test", build: () => Promise.resolve(handle) });
    await vi.waitFor(() => {
      expect(app.listen).toHaveBeenCalled();
    });

    handlers.get("SIGTERM")!("SIGTERM");
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
    expect(order).toEqual(["before", "close", "cleanup"]);

    handlers.get("SIGTERM")!("SIGTERM");
    handlers.get("SIGINT")!("SIGINT");
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("listen 失败：尽力跑完全部清理步骤（单步抛错不阻断）后 exit(1)，随后信号短路", async () => {
    const { handlers, exitSpy } = interceptProcess();
    const order: string[] = [];
    const app = fakeApp(order, { failListen: true });
    const handle: ServiceHandle = {
      app,
      bindHost: "127.0.0.1",
      port: 1,
      cleanup: [
        () => {
          order.push("cleanup-1");
          throw new Error("cleanup boom");
        },
        () => {
          order.push("cleanup-2");
        },
      ],
    };

    runService({ name: "svc", source: "svc-test", build: () => Promise.resolve(handle) });
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
    expect(order).toEqual(["cleanup-1", "cleanup-2"]);

    // 启动失败清理已置位关停闸：信号不再触发第二轮 close/cleanup。
    handlers.get("SIGTERM")!("SIGTERM");
    expect(app.close).not.toHaveBeenCalled();
    expect(order).toEqual(["cleanup-1", "cleanup-2"]);
  });

  it("全局崩溃兜底已注册：uncaughtException/unhandledRejection → exit(1)", async () => {
    const { handlers, exitSpy } = interceptProcess();
    const order: string[] = [];
    const handle: ServiceHandle = { app: fakeApp(order), bindHost: "127.0.0.1", port: 1 };

    runService({ name: "svc", source: "svc-test", build: () => Promise.resolve(handle) });

    handlers.get("uncaughtException")!(new Error("crash"));
    expect(exitSpy).toHaveBeenCalledWith(1);
    handlers.get("unhandledRejection")!("reason");
    expect(exitSpy).toHaveBeenCalledTimes(2);
  });
});
