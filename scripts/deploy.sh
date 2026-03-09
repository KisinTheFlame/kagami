#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[app:deploy] Step 1/4: Building workspace..."
pnpm build

echo "[app:deploy] Step 2/4: Applying Prisma migrations..."
pnpm db:migrate:deploy

echo "[app:deploy] Step 3/4: Reloading PM2 apps..."
pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env

echo "[app:deploy] Step 4/4: Saving PM2 process list..."
pnpm exec pm2 save

echo "[app:deploy] Done."
