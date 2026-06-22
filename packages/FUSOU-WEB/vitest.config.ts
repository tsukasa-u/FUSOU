import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@fusou/avro-wasm": fileURLToPath(
        new URL("../avro-wasm/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: "./vitest.setup.ts",
    mockReset: true,
  },
});
