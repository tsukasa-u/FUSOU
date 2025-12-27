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
// import { nodePolyfills } from 'vite-plugin-node-polyfills';

import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

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
      wasm(),
      topLevelAwait(),
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
        process.env.PUBLIC_SITE_URL
      ),
      "process.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN": JSON.stringify(
        process.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN
      ),
      "process.env.ASSET_UPLOAD_SIGNING_SECRET": JSON.stringify(
        process.env.ASSET_UPLOAD_SIGNING_SECRET
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
  },
});
