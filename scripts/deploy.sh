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
