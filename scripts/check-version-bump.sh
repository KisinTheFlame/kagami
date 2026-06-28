#!/usr/bin/env bash
set -euo pipefail

# PR 版本号闸：PR 的 VERSION 必须严格高于目标分支（base）的 VERSION。
# 目的：强制每个 PR 显式 bump 版本号，避免 VERSION 文件无人维护、烂成摆设。
# 仅在 CI 的 pull_request 事件上调用（见 .github/workflows/ci.yml）。

BASE_REF="${BASE_REF:-master}"

if [ ! -f VERSION ]; then
  echo "::error::缺少根目录 VERSION 文件"
  exit 1
fi
CUR="$(tr -d '[:space:]' < VERSION)"

# 4 位 MAJOR.MINOR.PATCH.MICRO 格式校验
if ! printf '%s' "$CUR" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "::error::VERSION 必须是 4 位 MAJOR.MINOR.PATCH.MICRO，当前为 '$CUR'"
  exit 1
fi

# 取 base 分支的 VERSION（首次引入版本号时 base 尚无该文件 → bootstrap 放行）
git fetch --depth=1 origin "$BASE_REF" >/dev/null 2>&1 || true
BASE="$(git show "origin/${BASE_REF}:VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
if [ -z "$BASE" ]; then
  echo "base 分支 ${BASE_REF} 尚无 VERSION 文件（首次引入），跳过版本比较。"
  exit 0
fi

if [ "$CUR" = "$BASE" ]; then
  echo "::error::VERSION 未 bump：PR 与 ${BASE_REF} 同为 ${CUR}。请提升根目录 VERSION 文件。"
  exit 1
fi

# sort -V 对点分数值做版本排序；最高者必须是 PR 的版本
HIGHEST="$(printf '%s\n%s\n' "$BASE" "$CUR" | sort -V | tail -n1)"
if [ "$HIGHEST" != "$CUR" ]; then
  echo "::error::VERSION 必须高于 ${BASE_REF}：PR=${CUR} < base=${BASE}"
  exit 1
fi

echo "VERSION gate 通过：${BASE} -> ${CUR}"
