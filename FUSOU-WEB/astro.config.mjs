// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from "@tailwindcss/vite";

import solidJs from '@astrojs/solid-js';

import cloudflare from '@astrojs/cloudflare';

import partytown from '@astrojs/partytown';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
// @ts-ignore
export default defineConfig({
  site: "https://dev.fusou.pages.dev/",
  // @ts-ignore
  integrations: [solidJs(), partytown(), sitemap()],
  output: 'server',
  adapter: cloudflare(),
  vite: {
    // @ts-ignore
    plugins: [tailwindcss()],
    define: {
      "import.meta.env.PUBLIC_SUPABASE_URL": JSON.stringify(process.env.PUBLIC_SUPABASE_URL),
      "import.meta.env.PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(process.env.PUBLIC_SUPABASE_ANON_KEY),
      "import.meta.env.PUBLIC_SITE_URL": JSON.stringify(process.env.PUBLIC_SITE_URL),
      "import.meta.env.GOOGLE_CLIENT_ID": JSON.stringify(process.env.GOOGLE_CLIENT_ID),
      "import.meta.env.GOOGLE_CLIENT_SECRET ": JSON.stringify(process.env.GOOGLE_CLIENT_SECRET),
      "import.meta.env.SUPABASE_DATABASE_URL ": JSON.stringify(process.env.SUPABASE_DATABASE_URL),
      "import.meta.env.BETTER_AUTH_SECRET": JSON.stringify(process.env.BETTER_AUTH_SECRET),
    }
  },
});