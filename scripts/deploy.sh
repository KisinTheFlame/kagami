#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[app:deploy] Step 1/4: Building workspace..."
pnpm build

echo "[app:deploy] Step 2/4: Applying Prisma migrations..."
# SQLite 多后端进程下的迁移：prisma migrate 的 schema engine 用独立连接、不带 busy_timeout，
# 当 kagami-server / kagami-console 两个写库进程持有 WAL 库时它拿不到锁，会直接
# "database is locked" 而中止部署。对策：无待应用迁移时（绝大多数部署）跳过 deploy
# （status 是只读、WAL 下与运行进程并存无碍）；确有待应用迁移时，先停掉两个写库进程腾出
# 独占访问再迁，迁移成功与否都把进程拉回来，Step 3 的 startOrReload 再正常 reload。
if pnpm db:migrate:status >/dev/null 2>&1; then
  echo "[app:deploy]   schema 已最新，跳过迁移（避免与运行进程争锁）。"
else
  echo "[app:deploy]   检测到待应用迁移，暂停写库进程后迁移..."
  pnpm exec pm2 stop kagami-server kagami-console >/dev/null 2>&1 || true
  if pnpm db:migrate:deploy; then
    echo "[app:deploy]   迁移完成，进程将在 Step 3 重新拉起。"
  else
    echo "[app:deploy]   迁移失败！立即拉回进程避免停机，然后中止部署。" >&2
    pnpm exec pm2 start kagami-server kagami-console >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo "[app:deploy] Step 3/4: Reloading PM2 apps..."
pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env

echo "[app:deploy] Step 4/4: Saving PM2 process list..."
pnpm exec pm2 save

echo "[app:deploy] Done."
