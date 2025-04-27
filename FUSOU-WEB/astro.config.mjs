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
  site: "https://613a41d7.fusou.pages.dev/",
  // @ts-ignore
  integrations: [solidJs(), partytown(), sitemap()],
  adapter: cloudflare(),
  vite: {
    // @ts-ignore
    plugins: [tailwindcss()],
  },
});