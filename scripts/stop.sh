#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE="${1:-}"

# 无参：停掉 ecosystem 里的所有进程。
if [ -z "$SERVICE" ]; then
  pnpm exec pm2 stop ecosystem.config.cjs
  exit 0
fi

# ── 单服务模式：pnpm app:stop <agent|console|gateway|oss|browser|llm|metric|spire> ──
# 别名 → PM2 进程名。与 scripts/deploy.sh 的别名表保持一致，让 stop / deploy 用同一套短名。
case "$SERVICE" in
  agent) PM2_NAME="kagami-agent" ;;
  console) PM2_NAME="kagami-console" ;;
  # web 是已弃用别名，等价于 gateway（kagami-web → kagami-gateway 改名见 issue #162）。
  gateway | web) PM2_NAME="kagami-gateway" ;;
  oss) PM2_NAME="kagami-oss" ;;
  browser) PM2_NAME="kagami-browser" ;;
  llm) PM2_NAME="kagami-llm" ;;
  metric) PM2_NAME="kagami-metric" ;;
  spire) PM2_NAME="kagami-spire" ;;
  *)
    echo "用法: pnpm app:stop [<agent|console|gateway|oss|browser|llm|metric|spire>]" >&2
    echo "  无参：停掉所有进程。" >&2
    echo "  带服务名：只停该服务。" >&2
    exit 1
    ;;
esac

pnpm exec pm2 stop "${PM2_NAME}"
