import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// YAML's Node export is CommonJS and injects createRequire into the Worker.
const yamlBrowser = fileURLToPath(
  new URL(
    "./browser/index.js",
    pathToFileURL(createRequire(import.meta.url).resolve("yaml/package.json")),
  ),
);
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), sveltekit()],
  resolve: {
    alias: [
      { find: /^yaml$/, replacement: yamlBrowser },
      ...(mode === "e2e"
        ? [
            {
              find: /^\.\/public-snapshot$/,
              replacement: fileURLToPath(new URL("./e2e/public-snapshot.ts", import.meta.url)),
            },
            {
              find: /^@hasbai\/auth$/,
              replacement: fileURLToPath(
                new URL("./e2e/auth.ts", import.meta.url),
              ),
            },
            {
              find: /^@hasbai\/auth\/server$/,
              replacement: fileURLToPath(
                new URL("./e2e/auth-server.ts", import.meta.url),
              ),
            },
          ]
        : []),
    ],
  },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
}));
