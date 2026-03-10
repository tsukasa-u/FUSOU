// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import solid from "@astrojs/solid-js";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";
import react from "@astrojs/react";
import remarkCallout from "@r4ai/remark-callout";
import { fileURLToPath, URL } from "node:url";
import rehypeMermaid from 'rehype-mermaid';

/**
 * Cloudflare Pages ビルド時に PUBLIC_SITE_URL を動的に解決する
 * 優先順位: 平文の環境変数 → CF_PAGES_BRANCH から算出 → フォールバック
 */
function resolvePublicSiteUrl() {
  // CF_PAGES_BRANCH がある = Cloudflare Pages 上のビルド → ブランチから算出
  const branch = process.env.CF_PAGES_BRANCH;
  if (branch) {
    if (branch === "main") return "https://fusou.dev";
    const sanitized = branch.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return `https://${sanitized}.fusou.pages.dev`;
  }

  // ローカルビルド: dotenvx で復号済みの平文を使用
  const envVal = process.env.PUBLIC_SITE_URL;
  if (envVal && !envVal.startsWith("encrypted:")) return envVal;

  return undefined;
}

const publicSiteUrl = resolvePublicSiteUrl();

// Vite の .env 読み込みは既存の process.env を上書きしないため、
// ここで設定すれば import.meta.env.PUBLIC_SITE_URL にも正しい値が入る
if (publicSiteUrl) {
  process.env.PUBLIC_SITE_URL = publicSiteUrl;
}

// https://astro.build/config
// @ts-ignore
export default defineConfig({
  site: publicSiteUrl || "https://dev.fusou.pages.dev/",
  // @ts-ignore
  integrations: [
    sitemap(),
    icon(),
    react({
      include: ["**/react/*"],
    }),
    solid({
      include: ["**/solid/*"],
    }),
  ],
  output: "server",
  adapter: cloudflare({ 
    imageService: "cloudflare",
    platformProxy: {
      enabled: true,
      persist: true,
    },
  }),
  vite: {
    ssr: {
      external: ["node:fs/promises", "node:path", "node:url", "node:crypto"],
    },
    // @ts-ignore
    plugins: [
      tailwindcss(),
      /*
      nodePolyfills({
        include: ['buffer', 'util'],
        globals: {
          Buffer: true,
        },
      }),
      */
      // Disabled: vite-plugin-wasm injects 'URL = globalThis.URL' which crashes in Cloudflare Workers
      // wasm(),
      // topLevelAwait(),
    ],
    define: {
      "process.env.PUBLIC_SUPABASE_URL": JSON.stringify(
        process.env.PUBLIC_SUPABASE_URL
      ),
      "process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ),
      "process.env.SUPABASE_SECRET_KEY": JSON.stringify(
        process.env.SUPABASE_SECRET_KEY
      ),
      "process.env.PUBLIC_SITE_URL": JSON.stringify(
        publicSiteUrl
      ),
      "process.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN": JSON.stringify(
        process.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN
      ),
      "process.env.ASSET_UPLOAD_SIGNING_SECRET": JSON.stringify(
        process.env.ASSET_UPLOAD_SIGNING_SECRET
      ),
      "process.env.MASTER_DATA_SIGNING_SECRET": JSON.stringify(
        process.env.MASTER_DATA_SIGNING_SECRET
      ),
      "process.env.FLEET_SNAPSHOT_SIGNING_SECRET": JSON.stringify(
        process.env.FLEET_SNAPSHOT_SIGNING_SECRET
      ),
      "process.env.BATTLE_DATA_SIGNING_SECRET": JSON.stringify(
        process.env.BATTLE_DATA_SIGNING_SECRET
      ),
      "process.env.BATTLE_DATA_SIGNED_URL_SECRET": JSON.stringify(
        process.env.BATTLE_DATA_SIGNED_URL_SECRET
      ),
      "process.env.GOOGLE_CLIENT_ID": JSON.stringify(
        process.env.GOOGLE_CLIENT_ID
      ),
      "process.env.GOOGLE_CLIENT_SECRET": JSON.stringify(
        process.env.GOOGLE_CLIENT_SECRET
      ),
      "process.env.RESEND_API_KEY": JSON.stringify(
        process.env.RESEND_API_KEY
      ),
      "process.env.DATASET_TOKEN_SECRET": JSON.stringify(
        process.env.DATASET_TOKEN_SECRET
      ),
      "process.env.ASSET_BASE_URL": JSON.stringify(
        process.env.ASSET_BASE_URL || ""
      ),
    },
    resolve: {
      // @ts-ignore
      alias: {
        ...(import.meta.env.PROD && {
          "react-dom/server": "react-dom/server.edge",
        }),
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@docs": fileURLToPath(new URL("../../docs/contents", import.meta.url)),
        "@fusou/avro-wasm": fileURLToPath(new URL("../avro-wasm/index.ts", import.meta.url)),
      },
    },
  },
  markdown: {
    remarkPlugins: [remarkCallout],
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid', 'js'],
    },
    rehypePlugins: [[rehypeMermaid, { strategy: 'pre-mermaid' }]],
  },
});
