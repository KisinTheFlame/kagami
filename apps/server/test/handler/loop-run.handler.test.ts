import Fastify from "fastify";
import type { LoopRunDetailResponse } from "@kagami/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LoopRunHandler } from "../../src/handler/loop-run.handler.js";
import type { LoopRunQueryService } from "../../src/service/loop-run-query.service.js";

describe("LoopRunHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should return loop run detail via injected service", async () => {
    const result: LoopRunDetailResponse = {
      id: "loop-1",
      status: "success",
      startedAt: "2026-03-23T01:00:00.000Z",
      finishedAt: "2026-03-23T01:00:05.000Z",
      durationMs: 5000,
      groupId: "123456",
      trigger: {
        messageId: 1001,
        groupId: "123456",
        userId: "654321",
        nickname: "测试用户",
        rawMessage: "hello",
        messageSegments: [],
        eventTime: "2026-03-23T01:00:00.000Z",
      },
      summary: {
        llmCallCount: 1,
        toolCallCount: 1,
        toolSuccessCount: 1,
        toolFailureCount: 0,
      },
      timeline: [
        {
          id: "1",
          seq: 0,
          type: "trigger_message",
          title: "触发消息",
          status: "success",
          startedAt: "2026-03-23T01:00:00.000Z",
          finishedAt: "2026-03-23T01:00:00.000Z",
          durationMs: 0,
          trigger: {
            messageId: 1001,
            groupId: "123456",
            userId: "654321",
            nickname: "测试用户",
            rawMessage: "hello",
            messageSegments: [],
            eventTime: "2026-03-23T01:00:00.000Z",
          },
        },
      ],
      raw: {
        triggerPayload: {},
        steps: [],
      },
    };
    let receivedId: string | null = null;
    const loopRunQueryService: LoopRunQueryService = {
      async getDetail(id) {
        receivedId = id;
        return result;
      },
      async queryList() {
        throw new Error("not implemented");
      },
    };

    new LoopRunHandler({ loopRunQueryService }).register(app);

    const response = await app.inject({
      method: "GET",
      url: "/loop-run/loop-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "loop-1",
      status: "success",
    });
    expect(receivedId).toBe("loop-1");
  });

  it("should query loop run list via injected service", async () => {
    let receivedQuery: unknown = null;
    const loopRunQueryService: LoopRunQueryService = {
      async getDetail() {
        throw new Error("not implemented");
      },
      async queryList(query) {
        receivedQuery = query;
        return {
          pagination: {
            page: 1,
            pageSize: 20,
            total: 1,
          },
          items: [
            {
              id: "loop-1",
              status: "success",
              groupId: "123456",
              startedAt: "2026-03-23T01:00:00.000Z",
              finishedAt: "2026-03-23T01:00:05.000Z",
              durationMs: 5000,
              trigger: {
                messageId: 1001,
                groupId: "123456",
                userId: "654321",
                nickname: "测试用户",
                rawMessage: "hello",
                messageSegments: [],
                eventTime: "2026-03-23T01:00:00.000Z",
              },
              summary: {
                llmCallCount: 1,
                toolCallCount: 1,
                toolSuccessCount: 1,
                toolFailureCount: 0,
              },
            },
          ],
        };
      },
    };

    new LoopRunHandler({ loopRunQueryService }).register(app);

    const response = await app.inject({
      method: "GET",
      url: "/loop-run/query?page=1&pageSize=20&status=success&groupId=123456",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      pagination: {
        total: 1,
      },
      items: [
        {
          id: "loop-1",
        },
      ],
    });
    expect(receivedQuery).toEqual({
      page: 1,
      pageSize: 20,
      status: "success",
      groupId: "123456",
    });
  });
});
