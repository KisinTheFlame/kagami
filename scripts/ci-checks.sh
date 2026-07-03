#!/usr/bin/env bash
# build 之后并行跑四个互相独立的检查（typecheck / lint / format / test）。
# 这四条只依赖 build 产出的 dist、彼此不依赖，故 build 后可并行消费。
#
# 刻意不用关联数组 `declare -A`（bash 4+ only），改用逐检查的 .code 文件，
# 兼容 macOS 默认 bash 3.2 与 CI 的 ubuntu bash。
# 不用 `set -e`：要收集全部检查的结果，不能第一条失败就退出。
set -uo pipefail

log_dir=$(mktemp -d)
names="typecheck lint format test"

run() { # name cmd...
  local name="$1"
  shift
  ("$@" >"$log_dir/$name.log" 2>&1; echo $? >"$log_dir/$name.code") &
}

run typecheck pnpm typecheck
run lint pnpm lint
run format pnpm format
run test pnpm test
wait # 等全部后台检查结束

# 读取某个检查的退出码；.code 缺失或为空（进程被 OOM / 信号硬杀，没跑到
# `echo $?`）一律当失败，避免崩溃的检查让 job 静默变绿。
read_code() {
  local c
  c=$(cat "$log_dir/$1.code" 2>/dev/null)
  [ -z "$c" ] && c=1
  echo "$c"
}

fail=0
for name in $names; do
  code=$(read_code "$name")
  echo "::group::$name (exit $code)"
  cat "$log_dir/$name.log"
  echo "::endgroup::"
  [ "$code" -ne 0 ] && fail=1
done

echo "===== CI checks summary ====="
for name in $names; do
  code=$(read_code "$name")
  if [ "$code" -eq 0 ]; then
    echo "  ✅ $name"
  else
    echo "  ❌ $name (exit $code)"
  fi
done

rm -rf "$log_dir"
exit $fail
