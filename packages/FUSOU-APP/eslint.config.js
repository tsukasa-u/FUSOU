import { defineConfig } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
// import tseslint from "typescript-eslint";
import * as tsParser from "@typescript-eslint/parser";
import solid from "eslint-plugin-solid/configs/typescript";

export default defineConfig([
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  // tseslint.configs.recommended,
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    ...solid,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports", // Enforces `import type { Foo } from '...'`
          disallowTypeAnnotations: false,
          fixStyle: "separate-type-imports", // Or "inline-type-imports" for TS 4.5+
        },
      ],
    },
  },
]);
