import { configs as litConfigs } from "eslint-plugin-lit";
import { configs as wcConfigs } from "eslint-plugin-wc";
import tseslint from "typescript-eslint";

export default [
  litConfigs["flat/recommended"],
  wcConfigs["flat/recommended"],
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-prototype-builtins": "off",
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    ignores: ["**/*.d.ts", "dist/"],
  },
];
