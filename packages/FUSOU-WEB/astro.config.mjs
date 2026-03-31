// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import solid from "@astrojs/solid-js";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import remarkCallout from "@r4ai/remark-callout";
import { fileURLToPath, URL } from "node:url";
import rehypeMermaid from "rehype-mermaid";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * @param {string} value
 */
function isPlainUrl(value) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} value
 */
function readPlainEnvUrl(value) {
  if (!value || value.startsWith("encrypted:")) return undefined;
  return isPlainUrl(value) ? value : undefined;
}

function resolvePublicSiteUrl() {
  // 1) 明示指定（dotenvx / Cloudflare env）
  const explicitSiteUrl = readPlainEnvUrl(process.env.PUBLIC_SITE_URL);
  if (explicitSiteUrl) return explicitSiteUrl;

  // 2) Preview deploys can optionally inject a deployment URL from CI
  const deploymentUrl = readPlainEnvUrl(
    process.env.DEPLOYMENT_URL ||
      process.env.CF_WORKER_URL ||
      process.env.WORKERS_DEV_URL,
  );
  if (deploymentUrl) return deploymentUrl;

  return undefined;
}

const publicSiteUrl = resolvePublicSiteUrl();
const isCloudflareDeploy = Boolean(
  process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID,
);
const isStrictEnv = isCloudflareDeploy || Boolean(process.env.CI);

let effectivePublicSiteUrl = publicSiteUrl;
if (!effectivePublicSiteUrl) {
  if (isStrictEnv) {
    throw new Error(
      "PUBLIC_SITE_URL is required for CI/Cloudflare Workers builds",
    );
  } else {
    // Local CLI usage (astro check/dev) can safely fall back.
    effectivePublicSiteUrl = "http://localhost:4321/";
  }
}

// Vite の .env 読み込みは既存の process.env を上書きしないため、
// ここで設定すれば import.meta.env.PUBLIC_SITE_URL にも正しい値が入る
process.env.PUBLIC_SITE_URL = effectivePublicSiteUrl;

// https://astro.build/config
// @ts-ignore
export default defineConfig({
  site: effectivePublicSiteUrl,
  // @ts-ignore
  integrations: [
    sitemap(),
    react({
      include: ["**/react/*"],
    }),
    solid({
      include: ["**/solid/**"],
    }),
  ],
  output: "server",
  adapter: cloudflare({
    imageService: "cloudflare",
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
        process.env.PUBLIC_SUPABASE_URL,
      ),
      "process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
      "process.env.SUPABASE_SECRET_KEY": JSON.stringify(
        process.env.SUPABASE_SECRET_KEY,
      ),
      "process.env.PUBLIC_SITE_URL": JSON.stringify(effectivePublicSiteUrl),
      "process.env.ASSET_BASE_URL": JSON.stringify(
        process.env.ASSET_BASE_URL || "",
      ),
      "process.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN": JSON.stringify(
        process.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN,
      ),
      "process.env.ASSET_UPLOAD_SIGNING_SECRET": JSON.stringify(
        process.env.ASSET_UPLOAD_SIGNING_SECRET,
      ),
      "process.env.MASTER_DATA_SIGNING_SECRET": JSON.stringify(
        process.env.MASTER_DATA_SIGNING_SECRET,
      ),
      "process.env.FLEET_SNAPSHOT_SIGNING_SECRET": JSON.stringify(
        process.env.FLEET_SNAPSHOT_SIGNING_SECRET,
      ),
      "process.env.BATTLE_DATA_SIGNING_SECRET": JSON.stringify(
        process.env.BATTLE_DATA_SIGNING_SECRET,
      ),
      "process.env.BATTLE_DATA_SIGNED_URL_SECRET": JSON.stringify(
        process.env.BATTLE_DATA_SIGNED_URL_SECRET,
      ),
      "process.env.GOOGLE_CLIENT_ID": JSON.stringify(
        process.env.GOOGLE_CLIENT_ID,
      ),
      "process.env.GOOGLE_CLIENT_SECRET": JSON.stringify(
        process.env.GOOGLE_CLIENT_SECRET,
      ),
      "process.env.RESEND_API_KEY": JSON.stringify(process.env.RESEND_API_KEY),
      "process.env.DATASET_TOKEN_SECRET": JSON.stringify(
        process.env.DATASET_TOKEN_SECRET,
      ),
    },
    resolve: {
      // @ts-ignore
      alias: {
        ...(process.env.NODE_ENV === "production" && {
          "react-dom/server": "react-dom/server.edge",
        }),
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@docs": fileURLToPath(new URL("../../docs/contents", import.meta.url)),
        "@fusou/avro-wasm": fileURLToPath(
          new URL("../avro-wasm/index.ts", import.meta.url),
        ),
      },
    },
  },
  markdown: {
    remarkPlugins: [remarkCallout, remarkMath],
    syntaxHighlight: {
      type: "shiki",
      excludeLangs: ["mermaid", "js"],
    },
    rehypePlugins: [[rehypeMermaid, { strategy: "pre-mermaid" }], rehypeKatex],
  },
});
