import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  base: "/agents/",
  build: {
    outDir: "dist/client/agents", 
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
