import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@kagami/shared/": path.resolve(rootDir, "../../packages/shared/src/"),
      "@kagami/http/": path.resolve(rootDir, "../../packages/http/src/"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    maxWorkers: 4,
  },
});
