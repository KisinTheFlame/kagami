import { describe, expect, it, vi } from "vitest";
import type { MetricClient } from "@kagami/metric-client/client";
import type { SchedulerTaskRegistration, SchedulerTick } from "@kagami/scheduler-client/types";
import { buildLlmBlobGcTask } from "../src/app/llm-blob-gc-task.js";
import { PrismaLlmChatCallDao } from "../src/infra/impl/llm-chat-call.impl.dao.js";
import { InMemoryChatCallTable, InMemoryLlmBlobDao } from "./helpers.js";

const HOUR_MS = 3_600_000;

const TICK: SchedulerTick = {
  taskName: "llm:gc-blobs",
  occurrenceId: "occ-1",
  scheduledAt: "2026-08-18T00:10:00.000Z",
  emittedAt: "2026-08-18T00:10:00.000Z",
  manual: false,
};

/** handler 的返回值类型是 `TaskRunMetadata | void`；GC 一定返回统计，这里收窄掉 void 分支。 */
async function runGc(
  task: SchedulerTaskRegistration,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const metadata = await task.handler(signal, TICK);
  if (metadata === undefined) {
    throw new Error("[test] GC handler 应当返回统计元数据");
  }

  return metadata;
}

function createMetricService(): MetricClient & { record: ReturnType<typeof vi.fn> } {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as MetricClient & {
    record: ReturnType<typeof vi.fn>;
  };
}

async function seedCall(
  dao: PrismaLlmChatCallDao,
  requestId: string,
  messages: unknown[],
): Promise<void> {
  await dao.recordSuccess({
    provider: "claude-code",
    model: "claude-opus-4-6",
    latencyMs: 1,
    requestId,
    seq: 1,
    request: { system: "你是小镜", tools: [], toolChoice: "auto", messages },
    response: { ok: true },
  });
}

/** 让所有已存在的 blob 看起来是一个宽限窗口以前用过的，好让它们进入回收候选。 */
function ageAllBlobs(blobDao: InMemoryLlmBlobDao): void {
  const old = new Date(Date.now() - 2 * HOUR_MS);
  for (const id of blobDao.liveIds) {
    blobDao.setLastUsedAt(id, old);
  }
}

describe("buildLlmBlobGcTask — 孤儿 blob 回收（#612）", () => {
  it("被引用的 blob 一个都不删，孤儿全删", async () => {
    const blobDao = new InMemoryLlmBlobDao();
    const table = new InMemoryChatCallTable();
    const chatCallDao = new PrismaLlmChatCallDao({ database: table.asDatabase(), blobDao });

    await seedCall(chatCallDao, "req-1", [{ role: "user", content: "留下" }]);
    const liveIds = blobDao.liveIds;
    // 造几个没有任何行引用的孤儿。
    await blobDao.resolveIds([Buffer.from("孤儿 A"), Buffer.from("孤儿 B")]);
    ageAllBlobs(blobDao);

    const metricService = createMetricService();
    const task = buildLlmBlobGcTask({ chatCallDao, blobDao, metricService });
    const result = await runGc(task, new AbortController().signal);

    expect(result.deletedRows).toBe(2);
    expect(blobDao.liveIds.sort()).toEqual(liveIds.sort());
    // 还原详情仍然成立，说明没删到在用的。
    await expect(chatCallDao.findById(1)).resolves.not.toBeNull();
  });

  it("宽限窗口内的孤儿不删（挡住「blob 已写、行还没写」的在途窗口）", async () => {
    const blobDao = new InMemoryLlmBlobDao();
    const table = new InMemoryChatCallTable();
    const chatCallDao = new PrismaLlmChatCallDao({ database: table.asDatabase(), blobDao });

    // 刚写入、还没有任何行引用：正是在途写入的样子。
    await blobDao.resolveIds([Buffer.from("刚写进来的")]);

    const metricService = createMetricService();
    const result = await runGc(
      buildLlmBlobGcTask({ chatCallDao, blobDao, metricService }),
      new AbortController().signal,
    );

    expect(result.deletedRows).toBe(0);
    expect(blobDao.size).toBe(1);
  });

  it("mark 之后被重新引用的老 blob 因为续期而逃过回收，不会留下悬挂引用", async () => {
    const blobDao = new InMemoryLlmBlobDao();
    const table = new InMemoryChatCallTable();
    const chatCallDao = new PrismaLlmChatCallDao({ database: table.asDatabase(), blobDao });

    // 一个很久没人引用的老 blob（模拟 retention 把引用它的行都删光之后的 system prompt）。
    const { ids } = await blobDao.resolveIds([Buffer.from("你是小镜")]);
    const systemBlobId = ids[0]!;
    ageAllBlobs(blobDao);

    // 新调用复用它 —— 内容寻址会命中同一个 id，并顺手续期。
    await seedCall(chatCallDao, "req-1", [{ role: "user", content: "新的一轮" }]);
    expect(blobDao.liveIds).toContain(systemBlobId);

    const metricService = createMetricService();
    await runGc(
      buildLlmBlobGcTask({ chatCallDao, blobDao, metricService }),
      new AbortController().signal,
    );

    expect(blobDao.liveIds).toContain(systemBlobId);
    await expect(chatCallDao.findById(1)).resolves.not.toBeNull();
  });

  it("mark 阶段被中止时一行都不删（live 集合不完整，宁可不删）", async () => {
    const blobDao = new InMemoryLlmBlobDao();
    const table = new InMemoryChatCallTable();
    const chatCallDao = new PrismaLlmChatCallDao({ database: table.asDatabase(), blobDao });

    await seedCall(chatCallDao, "req-1", [{ role: "user", content: "x" }]);
    await blobDao.resolveIds([Buffer.from("孤儿")]);
    ageAllBlobs(blobDao);

    const controller = new AbortController();
    controller.abort();
    const metricService = createMetricService();
    const result = await runGc(
      buildLlmBlobGcTask({ chatCallDao, blobDao, metricService }),
      controller.signal,
    );

    expect(result.deletedRows).toBe(0);
    expect(result.aborted).toBe(true);
  });

  it("回收量按入库字节累加并打点", async () => {
    const blobDao = new InMemoryLlmBlobDao();
    const table = new InMemoryChatCallTable();
    const chatCallDao = new PrismaLlmChatCallDao({ database: table.asDatabase(), blobDao });

    await blobDao.resolveIds([Buffer.from("孤儿 A"), Buffer.from("孤儿 B")]);
    ageAllBlobs(blobDao);

    const metricService = createMetricService();
    const result = await runGc(
      buildLlmBlobGcTask({ chatCallDao, blobDao, metricService }),
      new AbortController().signal,
    );

    expect(result.deletedRows).toBe(2);
    expect(result.reclaimedBytes).toBeGreaterThan(0);
    expect(metricService.record).toHaveBeenCalledWith(
      expect.objectContaining({ metricName: "llm.blob.gc.deleted_rows", value: 2 }),
    );
    expect(metricService.record).toHaveBeenCalledWith(
      expect.objectContaining({ metricName: "llm.blob.gc.reclaimed_bytes" }),
    );
  });

  it("排在 data-retention（00:05）之后触发，且重叠时跳过", () => {
    const task = buildLlmBlobGcTask({
      chatCallDao: new PrismaLlmChatCallDao({
        database: new InMemoryChatCallTable().asDatabase(),
        blobDao: new InMemoryLlmBlobDao(),
      }),
      blobDao: new InMemoryLlmBlobDao(),
      metricService: createMetricService(),
    });

    expect(task.name).toBe("llm:gc-blobs");
    expect(task.schedule).toEqual({ kind: "cron", expression: "10 0 * * *" });
    expect(task.overlap).toBe("skip");
  });
});
