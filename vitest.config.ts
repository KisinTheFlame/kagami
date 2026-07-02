import { defineConfig } from "vitest/config";

// 根级 projects：单个 vitest 进程跑全部包的测试。
// 不走 pnpm -r 串行调度，省掉每个包各冷启动一次 vitest 的开销（CI 上约占 test 步骤 80% 时间）。
export default defineConfig({
  test: {
    projects: ["apps/*/vitest.config.ts", "packages/*/vitest.config.ts"],
  },
});
