import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: "./vitest.setup.ts",
    mockReset: true,
    include: ["src/**/*.{test,spec}.{js,ts,jsx,tsx}"],
    exclude: ["node_modules/**", "dist/**", "e2e/**", "scripts/**"],
  },
});
