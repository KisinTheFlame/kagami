#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

resolve_database_url() {
  docker compose run --rm --no-deps server node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const fileContent = await readFile("config.yaml", "utf8");
const parsed = parse(fileContent);
const databaseUrl = parsed?.server?.databaseUrl;

if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
  throw new Error("config.yaml 缺少合法的 server.databaseUrl");
}

process.stdout.write(databaseUrl);
NODE
}

echo "[app:deploy] Step 1/3: Building images..."
docker compose build

echo "[app:deploy] Step 2/3: Applying Prisma migrations..."
DATABASE_URL="$(resolve_database_url)"
docker compose run --rm --no-deps \
  -e "DATABASE_URL=$DATABASE_URL" \
  server node_modules/prisma/build/index.js migrate deploy

echo "[app:deploy] Step 3/3: Starting services..."
docker compose up --detach server web napcat

echo "[app:deploy] Done."
