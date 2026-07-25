import { mkdirSync } from "node:fs";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { runService } from "@kagami/kernel/http/service-runner";
import { loadOssConfig } from "./config/config.js";
import { createDbClient, configureSqlite, closeDb } from "./infra/db/client.js";
import { buildOssApp } from "./http/server.js";
import { ObjectStore } from "./store/object-store.js";

const logger = new AppLogger({ source: "oss-bootstrap" });

// kagami-oss 进程：自建对象存储，Prisma（better-sqlite3 adapter）独占库 + blob 目录。日志只走
// stdout（同其余卫星进程），由 PM2 的 oss-out.log 承载。
runService({
  name: "oss",
  source: "oss-bootstrap",
  build: async () => {
    const config = loadOssConfig();

    mkdirSync(config.blobDir, { recursive: true });

    const db = createDbClient({ databaseUrl: config.databaseUrl });
    await configureSqlite(db);
    const store = new ObjectStore({ db, blobDir: config.blobDir });

    const swept = await store.sweepOrphans();
    if (swept.removed > 0) {
      logger.info("Swept orphan blob files on startup", {
        event: "oss.sweep_orphans",
        removed: swept.removed,
      });
    }

    return {
      app: buildOssApp(store, config.maxBodyBytes),
      // 仅绑 127.0.0.1：对象存储只供本机 agent 调用，绝不对外网卡开放。
      bindHost: "127.0.0.1",
      port: config.port,
      cleanup: [
        async () => {
          await closeDb(db);
        },
      ],
    };
  },
});
