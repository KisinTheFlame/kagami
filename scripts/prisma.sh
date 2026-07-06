#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 参数化：默认指向持久化包 @kagami/persistence 及其 server.databaseUrl，保持既有调用行为不变。
# scheduler 有独立 Prisma 库（issue #493），通过覆盖这两个环境变量复用同一脚本：
#   PRISMA_PACKAGE_DIR：Prisma schema / migrations / 生成 client 所在包目录（相对仓库根）。
#   PRISMA_CONFIG_KEY ：连库命令（migrate / db push 等）读取 databaseUrl 的 config.yaml dot path。
PRISMA_PACKAGE_DIR="${PRISMA_PACKAGE_DIR:-packages/persistence}"
PRISMA_CONFIG_KEY="${PRISMA_CONFIG_KEY:-server.databaseUrl}"
CORE_DIR="$ROOT_DIR/$PRISMA_PACKAGE_DIR"

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/prisma.sh <prisma args...>"
  echo "Example: scripts/prisma.sh migrate status"
  exit 1
fi

# prisma generate 是纯代码生成、不连库——它只要求 DATABASE_URL 有值（schema
# datasource 走 env("DATABASE_URL")）。用占位 URL 跳过 config.yaml，让 build /
# typecheck 与运行时配置解耦；连库命令（migrate / db push 等）仍读真实配置。
if [ "$1" = "generate" ]; then
  DATABASE_URL="file:./.prisma-generate-placeholder"
else
  DATABASE_URL="$(node "$ROOT_DIR/scripts/read-config.mjs" "$PRISMA_CONFIG_KEY")"
  # SQLite：确保库文件父目录存在，否则 prisma migrate/db push 会因目录缺失失败。
  if [[ "$DATABASE_URL" == file:* ]]; then
    db_file="${DATABASE_URL#file:}"
    if [ "$db_file" != ":memory:" ]; then
      mkdir -p "$(dirname "$db_file")"
    fi
  fi
fi

prisma_args=("$@")

if [ "$1" = "migrate" ] && [ "${2:-}" = "dev" ]; then
  has_create_only=0
  for arg in "${prisma_args[@]}"; do
    if [ "$arg" = "--create-only" ]; then
      has_create_only=1
      break
    fi
  done

  if [ "$has_create_only" -ne 1 ]; then
    prisma_args+=("--create-only")
  fi
fi

cd "$CORE_DIR"
DATABASE_URL="$DATABASE_URL" pnpm exec prisma "${prisma_args[@]}"
