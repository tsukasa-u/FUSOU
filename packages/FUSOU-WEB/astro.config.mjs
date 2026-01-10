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

// https://astro.build/config
// @ts-ignore
export default defineConfig({
  site: "https://dev.fusou.pages.dev/",
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
      // PUBLIC_ prefixed variables (for client-side access via process.env)
      "process.env.PUBLIC_SUPABASE_URL": JSON.stringify(
        process.env.PUBLIC_SUPABASE_URL
      ),
      "process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ),
      "process.env.PUBLIC_SITE_URL": JSON.stringify(
        process.env.PUBLIC_SITE_URL
      ),
      "process.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN": JSON.stringify(
        process.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN
      ),
      // Server-side: inject into import.meta.env for getEnv() access via ctx.buildtime
      // dotenvx decrypts .env values into process.env before Astro build
      "import.meta.env.PUBLIC_SUPABASE_URL": JSON.stringify(
        process.env.PUBLIC_SUPABASE_URL
      ),
      "import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ),
      "import.meta.env.SUPABASE_SECRET_KEY": JSON.stringify(
        process.env.SUPABASE_SECRET_KEY
      ),
      "import.meta.env.ASSET_UPLOAD_SIGNING_SECRET": JSON.stringify(
        process.env.ASSET_UPLOAD_SIGNING_SECRET
      ),
      "import.meta.env.FLEET_SNAPSHOT_SIGNING_SECRET": JSON.stringify(
        process.env.FLEET_SNAPSHOT_SIGNING_SECRET
      ),
      "import.meta.env.BATTLE_DATA_SIGNING_SECRET": JSON.stringify(
        process.env.BATTLE_DATA_SIGNING_SECRET
      ),
      "import.meta.env.BATTLE_DATA_SIGNED_URL_SECRET": JSON.stringify(
        process.env.BATTLE_DATA_SIGNED_URL_SECRET
      ),
      "import.meta.env.GOOGLE_CLIENT_ID": JSON.stringify(
        process.env.GOOGLE_CLIENT_ID
      ),
      "import.meta.env.GOOGLE_CLIENT_SECRET": JSON.stringify(
        process.env.GOOGLE_CLIENT_SECRET
      ),
      "import.meta.env.RESEND_API_KEY": JSON.stringify(
        process.env.RESEND_API_KEY
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
