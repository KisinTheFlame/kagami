import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// gateway 的静态资源装配步：把 @kagami/web 的构建产物拷进 gateway 自己的 dist/public，
// 让运行时只读自身目录、不再跨 app 伸手去 apps/web/dist（见 issue #496）。
// 拓扑构建（pnpm -r build / pnpm --filter "@kagami/gateway..." build）保证 web 先于 gateway 构建，
// 故此处 web/dist 必存在；缺失即响亮失败，不静默产出一个没有前端的 gateway。
const scriptDir = dirname(fileURLToPath(import.meta.url));
const gatewayDir = resolve(scriptDir, "..");
const webDist = resolve(gatewayDir, "..", "web", "dist");
const targetDir = resolve(gatewayDir, "dist", "public");

if (!existsSync(webDist)) {
  console.error(
    `[kagami-gateway] 找不到前端产物 ${webDist}，请先构建 @kagami/web（pnpm -r build 会按拓扑先构建它）。`,
  );
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(dirname(targetDir), { recursive: true });
cpSync(webDist, targetDir, { recursive: true });
