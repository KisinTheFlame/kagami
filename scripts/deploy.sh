#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE="${1:-}"

# ── 单服务模式：pnpm app:deploy <agent|console|gateway|oss|browser|metric> ─────
# 只重建并重载指定服务（含其依赖包），不跑迁移、不动其它进程。改了某个服务时用它即可——
# 尤其重载 console / gateway 不会打断 kagami-agent 的热状态（KV 缓存前缀、HNSW 索引、活内存
# 上下文），符合「KV 缓存命中率优先」原则。涉及 DB schema 变更请用无参 `pnpm app:deploy`
# （它会跑迁移）。
if [ -n "$SERVICE" ]; then
  case "$SERVICE" in
    agent) PKG="@kagami/agent"; PM2_NAME="kagami-agent" ;;
    console) PKG="@kagami/console"; PM2_NAME="kagami-console" ;;
    # web 是已弃用别名，等价于 gateway（kagami-web → kagami-gateway 改名见 issue #162）。
    gateway | web) PKG="@kagami/gateway"; PM2_NAME="kagami-gateway" ;;
    oss) PKG="@kagami/oss"; PM2_NAME="kagami-oss" ;;
    browser) PKG="@kagami/browser"; PM2_NAME="kagami-browser" ;;
    llm) PKG="@kagami/llm-service"; PM2_NAME="kagami-llm" ;;
    metric) PKG="@kagami/metric"; PM2_NAME="kagami-metric" ;;
    spire) PKG="@kagami/spire-service"; PM2_NAME="kagami-spire" ;;
    *)
      echo "用法: pnpm app:deploy [<agent|console|gateway|oss|browser|llm|metric|spire>]" >&2
      echo "  无参：全量构建 + Prisma 迁移 + 重载所有进程。" >&2
      echo "  带服务名：只重建并重载该服务，不跑迁移、不动其它进程。" >&2
      exit 1
      ;;
  esac
  # 一次性迁移兜底：旧 kagami-web 进程改名为 kagami-gateway，startOrReload 不会自动删旧名，
  # 残留旧进程会占着 web 端口让 gateway 起不来。重载 gateway 前先幂等清理旧名。
  if [ "$PM2_NAME" = "kagami-gateway" ]; then
    pnpm exec pm2 delete kagami-web >/dev/null 2>&1 || true
  fi
  echo "[app:deploy] 单服务部署：构建 ${PKG}（含其依赖包）..."
  pnpm --filter "${PKG}..." build
  echo "[app:deploy] 重载 ${PM2_NAME}（不动其它进程、不跑迁移）..."
  pnpm exec pm2 startOrReload ecosystem.config.cjs --only "${PM2_NAME}" --update-env
  pnpm exec pm2 save
  echo "[app:deploy] Done：${PM2_NAME} 已重载（其它进程未受影响）。"
  exit 0
fi

# ── 全量部署（无参）────────────────────────────────────────────────────────────
echo "[app:deploy] Step 1/4: Building workspace..."
pnpm build

echo "[app:deploy] Step 2/4: Applying Prisma migrations..."
# SQLite 多后端进程下的迁移：prisma migrate 的 schema engine 用独立连接、不带 busy_timeout，
# 当 kagami-agent / kagami-console 两个写库进程持有 WAL 库时它拿不到锁，会直接
# "database is locked" 而中止部署。对策：无待应用迁移时（绝大多数部署）跳过 deploy
# （status 是只读、WAL 下与运行进程并存无碍）；确有待应用迁移时，先停掉两个写库进程腾出
# 独占访问再迁，迁移成功与否都把进程拉回来，Step 3 的 startOrReload 再正常 reload。
if pnpm db:migrate:status >/dev/null 2>&1; then
  echo "[app:deploy]   schema 已最新，跳过迁移（避免与运行进程争锁）。"
else
  echo "[app:deploy]   检测到待应用迁移，暂停开库进程后迁移..."
  # 所有开同一 SQLite 的写库进程都要暂停腾出独占锁：agent / console / browser（读 browser_credential）/
  # llm（写 llm_chat_call/auth/embedding_cache）/ metric（写 metric 表），都持有 WAL 库锁，
  # 否则迁移 "database is locked"。
  pnpm exec pm2 stop kagami-agent kagami-console kagami-browser kagami-llm kagami-metric >/dev/null 2>&1 || true
  if pnpm db:migrate:deploy; then
    echo "[app:deploy]   迁移完成，进程将在 Step 3 重新拉起。"
  else
    echo "[app:deploy]   迁移失败！立即拉回进程避免停机，然后中止部署。" >&2
    pnpm exec pm2 start kagami-agent kagami-console kagami-browser kagami-llm kagami-metric >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo "[app:deploy] Step 3/4: Reloading PM2 apps..."
# 一次性迁移兜底：清理改名前的旧 kagami-web 进程（见单服务分支注释）。
pnpm exec pm2 delete kagami-web >/dev/null 2>&1 || true
pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env

echo "[app:deploy] Step 4/4: Saving PM2 process list..."
pnpm exec pm2 save

echo "[app:deploy] Done."
