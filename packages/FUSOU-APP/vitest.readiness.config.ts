import { playwright } from "@vitest/browser-playwright";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "solid-js",
  },
  test: {
    include: ["src/components/settings/tlsn_capture_readiness.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({}),
      instances: [{ browser: "chromium" }],
    },
  },
});
