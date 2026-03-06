#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[deploy] Step 1/3: Building images..."
docker compose build

echo "[deploy] Step 2/3: Applying Prisma migrations..."
docker compose run --rm --no-deps server node_modules/prisma/build/index.js migrate deploy

echo "[deploy] Step 3/3: Starting services..."
docker compose up --detach server web napcat

echo "[deploy] Done."
