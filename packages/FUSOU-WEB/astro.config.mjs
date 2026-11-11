
function remarkNormalizeCrlf() {
  return (tree) => {
    function visit(node) {
      if (node && typeof node.value === 'string') {
        const crlf = String.fromCharCode(13, 10);
        const cr = String.fromCharCode(13);
        const lf = String.fromCharCode(10);
        if (node.value.indexOf(cr) !== -1) {
          node.value = node.value.split(crlf).join(lf).split(cr).join(lf);
        }
      }
      if (node && Array.isArray(node.children)) {
        for (const child of node.children) {
          visit(child);
        }
      }
    }
    visit(tree);
  };
}

// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import solid from "@astrojs/solid-js";
import cloudflare from "@astrojs/cloudflare";
import { unified } from "@astrojs/markdown-remark";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import remarkCallout from "@r4ai/remark-callout";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import rehypeMermaid from "rehype-mermaid";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Resolve latest released FUSOU version at compile/build time (never per request).
 * Prefers `fusou-v*` git release tags, falling back to `FUSOU-APP/package.json`.
 */
function resolveLatestFusouVersion() {
  const tagVersions = [];
  try {
    const rawTags = execFileSync(
      "git",
      ["tag", "-l", "fusou-v*", "--sort=-v:refname"],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const line of rawTags.split(/\r?\n/)) {
      const m = /^fusou-v(\d+\.\d+\.\d+)$/.exec(line.trim());
      if (m?.[1]) tagVersions.push(m[1]);
    }
  } catch {
    // Fallback below on shallow clones without git tags
  }

  if (tagVersions.length > 0) {
    tagVersions.sort((a, b) => compareSemver(b, a));
    return `v${tagVersions[0]}`;
  }

  try {
    const appPkgPath = fileURLToPath(
      new URL("../FUSOU-APP/package.json", import.meta.url),
    );
    const appPkg = JSON.parse(readFileSync(appPkgPath, "utf8"));
    if (
      typeof appPkg.version === "string" &&
      /^\d+\.\d+\.\d+$/.test(appPkg.version)
    ) {
      return `v${appPkg.version}`;
    }
  } catch {
    // Fallback below if unavailable
  }

  return "v0.6.1";
}

const latestFusouVersion = resolveLatestFusouVersion();

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
      include: ["**/react/**"],
      exclude: ["**/solid/**"],
    }),
    solid({
      include: ["**/solid/**"],
      exclude: ["**/react/**"],
    }),
  ],
  output: "server",
  adapter: cloudflare({
    imageService: "cloudflare",
  }),
  vite: {
    define: {
      __FUSOU_APP_VERSION__: JSON.stringify(latestFusouVersion),
    },
    cacheDir: process.argv.includes("dev")
      ? "./node_modules/.vite-dev"
      : "./node_modules/.vite-prod",
    environments: {
      client: {
        optimizeDeps: {
          // Vite 8/Rolldown may mis-scan Astro app source TSX entries as plain TS
          // during automatic dependency discovery under the Cloudflare dev runtime.
          // Keep client prebundling opt-in until upstream parsing stabilizes.
          noDiscovery: true,
        },
      },
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@astrojs/react/client.js",
        "hono",
        "hono/logger",
        "@xyflow/react",
        "elkjs/lib/elk.bundled.js",
        "zustand",
        "zustand/traditional",
        "use-sync-external-store/shim/with-selector",
        "@supabase/supabase-js",
        "astro/app/manifest",
        "astro/assets/services/noop",
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
        "@all-docs": fileURLToPath(new URL("../../docs", import.meta.url)),
        "@fusou/avro-wasm": fileURLToPath(
          new URL("../avro-wasm/index.ts", import.meta.url),
        ),
      },
    },
  },
  markdown: {
    processor: unified({
      remarkPlugins: [remarkNormalizeCrlf, remarkCallout, remarkMath],
      rehypePlugins: [[rehypeMermaid, { strategy: "pre-mermaid" }], [rehypeKatex, { strict: false }]],
    }),
    syntaxHighlight: {
      type: "shiki",
      excludeLangs: ["mermaid", "js"],
    },
  },
});
