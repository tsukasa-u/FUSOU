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
      "import.meta.env.SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL),
      "import.meta.env.SUPABASE_ANON_KEY": JSON.stringify(process.env.SUPABASE_ANON_KEY),
    }
  },
});