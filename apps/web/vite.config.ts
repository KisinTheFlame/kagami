import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // 前端产物落 dist/client，与服务端产物 dist/server 分居（#578：web 自持静态服务器）。
    // 运行时 dist/server/index.js 按 ../client 定位静态根；vite 只清空 dist/client，不碰 dist/server。
    outDir: "dist/client",
  },
});
