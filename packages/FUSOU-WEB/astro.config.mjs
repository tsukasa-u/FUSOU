// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import solid from "@astrojs/solid-js";
import cloudflare from "@astrojs/cloudflare";
import { unified } from "@astrojs/markdown-remark";
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
  const explicitSiteUrl = readPlainEnvUrl(process.env["PUBLIC_SITE_URL"]);
  if (explicitSiteUrl) return explicitSiteUrl;

  // 2) Preview deploys can optionally inject a deployment URL from CI
  const deploymentUrl = readPlainEnvUrl(
    process.env["DEPLOYMENT_URL"] ||
      process.env["CF_WORKER_URL"] ||
      process.env["WORKERS_DEV_URL"],
  );
  if (deploymentUrl) return deploymentUrl;

  return undefined;
}

const publicSiteUrl = resolvePublicSiteUrl();
const isCloudflareDeploy = Boolean(
  process.env["CLOUDFLARE_ACCOUNT_ID"] || process.env["CF_ACCOUNT_ID"],
);
const isStrictEnv = isCloudflareDeploy || Boolean(process.env["CI"]);

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
process.env["PUBLIC_SITE_URL"] = effectivePublicSiteUrl;

// https://astro.build/config
// @ts-ignore
export default defineConfig({
  site: effectivePublicSiteUrl,
  // @ts-ignore
  integrations: [
    sitemap(),
    react({
      include: ["**/react/**/*.{js,jsx,ts,tsx}"],
    }),
    solid({
      include: ["**/solid/**/*.{js,jsx,ts,tsx}"],
    }),
  ],
  output: "server",
  adapter: cloudflare({
    imageService: "cloudflare",
  }),
  vite: {
    optimizeDeps: {
      // Vite 8/Rolldown may mis-scan Astro app source TSX entries as plain TS
      // during automatic dependency discovery under the Cloudflare dev runtime.
      // Keep prebundling opt-in until upstream parsing stabilizes.
      noDiscovery: true,
      include: [
        "hono",
        "hono/logger",
        "@xyflow/react",
        "elkjs/lib/elk.bundled.js",
        "zustand",
        "zustand/traditional",
        "use-sync-external-store/shim/with-selector",
        "@supabase/supabase-js",
      ],
      exclude: ["solid-chartjs"],
    },
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
    resolve: {
      // @ts-ignore
      alias: {
        ...(process.env["NODE_ENV"] === "production" && {
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
    processor: unified({
      remarkPlugins: [remarkCallout, remarkMath],
      rehypePlugins: [[rehypeMermaid, { strategy: "pre-mermaid" }], rehypeKatex],
    }),
    syntaxHighlight: {
      type: "shiki",
      excludeLangs: ["mermaid", "js"],
    },
  },
});
