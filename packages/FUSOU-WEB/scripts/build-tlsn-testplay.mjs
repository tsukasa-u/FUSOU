import { lstatSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createIsolatedTestplayBuildEnvironment,
  readAndValidateTestplayBuiltConfig,
  readAndValidateTestplayWranglerConfig,
  TLSN_TESTPLAY_OUTPUT_DIR,
  TLSN_TESTPLAY_CUSTOM_DOMAIN,
  TLSN_TESTPLAY_SITE_URL,
} from "./tlsn-testplay-build-profile.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const astroCli = fileURLToPath(new URL("../node_modules/astro/bin/astro.mjs", import.meta.url));
const astroConfig = "astro.config.tlsn-testplay.mjs";
const { environment, supabase } = createIsolatedTestplayBuildEnvironment(process.env);

readAndValidateTestplayWranglerConfig();
const outputDirectory = resolve(packageRoot, TLSN_TESTPLAY_OUTPUT_DIR);
const outputRelativePath = relative(packageRoot, outputDirectory);
if (!outputRelativePath ||
    outputRelativePath === ".." ||
    outputRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(outputRelativePath)) {
  throw new Error("TLSN testplay output directory escaped the package root");
}
try {
  if (lstatSync(outputDirectory).isSymbolicLink()) {
    throw new Error("TLSN testplay output directory must not be a symbolic link");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
rmSync(outputDirectory, { recursive: true, force: true });
console.log(`TLSN testplay profile: site=${TLSN_TESTPLAY_SITE_URL}, custom domain=${TLSN_TESTPLAY_CUSTOM_DOMAIN}, Supabase host=${supabase.hostname}`);

for (const command of ["check", "build"]) {
  const result = spawnSync(process.execPath, [
    astroCli,
    "--config",
    astroConfig,
    command,
  ], {
    cwd: packageRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (process.exitCode === undefined) {
  readAndValidateTestplayBuiltConfig();
  const sitemapIndex = resolve(packageRoot, TLSN_TESTPLAY_OUTPUT_DIR, "client/sitemap-index.xml");
  const sitemap = readFileSync(sitemapIndex, "utf8");
  if (!sitemap.includes(`<loc>${TLSN_TESTPLAY_SITE_URL}/sitemap-0.xml</loc>`)) {
    throw new Error("Astro's generated sitemap does not use the TLSN testplay site URL");
  }
  console.log("TLSN testplay Astro output and generated Wrangler config are isolated");
}
