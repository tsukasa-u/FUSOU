import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import obfuscatorPlugin from "rollup-plugin-obfuscator";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    plugins: [solid()],
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "solid-js",
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        plugins: isProduction
          ? [
              obfuscatorPlugin({
                options: {
                  compact: true,
                  controlFlowFlattening: true,
                  controlFlowFlatteningThreshold: 0.5,
                  deadCodeInjection: true,
                  deadCodeInjectionThreshold: 0.3,
                  stringArray: true,
                  stringArrayRotate: true,
                  stringArrayShuffle: true,
                  stringArrayThreshold: 0.75,
                  splitStrings: true,
                  splitStringsChunkLength: 10,
                  identifierNamesGenerator: "hexadecimal",
                  selfDefending: true,
                  transformObjectKeys: true,
                },
              }),
            ]
          : [],
      },
    },
    test: {
      workspace: [
        {
          extends: true,
          plugins: [
            // The plugin will run tests for the stories defined in your Storybook config
            // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
            storybookTest({
              configDir: path.join(dirname, ".storybook"),
            }),
          ],
          test: {
            name: "storybook",
            browser: {
              // Enable browser-based testing for UI components
              enabled: true,
              headless: true,
              provider: "playwright",
              instances: [{ browser: "chromium" }],
            },
            // This setup file applies Storybook project annotations for Vitest
            // More info at: https://storybook.js.org/docs/api/portable-stories/portable-stories-vitest#setprojectannotations
            setupFiles: [".storybook/vitest.setup.ts"],
          },
        },
      ],
      include: ["stories/**/*.stories.tsx", "stories/**/*.test.tsx"],
      exclude: ["stories/**/*.mdx"],
    },
    optimizeDeps: {
      //  include: ["shared-ui"],
      // shared-ui is a workspace-linked package — exclude it so Vite always
      // reads the latest dist/index.js instead of serving a stale pre-bundle cache.
      exclude: ["shared-ui"],
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
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
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
    resolve: {
      alias: {
        "@ipc-bindings": resolve(__dirname, "../kc_api/bindings"),
        "@fusou-testdata-ipc": resolve(
          __dirname,
          "../../../FUSOU-TESTDATA/storybook/ipc",
        ),
      },
    },
  };
});
