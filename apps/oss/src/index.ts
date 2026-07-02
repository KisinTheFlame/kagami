import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { runService } from "@kagami/kernel/http/service-runner";
import { loadOssConfig } from "./config/config.js";
import { buildOssApp } from "./http/server.js";
import { ObjectStore } from "./store/object-store.js";

const logger = new AppLogger({ source: "oss-bootstrap" });

// kagami-oss 进程：自建对象存储，裸 better-sqlite3 + blob 目录。日志只走 stdout（同其余
// 卫星进程），由 PM2 的 oss-out.log 承载。
runService({
  name: "oss",
  source: "oss-bootstrap",
  build: async () => {
    const config = loadOssConfig();

    mkdirSync(path.dirname(config.dbPath), { recursive: true });
    mkdirSync(config.blobDir, { recursive: true });

    const db = new Database(config.dbPath);
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
        () => {
          db.close();
        },
      ],
    };
  },
});
