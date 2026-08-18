import type { MetricClient } from "@kagami/metric-client/client";
import type { SchedulerTaskRegistration } from "@kagami/scheduler-client/types";
import type { TaskRunMetadata } from "@kagami/scheduler-client/task-run";
import { unpackRefs } from "./llm-payload-codec.js";
import { parseRequestSkeleton } from "./llm-request-payload.js";
import type { LlmBlobDao } from "../infra/llm-blob.dao.js";
import type { LlmChatCallDao } from "../infra/llm-chat-call.dao.js";

/**
 * `llm_blob` 的每日 mark-sweep 回收（issue #612）。
 *
 * **为什么不做 refcount**：refcount 要与 retention 的分块删耦合（删行前得先读回引用再逐个减一），
 * 且计数一旦漂移不会自愈。mark-sweep 每天从事实重算，是自愈的；当前量级（数千行 × 数千 blob）
 * 一次全扫的成本可以忽略。
 *
 * **live 集合永远不进 SQL**：在进程内存里聚成 Set，再用 id 游标翻页扫 `llm_blob` 在 JS 侧筛。
 * 若把 live 集合塞进 `NOT IN (...)`，几千个绑定变量会直接撞 SQLite 上限。
 *
 * **1 小时宽限窗口按 `lastUsedAt` 算**，不是按 `createdAt`。两个窗口它都要堵：
 * (a) blob 先写、行后写之间的毫秒级在途窗口；(b) 被 retention 清空引用的老 blob 在 mark 之后、
 * sweep 之前被新调用重新引用——只看 live 集合会把它删掉，留下永远 500 的详情页。命中即续期
 * （节流 10 分钟）让这类 blob 的 `lastUsedAt` 始终新于窗口，永远进不了候选。被误判的代价只是
 * 「本轮不删，明天再删」。
 */

const PAGE_SIZE = 5_000;
const GRACE_MS = 3_600_000;

type LlmBlobGcTaskDeps = {
  chatCallDao: LlmChatCallDao;
  blobDao: LlmBlobDao;
  metricService: MetricClient;
};

export function buildLlmBlobGcTask({
  chatCallDao,
  blobDao,
  metricService,
}: LlmBlobGcTaskDeps): SchedulerTaskRegistration {
  return {
    name: "llm:gc-blobs",
    // 排在 data-retention:llm_chat_call（00:05）之后：先删行，再回收随之变成孤儿的 blob。
    schedule: { kind: "cron", expression: "10 0 * * *" },
    misfire: "drop", // 漏一次无害，次日全量兜住（每轮删的是"当前所有孤儿"，不依赖单次触发）
    overlap: "skip",
    handler: async (signal: AbortSignal): Promise<TaskRunMetadata> => {
      // mark 中途被 abort 会得到不完整的 live 集合——下面的 sweep 循环同样以 !signal.aborted
      // 开条件，因此那种情况下一行都不会删。顺序不能反。
      const liveBlobIds = await collectLiveBlobIds(chatCallDao, signal);

      // 阈值在 sweep 开始时取，而不是 mark 之前：mark 期间被引用的 blob 也已续期，一并排除。
      const usedBefore = new Date(Date.now() - GRACE_MS);
      let afterId = 0;
      let deletedRows = 0;
      let reclaimedBytes = 0;
      let scannedBlobs = 0;

      while (!signal.aborted) {
        const candidates = await blobDao.listGcCandidates({
          afterId,
          usedBefore,
          limit: PAGE_SIZE,
        });
        if (candidates.length === 0) {
          break;
        }

        scannedBlobs += candidates.length;
        afterId = candidates[candidates.length - 1]?.id ?? afterId;

        const orphans = candidates.filter(candidate => !liveBlobIds.has(candidate.id));
        if (orphans.length > 0) {
          deletedRows += await blobDao.deleteByIds(orphans.map(orphan => orphan.id));
          reclaimedBytes += orphans.reduce((sum, orphan) => sum + orphan.storedBytes, 0);
        }

        await new Promise(resolve => setImmediate(resolve));

        if (candidates.length < PAGE_SIZE) {
          break;
        }
      }

      await metricService.record({
        metricName: "llm.blob.gc.deleted_rows",
        value: deletedRows,
      });
      await metricService.record({
        metricName: "llm.blob.gc.reclaimed_bytes",
        value: reclaimedBytes,
      });

      return {
        deletedRows,
        reclaimedBytes,
        scannedBlobs,
        liveBlobs: liveBlobIds.size,
        aborted: signal.aborted,
      };
    },
  };
}

async function collectLiveBlobIds(
  chatCallDao: LlmChatCallDao,
  signal: AbortSignal,
): Promise<Set<number>> {
  const live = new Set<number>();
  let afterId = 0;

  while (!signal.aborted) {
    const rows = await chatCallDao.listRefPage({ afterId, limit: PAGE_SIZE });
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      for (const blobId of unpackRefs(row.messageRefs)) {
        live.add(blobId);
      }
      const skeleton = parseRequestSkeleton(row.requestSkeleton);
      if (skeleton.systemBlobId !== null) {
        live.add(skeleton.systemBlobId);
      }
      if (skeleton.toolsBlobId !== null) {
        live.add(skeleton.toolsBlobId);
      }
    }

    afterId = rows[rows.length - 1]?.id ?? afterId;
    await new Promise(resolve => setImmediate(resolve));

    if (rows.length < PAGE_SIZE) {
      break;
    }
  }

  return live;
}
