import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/agents/",
  build: {
    // 总体输出目录
    outDir: "dist/client/agents", 
    // 清空目录时只清空 outDir，如果需要保留父目录需要小心配置
    // 但通常 Vite 默认行为是清空整个 dist/client/agents
    emptyOutDir: true, 
  },
  plugins: [cloudflare(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
