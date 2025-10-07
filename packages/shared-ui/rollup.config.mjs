import alias from "@rollup/plugin-alias";
import { resolve } from "path";
import dts from "rollup-plugin-dts";
import path from "path";
import { fileURLToPath } from "url";
import summary from "rollup-plugin-summary";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default [
  // Type definitions
  {
    input: "./dist/types/shared-ui/src/index.d.ts", // ★ tsc が生成するメインの型定義ファイル
    output: [{ file: "dist/index.d.ts", format: "es" }], // ★ 最終的な出力パスとファイル名
    plugins: [
      dts(),
      summary(),
      alias({
        entries: [
          {
            find: "@ipc-bindings",
            replacement: resolve(__dirname, "../kc_api/bindings"),
          },
        ],
      }),
    ],
  },
];
