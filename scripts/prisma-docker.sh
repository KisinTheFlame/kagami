#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

resolve_database_url() {
  docker compose run --rm --no-deps server node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";

const fileContent = await readFile("gaia.config.yml", "utf8");
const match = fileContent.match(/^\s*baseUrl\s*:\s*(.+?)\s*$/m);

if (!match) {
  throw new Error("gaia.config.yml 缺少 baseUrl");
}

const rawBaseUrl = match[1].trim().replace(/^['"]|['"]$/g, "");
const requestUrl = new URL("/get", rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`);
requestUrl.searchParams.set("key", "kagami.database-url");

const response = await fetch(requestUrl);
if (!response.ok) {
  throw new Error(`读取 kagami.database-url 失败（HTTP ${response.status}）`);
}

const payload = await response.json();
if (typeof payload?.value !== "string" || payload.value.length === 0) {
  throw new Error("kagami.database-url 缺失或非法");
}

process.stdout.write(payload.value);
NODE
}

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/prisma-docker.sh <prisma args...>"
  echo "Example: scripts/prisma-docker.sh migrate status"
  exit 1
fi

if [ "$1" = "migrate" ] && [ "${2:-}" = "dev" ]; then
  NETWORK_NAME="${NETWORK:-axis}"
  PG_CONTAINER_NAME="kagami-prisma-migrate-$(date +%s)-$$"
  PG_USER="postgres"
  PG_PASSWORD="postgres"
  PG_DB="kagami_migrate_tmp"
  PG_IMAGE="postgres:16-alpine"
  PRISMA_DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@${PG_CONTAINER_NAME}:5432/${PG_DB}?schema=public"

  if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    echo "Error: Docker network '$NETWORK_NAME' does not exist."
    echo "Hint: run 'docker network create $NETWORK_NAME' first."
    exit 1
  fi

  cleanup() {
    docker rm -f "$PG_CONTAINER_NAME" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT INT TERM

  docker run -d \
    --name "$PG_CONTAINER_NAME" \
    --network "$NETWORK_NAME" \
    -e "POSTGRES_USER=$PG_USER" \
    -e "POSTGRES_PASSWORD=$PG_PASSWORD" \
    -e "POSTGRES_DB=$PG_DB" \
    "$PG_IMAGE" >/dev/null

  ready=0
  for _ in $(seq 1 60); do
    if docker exec "$PG_CONTAINER_NAME" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done

  if [ "$ready" -ne 1 ]; then
    echo "Error: Temporary PostgreSQL container did not become ready in time."
    echo "Container logs:"
    docker logs "$PG_CONTAINER_NAME" || true
    exit 1
  fi

  prisma_args=("$@")
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

  docker compose run --rm --no-deps \
    -e "DATABASE_URL=$PRISMA_DATABASE_URL" \
    -v "$ROOT_DIR/apps/server/prisma:/app/prisma" \
    -v "$ROOT_DIR/apps/server/prisma.config.ts:/app/prisma.config.ts" \
    server node_modules/prisma/build/index.js "${prisma_args[@]}"
  exit 0
fi

DATABASE_URL="$(resolve_database_url)"

docker compose run --rm --no-deps \
  -e "DATABASE_URL=$DATABASE_URL" \
  server node_modules/prisma/build/index.js "$@"
