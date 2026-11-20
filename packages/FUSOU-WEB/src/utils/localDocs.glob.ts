import type { MarkdownInstance } from "astro";

// Vite の glob インポートですべてのローカル用 Markdown を読み込み（開発・Storybook環境専用）
export const rawLocalGlob = import.meta.glob<MarkdownInstance<Record<string, unknown>>>(
  [
    "@all-docs/formulas/**/*.md",
    "@all-docs/operations/**/*.md",
    "@all-docs/implementation-plans/**/*.md",
    "@all-docs/architecture/**/*.md",
  ],
  { eager: true },
);
