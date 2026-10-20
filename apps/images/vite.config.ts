import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), svelte()],
  resolve: { conditions: ["browser"] },
  server: {
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build:
    mode === "e2e"
      ? {
          outDir: "dist-e2e",
          rollupOptions: {
            input: fileURLToPath(new URL("./e2e/index.html", import.meta.url)),
          },
        }
      : undefined,
  test: { include: ["worker/**/*.test.ts", "shared/**/*.test.ts"], environment: "node" },
}));
