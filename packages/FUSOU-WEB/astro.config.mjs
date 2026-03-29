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
import rehypeMermaid from "rehype-mermaid";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * Cloudflare Pages ビルド時に PUBLIC_SITE_URL を動的に解決する
 * 優先順位: 平文の環境変数 → Cloudflare組み込みのデプロイURL
 */
/**
 * @param {string} value
 */
function isLocalOnlyUrl(value) {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} branch
 * @param {string | undefined} deploymentUrl
 */
function toPreviewAliasUrl(branch, deploymentUrl) {
  if (!branch || !deploymentUrl) return undefined;

  // Convert branch names like "feature/foo_bar" into Cloudflare preview alias style.
  const normalizedBranch = branch
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalizedBranch) return undefined;

  try {
    const deploymentHost = new URL(deploymentUrl).hostname;
    const firstDot = deploymentHost.indexOf(".");
    if (firstDot === -1 || firstDot === deploymentHost.length - 1) {
      return undefined;
    }

    const projectHost = deploymentHost.slice(firstDot + 1);
    return `https://${normalizedBranch}.${projectHost}`;
  } catch {
    return undefined;
  }
}

function resolvePublicSiteUrl() {
  // 1) 明示指定（dotenvx / Cloudflare env）
  const envVal = process.env.PUBLIC_SITE_URL;
  const branch = process.env.CF_PAGES_BRANCH;
  const isCloudflareBuild = Boolean(branch);
  if (envVal && !envVal.startsWith("encrypted:")) {
    // Cloudflare build では localhost 系の値を拒否して誤設定を防止する。
    if (!(isCloudflareBuild && isLocalOnlyUrl(envVal))) {
      return envVal;
    }
  }

  // 2) Cloudflare Pages 上のビルドは組み込み情報から解決
  const deploymentUrl = process.env.CF_PAGES_URL;
  const productionSiteUrl = process.env.PUBLIC_SITE_URL_PRODUCTION;

  if (branch) {
    if (branch === "main") {
      if (productionSiteUrl && !productionSiteUrl.startsWith("encrypted:")) {
        return productionSiteUrl;
      }
      if (deploymentUrl && !deploymentUrl.startsWith("encrypted:")) {
        return deploymentUrl;
      }
      return undefined;
    }

    const previewAliasUrl = toPreviewAliasUrl(branch, deploymentUrl);
    if (previewAliasUrl) {
      return previewAliasUrl;
    }

    if (deploymentUrl && !deploymentUrl.startsWith("encrypted:")) {
      return deploymentUrl;
    }

    return undefined;
  }

  if (deploymentUrl && !deploymentUrl.startsWith("encrypted:")) {
    return deploymentUrl;
  }

  return undefined;
}

const publicSiteUrl = resolvePublicSiteUrl();
const isCloudflareBuild = Boolean(process.env.CF_PAGES_BRANCH);
const isStrictEnv = isCloudflareBuild || Boolean(process.env.CI);

let effectivePublicSiteUrl = publicSiteUrl;
if (!effectivePublicSiteUrl) {
  if (isStrictEnv) {
    throw new Error(
      "PUBLIC_SITE_URL (or CF_PAGES_URL on Pages) is required in CI/Cloudflare builds",
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
    icon(),
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
        ...(import.meta.env.PROD && {
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
