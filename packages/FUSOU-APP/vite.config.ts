import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import fs from "node:fs";
import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const host = process.env.TAURI_DEV_HOST;

const testDataIpcPath = resolve(dirname, "../../../FUSOU-TESTDATA/storybook/ipc");
const testDataSharedUiPath = resolve(dirname, "../../../FUSOU-TESTDATA/storybook/shared-ui");

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [solid()],
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "solid-js",
  },
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
          }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
          setupFiles: [".storybook/vitest.setup.ts"],
        },
      },
    ],
    exclude: ["stories/**/*.mdx"],
  },
  optimizeDeps: {
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@ipc-bindings": resolve(dirname, "../kc_api/bindings"),
      "@fusou-testdata-ipc": fs.existsSync(testDataIpcPath)
        ? testDataIpcPath
        : resolve(dirname, "src/stories"),
      "ui": resolve(dirname, "src/components/ui/index.tsx"),
      "@fusou-testdata-shared-ui": fs.existsSync(testDataSharedUiPath)
        ? testDataSharedUiPath
        : resolve(dirname, "src/stories"),
    }
  },
}));
