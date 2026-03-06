#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/prisma-docker.sh <prisma args...>"
  echo "Example: scripts/prisma-docker.sh migrate status"
  exit 1
fi

if [ "$1" = "migrate" ] && [ "${2:-}" = "dev" ]; then
  docker compose run --rm --no-deps \
    -v "$ROOT_DIR/apps/server/prisma:/app/prisma" \
    -v "$ROOT_DIR/apps/server/prisma.config.ts:/app/prisma.config.ts" \
    server node_modules/prisma/build/index.js "$@"
  exit 0
fi

docker compose run --rm --no-deps server node_modules/prisma/build/index.js "$@"
