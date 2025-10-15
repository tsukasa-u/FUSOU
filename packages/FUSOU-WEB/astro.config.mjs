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
  adapter: cloudflare(),
  vite: {
    // @ts-ignore
    plugins: [tailwindcss()],
    define: {
      "import.meta.env.PUBLIC_SUPABASE_URL": JSON.stringify(
        process.env.PUBLIC_SUPABASE_URL
      ),
      "import.meta.env.PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(
        process.env.PUBLIC_SUPABASE_ANON_KEY
      ),
      "import.meta.env.PUBLIC_SITE_URL": JSON.stringify(
        process.env.PUBLIC_SITE_URL
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
      },
    },
  },
  markdown: {
    remarkPlugins: [remarkCallout],
  },
});
