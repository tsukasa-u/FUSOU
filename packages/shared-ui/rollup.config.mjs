import alias from "@rollup/plugin-alias";
import { resolve } from "path";
import dts from "rollup-plugin-dts";
import path from "path";
import { fileURLToPath } from "url";
import summary from "rollup-plugin-summary";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// rollup-plugin-dts requires `export {};` to be present in .d.ts files that
// contain `declare global {}` blocks, otherwise it incorrectly treats `global`
// as a named export. TypeScript only emits `export {};` when a file has
// non-exported module-level declarations, so files that only have explicit
// exports and a `declare global {}` block are missing it. This plugin fixes
// that by inserting `export {};` where needed.
const fixDeclareGlobal = {
  name: "fix-declare-global",
  transform(code, id) {
    if (
      id.endsWith(".d.ts") &&
      code.includes("declare global") &&
      !code.includes("export {};") &&
      !code.includes("export { }")
    ) {
      const fixed = code.replace(
        /\/\/# sourceMappingURL=/,
        "export {};\n//# sourceMappingURL="
      );
      if (fixed !== code) {
        return { code: fixed, map: null };
      }
      return { code: "export {};\n" + code, map: null };
    }
    return null;
  },
};

export default [
  // Type definitions
  {
    input: "./dist/types/shared-ui/src/index.d.ts", // ★ tsc が生成するメインの型定義ファイル
    output: [{ file: "dist/index.d.ts", format: "es" }], // ★ 最終的な出力パスとファイル名
    plugins: [
      fixDeclareGlobal,
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
