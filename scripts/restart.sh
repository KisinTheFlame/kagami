#!/usr/bin/env bash
set -euo pipefail

# 单独重建并重载某一个服务进程，不动其它进程、不跑 Prisma 迁移。
# 用途：只改了某个服务时（如前端 / console），仅重载它即可——尤其重载 console / web
# 不会打断 kagami-agent 的热状态（KV 缓存前缀、HNSW 索引、活内存上下文），符合项目的
# 「KV 缓存命中率优先」原则。涉及 DB schema 变更时仍需用 `pnpm app:deploy`（它会跑迁移）。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE="${1:-}"
case "$SERVICE" in
  agent) PKG="@kagami/agent" ;;
  console) PKG="@kagami/console" ;;
  web) PKG="@kagami/web" ;;
  oss) PKG="@kagami/oss" ;;
  *)
    echo "用法: pnpm app:restart <agent|console|web|oss>" >&2
    echo "  仅重建并重载指定服务（含其依赖包），不动其它进程、不跑迁移。" >&2
    echo "  例：只改了前端就 \`pnpm app:restart console\`，agent 的热上下文 / KV 缓存不被打断。" >&2
    echo "  注：涉及 DB schema 变更请改用 \`pnpm app:deploy\`（它会跑迁移）。" >&2
    exit 1
    ;;
esac

PM2_NAME="kagami-${SERVICE}"

echo "[app:restart] 构建 ${PKG}（含其依赖包）..."
pnpm --filter "${PKG}..." build

echo "[app:restart] 重载 ${PM2_NAME}（不影响其它进程）..."
# 用 ecosystem + --only 收口该进程：进程已在跑则 reload，不在跑则按 ecosystem 配置启动。
pnpm exec pm2 startOrReload ecosystem.config.cjs --only "${PM2_NAME}" --update-env

echo "[app:restart] Done：${PM2_NAME} 已重载（其它进程未受影响）。"
