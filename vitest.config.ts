import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  base: "/agents/",
  build: {
    // 总体输出目录
    outDir: "dist/client/agents", 
    // 清空目录时只清空 outDir，如果需要保留父目录需要小心配置
    // 但通常 Vite 默认行为是清空整个 dist/client/agents
    emptyOutDir: true, 
  },
  environments: {
    ssr: {
      keepProcessEnv: true
    }
  },
  test: {
    // https://github.com/cloudflare/workers-sdk/issues/9822
    deps: {
      optimizer: {
        ssr: {
          include: ["ajv"]
        }
      }
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" }
      }
    }
  }
});
