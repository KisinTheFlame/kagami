import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadOssConfig } from "./config/config.js";
import { buildOssApp } from "./http/server.js";
import { ObjectStore } from "./store/object-store.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadOssConfig();

mkdirSync(path.dirname(config.dbPath), { recursive: true });
mkdirSync(config.blobDir, { recursive: true });

const db = new Database(config.dbPath);
const store = new ObjectStore({ db, blobDir: config.blobDir });

const swept = await store.sweepOrphans();
if (swept.removed > 0) {
  console.log(`[oss] swept ${swept.removed} orphan blob file(s) on startup`);
}

const app = buildOssApp(store, config.maxBodyBytes);

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[oss] ${signal} received, shutting down`);
  const finish = (): void => {
    db.close();
    process.exit(0);
  };
  void app.close().then(finish, finish);
  setTimeout(finish, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});

await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`[oss] listening on 127.0.0.1:${config.port} (pid ${process.pid})`);
