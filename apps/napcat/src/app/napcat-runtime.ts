import type { FastifyInstance } from "fastify";
import { DefaultConfigManager } from "@kagami/kernel/config/config.impl.manager";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { configureSqlite, createDbClient, type Database } from "../infra/db/client.js";
import { migrateFromLegacyDb } from "../infra/db/legacy-migration.js";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { HttpLlmClient } from "../acl/http-llm-client.js";
import { PrismaNapcatEventDao } from "../infra/impl/napcat-event.impl.dao.js";
import { PrismaNapcatQqMessageDao } from "../infra/impl/napcat-group-message.impl.dao.js";
import { DefaultNapcatGatewayService } from "../application/napcat-gateway.impl.service.js";
import type { NapcatGatewayService } from "../application/napcat-gateway.service.js";
import { NapcatEventPersistenceWriter } from "../application/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatImageMessageAnalyzer } from "../application/napcat-gateway/image-message-analyzer.js";
import { NapcatEventBroadcaster } from "../application/napcat-event-broadcaster.js";
import { VisionAgent } from "../vision/application/vision-agent.js";
import { HttpOssClient } from "../acl/oss-client.js";
import { PrismaImageAssetDao } from "../infra/impl/image-asset.impl.dao.js";
import { PrismaNapcatEventOutboxDao } from "../infra/impl/napcat-event-outbox.impl.dao.js";
import { NapcatHandler } from "../http/napcat.handler.js";
import { NapcatEventsHandler } from "../http/napcat-events.handler.js";
import { NapcatQueryHandler } from "../http/napcat-query.handler.js";
import type { NapcatAgentEvent } from "@kagami/napcat-api/event";
import type { NapcatEventOutboxDao } from "../infra/napcat-event-outbox.dao.js";

const logger = new AppLogger({ source: "napcat-bootstrap" });

/**
 * 数据保留窗口（7 天）+ prune 周期（每小时）。均为代码常量，不进 config。
 * outbox 原生在此清理；napcat_event / napcat_qq_message 的保留清理随表迁库（epic #539
 * 子 issue 2）从 agent 的 data-retention 迁入本进程，窗口沿用原 7 天不变。
 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Fastify 默认 bodyLimit 1 MB 远不够：send_resource 发图经 `/napcat/image/send` 以 `base64://` 内联
 * 整图字节（自包含、不依赖 napcat 访问 OSS），一张图上限是 agent 侧 resource.maxBytes（4 MiB），base64
 * 膨胀 ~4/3 后约 5.5 MiB，加 JSON 信封仍需 6 MiB 以上。取 16 MiB 留足头（也覆盖 resource cap 未来上调）。
 * 不设的话 pixel/browser 小图能发、生图等大图一律 413（issue #508 上线后发现）。
 */
const NAPCAT_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

/**
 * outbox append 的重试：outbox 是入站事件的 durability 边界，append 失败 = 事件丢（replay 也救不回，
 * 因为根本没落库）。SQLite WAL 多写进程下偶发 SQLITE_BUSY（busy_timeout 内没抢到锁），这里再补几次
 * 重试兜底，彻底失败才让异常冒泡（调用方升级为 error 日志，不静默）。
 */
const OUTBOX_APPEND_MAX_ATTEMPTS = 4;
const OUTBOX_APPEND_RETRY_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function appendOutboxWithRetry(
  outboxDao: NapcatEventOutboxDao,
  event: NapcatAgentEvent,
): Promise<number> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OUTBOX_APPEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await outboxDao.append(event);
    } catch (error) {
      lastError = error;
      if (attempt < OUTBOX_APPEND_MAX_ATTEMPTS) {
        logger.warn("outbox append 失败，重试中", {
          event: "napcat.outbox.append_retry",
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        await delay(OUTBOX_APPEND_RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

export type NapcatRuntime = {
  app: FastifyInstance;
  database: Database;
  gateway: NapcatGatewayService;
  port: number;
  /** 停 prune 定时器。 */
  stopPrune: () => void;
  /** 结束所有活 SSE 连接（关停 teardown，避免 app.close 挂 keep-alive 长连接）。 */
  closeSubscribers: () => void;
};

/**
 * kagami-napcat 进程运行时装配（issue #347）。独立 PM2 进程持有到 NapCat 的 WS 长连接，agent
 * 重启不打断它。入站事件（vision 描述 + resid 已在本进程算好）先落 outbox 拿 seq 再经 SSE 广播给
 * agent；出站 RPC 经 napcat-api 契约暴露。vision 拨 kagami-llm、存图拨 kagami-oss。
 */
export async function buildNapcatRuntime(): Promise<NapcatRuntime> {
  const loadedConfig = await loadStaticConfig();
  const configManager = new DefaultConfigManager({ config: loadedConfig });
  const config = await configManager.config();

  // napcat 独占库（epic #539 子 issue 2）：napcat_event / napcat_qq_message / outbox /
  // image_asset 落 services.napcat.databaseUrl，主库 kagami.db 不再被本进程长期打开——
  // 仅启动瞬间由 migrateFromLegacyDb 开一条只读连接做一次性历史搬迁（幂等，搬完即关）。
  migrateFromLegacyDb({
    napcatDatabaseUrl: config.services.napcat.databaseUrl,
    legacyDatabaseUrl: config.server.databaseUrl,
  });
  const database = createDbClient({ databaseUrl: config.services.napcat.databaseUrl });
  await configureSqlite(database);

  const napcatEventDao = new PrismaNapcatEventDao({ database });
  const napcatQqMessageDao = new PrismaNapcatQqMessageDao({ database });
  const imageAssetDao = new PrismaImageAssetDao({ database });
  const outboxDao = new PrismaNapcatEventOutboxDao({ database });

  // vision 拨独立 kagami-llm 进程；存图拨独立 kagami-oss 进程（server.oss 未启用则不存档，resid 恒 null）。
  const llmClient = new HttpLlmClient({
    baseUrl: `http://${config.services.llm.host}:${config.services.llm.port}`,
  });
  const visionAgent = new VisionAgent({ llmClient });
  const ossClient = config.server.oss?.enabled
    ? new HttpOssClient({
        baseUrl: `http://${config.services.oss.host}:${config.services.oss.port}`,
      })
    : undefined;

  const imageMessageAnalyzer = new DefaultNapcatImageMessageAnalyzer({
    visionAgent,
    ossClient,
    imageAssetDao,
  });
  const persistenceWriter = new NapcatEventPersistenceWriter({
    napcatEventDao,
    napcatQqMessageDao,
  });

  const broadcaster = new NapcatEventBroadcaster();
  // 入站事件的咽喉：先落 outbox（单条原子 INSERT）拿单调 seq，再实时广播（严格 at-least-once）。
  // 崩溃只会发生在「已落库未广播」→ 重连回放兜底，永不丢。
  // 串行化（append 链）：并发入站事件（vision 时延导致处理乱序）的 append 严格按调用顺序落库，
  // seq 单调且广播不乱序——不依赖底层驱动是否同步。这条链是「落 outbox → 广播」的原子有序边界，
  // 上游 flush 的有序调用与它接续。
  let outboxAppendChain: Promise<unknown> = Promise.resolve();
  const enqueueEvent = (event: NapcatAgentEvent): Promise<number> => {
    const task = outboxAppendChain.then(async () => {
      const seq = await appendOutboxWithRetry(outboxDao, event);
      broadcaster.publish({ seq, event });
      return seq;
    });
    outboxAppendChain = task.catch(() => undefined);
    return task;
  };
  const gateway = await DefaultNapcatGatewayService.create({
    configManager,
    enqueueGroupMessageEvent: enqueueEvent,
    persistenceWriter,
    imageMessageAnalyzer,
    qqMessageDao: napcatQqMessageDao,
  });

  const app = createServiceApp({
    logger,
    handlers: [
      new HealthHandler(),
      new NapcatHandler({ gateway }),
      new NapcatEventsHandler({ broadcaster, outboxDao }),
      new NapcatQueryHandler({ napcatEventDao, napcatQqMessageDao }),
    ],
    fastifyOptions: { bodyLimit: NAPCAT_BODY_LIMIT_BYTES },
  });

  // 保留清理：每小时删掉超窗口的旧行。outbox（保留窗口 > 任何现实停机时长即可安全回放）+
  // napcat_event / napcat_qq_message（原 agent data-retention 的清理面，随表迁入本进程）。
  // 三路串行执行避免同刻叠加写放大；单路失败不阻断其余，删除行数记 info 供保留面观测。
  const runPrune = async (): Promise<void> => {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const tasks: [string, string, () => Promise<number>][] = [
      ["napcat_event_outbox", "napcat.outbox.prune", () => outboxDao.pruneOlderThan(cutoff)],
      [
        "napcat_event",
        "napcat.retention.event_prune",
        () => napcatEventDao.deleteOlderThan(cutoff),
      ],
      [
        "napcat_qq_message",
        "napcat.retention.qq_message_prune",
        () => napcatQqMessageDao.deleteOlderThan(cutoff),
      ],
    ];
    for (const [table, event, run] of tasks) {
      try {
        const deleted = await run();
        if (deleted > 0) {
          logger.info("保留清理完成", { event: `${event}_done`, table, deleted });
        }
      } catch (error) {
        logger.errorWithCause("保留清理失败", error, { event: `${event}_failed`, table });
      }
    }
  };
  const pruneTimer = setInterval(() => {
    void runPrune();
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();

  return {
    app,
    database,
    gateway,
    port: config.services.napcat.port,
    stopPrune: () => clearInterval(pruneTimer),
    closeSubscribers: () => broadcaster.closeAll(),
  };
}
