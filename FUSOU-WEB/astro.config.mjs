// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from "@tailwindcss/vite";

import solidJs from '@astrojs/solid-js';

import cloudflare from '@astrojs/cloudflare';

import partytown from '@astrojs/partytown';

// https://astro.build/config
// @ts-ignore
export default defineConfig({
  // @ts-ignore
  integrations: [solidJs(), partytown()],
  adapter: cloudflare(),
  vite: {
    // @ts-ignore
    plugins: [tailwindcss()],
  },
});