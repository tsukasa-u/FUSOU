import type { MarkdownInstance } from "astro";

// 本番ビルドではローカル限定ドキュメントをバンドルに含めない
export const rawLocalGlob: Record<string, MarkdownInstance<Record<string, unknown>>> = {};
