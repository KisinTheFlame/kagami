import { describe, expect, it, vi } from "vitest";
import { DefaultAppLogQueryService } from "../../src/ops/application/app-log-query.impl.service.js";
import type { ObservatoryLogQueryClient } from "../../src/ops/application/app-log-query.impl.service.js";

describe("DefaultAppLogQueryService", () => {
  it("把 service 维度一路转发给 observatory，并装进 console 的分页信封", async () => {
    const queryLogs = vi.fn().mockResolvedValue({
      total: 7,
      items: [
        {
          id: 1,
          service: "napcat",
          traceId: "trace-1",
          level: "warn" as const,
          message: "gateway reconnecting",
          metadata: { source: "napcat.gateway" },
          createdAt: "2026-07-29T00:00:00.000Z",
        },
      ],
    });
    const client: ObservatoryLogQueryClient = { queryLogs };
    const service = new DefaultAppLogQueryService({ observatoryLogQueryClient: client });

    const result = await service.queryList({
      page: 2,
      pageSize: 20,
      service: "napcat",
      level: "warn",
      source: "gateway",
    });

    expect(queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "napcat",
        level: "warn",
        source: "gateway",
        page: 2,
        pageSize: 20,
      }),
    );
    expect(result.pagination).toEqual({ page: 2, pageSize: 20, total: 7 });
    expect(result.items[0]?.service).toBe("napcat");
  });

  it("未给 service 时不伪造默认值：过滤条件原样透传 undefined", async () => {
    const queryLogs = vi.fn().mockResolvedValue({ total: 0, items: [] });
    const service = new DefaultAppLogQueryService({
      observatoryLogQueryClient: { queryLogs },
    });

    await service.queryList({ page: 1, pageSize: 20 });

    expect(queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ service: undefined, level: undefined }),
    );
  });
});
