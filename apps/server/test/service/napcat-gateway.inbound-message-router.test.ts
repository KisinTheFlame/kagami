import { beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatGatewayInboundMessageRouter } from "../../src/napcat/service/napcat-gateway/inbound-message-router.js";
import { initTestLogger } from "./napcat-gateway.test-helper.js";

describe("NapcatGatewayInboundMessageRouter", () => {
  let logs = initTestLogger();

  beforeEach(() => {
    logs = initTestLogger();
  });

  it("should route action responses to resolver", () => {
    const resolveActionResponse = vi.fn();
    const handlePostTypeEvent = vi.fn();
    const router = new NapcatGatewayInboundMessageRouter({
      resolveActionResponse,
      handlePostTypeEvent,
    });

    router.handle(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: { message_id: 1 },
        echo: "echo-1",
      }),
    );

    expect(resolveActionResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        echo: "echo-1",
      }),
    );
    expect(handlePostTypeEvent).not.toHaveBeenCalled();
  });

  it("should route post type events to handler", async () => {
    const resolveActionResponse = vi.fn();
    const handlePostTypeEvent = vi.fn().mockResolvedValue(undefined);
    const router = new NapcatGatewayInboundMessageRouter({
      resolveActionResponse,
      handlePostTypeEvent,
    });

    router.handle(
      JSON.stringify({
        post_type: "message",
        message_type: "private",
        user_id: 123456,
      }),
    );
    await Promise.resolve();

    expect(handlePostTypeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        post_type: "message",
        message_type: "private",
      }),
    );
    expect(resolveActionResponse).not.toHaveBeenCalled();
  });

  it("should log parse failures", () => {
    const router = new NapcatGatewayInboundMessageRouter({
      resolveActionResponse: vi.fn(),
      handlePostTypeEvent: vi.fn().mockResolvedValue(undefined),
    });

    router.handle("{invalid-json");

    expect(logs.some(log => log.metadata.event === "napcat.gateway.message_parse_failed")).toBe(
      true,
    );
  });

  it("should log non-string messages", () => {
    const router = new NapcatGatewayInboundMessageRouter({
      resolveActionResponse: vi.fn(),
      handlePostTypeEvent: vi.fn().mockResolvedValue(undefined),
    });

    router.handle({ raw: "data" });

    expect(logs.some(log => log.metadata.event === "napcat.gateway.message_non_string")).toBe(true);
  });
});
