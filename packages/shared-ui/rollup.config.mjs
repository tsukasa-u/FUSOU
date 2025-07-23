// my-web-components/rollup.config.mjs
import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default [
  // Type definitions
  {
    input: "./dist/types/index.d.ts", // ★ tsc が生成するメインの型定義ファイル
    output: [{ file: "dist/index.d.ts", format: "es" }], // ★ 最終的な出力パスとファイル名
    plugins: [dts()],
  },
  // Main JavaScript bundle (Vite で生成) - 参考用
  // {
  //   input: 'src/index.ts', // Vite のエントリーポイントと同じにする
  //   output: {
  //     file: 'dist/index.js',
  //     format: 'esm',
  //     sourcemap: true,
  //   },
  //   plugins: [
  //     typescript({
  //       tsconfig: './tsconfig.json'
  //     })
  //   ]
  // }
];
