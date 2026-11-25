import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { fileURLToPath } from "node:url";
import baseConfig from "./astro.config.mjs";
import {
  resolveTestplaySupabase,
  TLSN_TESTPLAY_SITE_URL,
} from "./scripts/tlsn-testplay-build-profile.mjs";

const supabase = resolveTestplaySupabase(process.env);
if (process.env["FUSOU_TLSN_TESTPLAY_BUILD_PROFILE"] !== "1" ||
    process.env["PUBLIC_SITE_URL"] !== TLSN_TESTPLAY_SITE_URL ||
    process.env["PUBLIC_SUPABASE_URL"] !== supabase.url) {
  throw new Error("TLSN testplay Astro configuration requires its isolated build profile");
}

export default defineConfig({
  ...baseConfig,
  site: TLSN_TESTPLAY_SITE_URL,
  outDir: "./dist-tlsn-testplay",
  session: false,
  adapter: cloudflare({
    imageService: "cloudflare",
    configPath: fileURLToPath(new URL("./wrangler.tlsn-testplay.toml", import.meta.url)),
  }),
  vite: {
    ...baseConfig.vite,
    envDir: false,
  },
});
