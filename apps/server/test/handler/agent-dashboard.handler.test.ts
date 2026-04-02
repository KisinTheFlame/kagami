import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDashboardQueryService } from "../../src/ops/application/agent-dashboard-query.service.js";
import { AgentDashboardHandler } from "../../src/ops/http/agent-dashboard.handler.js";

describe("AgentDashboardHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should return the current agent dashboard snapshot", async () => {
    const getCurrentSnapshot = vi.fn().mockResolvedValue({
      generatedAt: "2026-03-30T08:00:00.000Z",
      agents: [
        {
          id: "root",
          label: "主 Agent",
          kind: "root",
          runtime: {
            initialized: true,
            loopState: "idle",
            lastError: null,
            lastActivityAt: "2026-03-30T08:00:00.000Z",
            lastRoundCompletedAt: null,
            lastCompactionAt: null,
          },
          session: {
            focusedStateId: "portal",
            focusedStateDisplayName: "门户",
            focusedStateDescription: "主入口",
            stateStack: [{ id: "portal", displayName: "门户" }],
            children: [],
            availableInvokeTools: [],
            waiting: {
              active: false,
              deadlineAt: null,
              resumeStateId: null,
            },
          },
          queue: {
            pendingEventCount: 0,
          },
          context: {
            messageCount: 0,
            compactionTotalTokenThreshold: 150_000,
            recentItems: [],
            recentItemsTruncated: false,
          },
          activity: {
            lastToolCall: null,
            lastToolResultPreview: null,
            lastLlmCall: null,
          },
          providers: [
            {
              id: "openai",
              models: ["gpt-4o-mini"],
            },
          ],
        },
      ],
    });
    const agentDashboardQueryService: AgentDashboardQueryService = {
      getCurrentSnapshot,
    };
    const handler = new AgentDashboardHandler({
      agentDashboardQueryService,
    });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/agent-dashboard/current",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      generatedAt: "2026-03-30T08:00:00.000Z",
      agents: [
        {
          id: "root",
          label: "主 Agent",
          kind: "root",
          runtime: {
            initialized: true,
            loopState: "idle",
            lastError: null,
            lastActivityAt: "2026-03-30T08:00:00.000Z",
            lastRoundCompletedAt: null,
            lastCompactionAt: null,
          },
          session: {
            focusedStateId: "portal",
            focusedStateDisplayName: "门户",
            focusedStateDescription: "主入口",
            stateStack: [{ id: "portal", displayName: "门户" }],
            children: [],
            availableInvokeTools: [],
            waiting: {
              active: false,
              deadlineAt: null,
              resumeStateId: null,
            },
          },
          queue: {
            pendingEventCount: 0,
          },
          context: {
            messageCount: 0,
            compactionTotalTokenThreshold: 150_000,
            recentItems: [],
            recentItemsTruncated: false,
          },
          activity: {
            lastToolCall: null,
            lastToolResultPreview: null,
            lastLlmCall: null,
          },
          providers: [
            {
              id: "openai",
              models: ["gpt-4o-mini"],
            },
          ],
        },
      ],
    });
    expect(getCurrentSnapshot).toHaveBeenCalledTimes(1);
  });
});
