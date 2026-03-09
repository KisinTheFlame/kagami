#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/apps/server"
DATABASE_URL="$(node "$ROOT_DIR/scripts/read-config.mjs" server.databaseUrl)"

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/prisma.sh <prisma args...>"
  echo "Example: scripts/prisma.sh migrate status"
  exit 1
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

cd "$SERVER_DIR"
DATABASE_URL="$DATABASE_URL" pnpm exec prisma "${prisma_args[@]}"
