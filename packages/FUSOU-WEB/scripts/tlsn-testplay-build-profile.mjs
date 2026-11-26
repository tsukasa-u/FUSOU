import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_readRawConfig, unstable_readConfig } from "wrangler";

export const TLSN_TESTPLAY_WORKER_NAME = "fusou-tlsn-testplay-web";
export const TLSN_TESTPLAY_CUSTOM_DOMAIN = "tlsn-web.fusou.dev";
export const TLSN_TESTPLAY_SITE_URL = "https://tlsn-web.fusou.dev";
export const TLSN_TESTPLAY_OUTPUT_DIR = "dist-tlsn-testplay";
const astroWorkerEntrypoint = "@astrojs/cloudflare/entrypoints/server";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const wranglerConfigPath = resolve(packageRoot, "wrangler.tlsn-testplay.toml");
const requiredProfileKeys = [
  "FUSOU_TLSN_TESTPLAY_SUPABASE_URL",
  "FUSOU_TLSN_TESTPLAY_SUPABASE_ALLOWED_HOSTS",
];
const allowedTopLevelConfigKeys = new Set([
  "name",
  "main",
  "compatibility_date",
  "compatibility_flags",
  "workers_dev",
  "preview_urls",
  "send_metrics",
  "routes",
  "assets",
  "vars",
]);

function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" ||
    host === "::1" ||
    (isIP(host) === 4 && host.startsWith("127."));
}

function normalizeConfiguredUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid origin URL`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an origin without credentials, path, query, or fragment`);
  }
  return url;
}

export function resolveTestplaySupabase(env) {
  const missing = requiredProfileKeys.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`TLSN testplay build requires explicit verification Supabase inputs: ${missing.join(", ")}`);
  }

  const url = normalizeConfiguredUrl(
    env["FUSOU_TLSN_TESTPLAY_SUPABASE_URL"],
    "FUSOU_TLSN_TESTPLAY_SUPABASE_URL",
  );
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLocal = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("TLSN testplay Supabase must use HTTPS except for a loopback test service");
  }
  if (!isLocal && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
    throw new Error("TLSN testplay Supabase host must be a canonical DNS hostname");
  }
  if (hostname === "fusou.dev" || hostname.endsWith(".fusou.dev")) {
    throw new Error("TLSN testplay Supabase must not use a FUSOU WEB hostname");
  }

  const allowedHosts = env["FUSOU_TLSN_TESTPLAY_SUPABASE_ALLOWED_HOSTS"]
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHosts.length !== 1 || allowedHosts[0] !== hostname) {
    throw new Error("TLSN testplay Supabase URL must exactly match its single-host allowlist");
  }

  for (const key of ["PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
    const inherited = env[key];
    if (inherited && normalizeConfiguredUrl(inherited, key).origin !== url.origin) {
      throw new Error(`${key} conflicts with the explicit TLSN testplay Supabase URL`);
    }
  }
  if (env["PUBLIC_SITE_URL"] && new URL(env["PUBLIC_SITE_URL"]).origin !== TLSN_TESTPLAY_SITE_URL) {
    throw new Error("PUBLIC_SITE_URL conflicts with the TLSN testplay site");
  }
  for (const key of ["DEPLOYMENT_URL", "CF_WORKER_URL", "WORKERS_DEV_URL"]) {
    if (env[key] && new URL(env[key]).origin !== TLSN_TESTPLAY_SITE_URL) {
      throw new Error(`${key} conflicts with the TLSN testplay site`);
    }
  }

  return { url: url.origin, hostname };
}

export function createIsolatedTestplayBuildEnvironment(source) {
  const supabase = resolveTestplaySupabase(source);
  const environment = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "WINDIR",
  ]) {
    if (source[key]) environment[key] = source[key];
  }

  Object.assign(environment, {
    NODE_ENV: "production",
    FUSOU_TLSN_TESTPLAY_BUILD_PROFILE: "1",
    FUSOU_TLSN_TESTPLAY_SUPABASE_URL: supabase.url,
    FUSOU_TLSN_TESTPLAY_SUPABASE_ALLOWED_HOSTS: supabase.hostname,
    PUBLIC_SITE_URL: TLSN_TESTPLAY_SITE_URL,
    PUBLIC_SUPABASE_URL: supabase.url,
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  });
  return { environment, supabase };
}

function usesOnlyTestplayCustomDomain(routes) {
  return Array.isArray(routes) && routes.length === 1 &&
    routes[0]?.pattern === TLSN_TESTPLAY_CUSTOM_DOMAIN &&
    routes[0]?.zone_name === "fusou.dev" &&
    routes[0]?.custom_domain === true;
}

export function assertTestplayRawConfig(raw) {
  for (const key of Object.keys(raw)) {
    if (!allowedTopLevelConfigKeys.has(key)) {
      throw new Error(`TLSN testplay Wrangler config contains an unapproved top-level key: ${key}`);
    }
  }

  if (raw.name !== TLSN_TESTPLAY_WORKER_NAME ||
      raw.main !== astroWorkerEntrypoint ||
      raw.workers_dev !== false ||
      raw.preview_urls !== false ||
      raw.send_metrics !== false) {
    throw new Error("TLSN testplay Wrangler identity or local-isolation settings are invalid");
  }

  if (!usesOnlyTestplayCustomDomain(raw.routes)) {
    throw new Error("TLSN testplay Wrangler config must declare only its dedicated Custom Domain");
  }

  const assets = raw.assets;
  if (!assets || Object.keys(assets).length !== 2 ||
      assets.directory !== `./${TLSN_TESTPLAY_OUTPUT_DIR}` ||
      assets.binding !== "ASSETS") {
    throw new Error("TLSN testplay Wrangler assets must use the isolated build output");
  }

  const vars = raw.vars;
  if (!vars || Object.keys(vars).length !== 1 ||
      vars.PUBLIC_SITE_URL !== TLSN_TESTPLAY_SITE_URL) {
    throw new Error("TLSN testplay Wrangler config contains unexpected runtime variables");
  }
}

function assertEffectiveConfig(config) {
  const expectedMain = resolve(packageRoot, astroWorkerEntrypoint);
  const effectiveMain = resolve(packageRoot, config.main);
  const expectedAssets = resolve(packageRoot, TLSN_TESTPLAY_OUTPUT_DIR);
  const effectiveAssets = resolve(packageRoot, config.assets?.directory ?? "");
  const routes = config.routes ?? (config.route ? [config.route] : []);
  if (config.name !== TLSN_TESTPLAY_WORKER_NAME ||
      effectiveMain !== expectedMain ||
      config.workers_dev !== false ||
      config.preview_urls !== false ||
      !usesOnlyTestplayCustomDomain(routes) ||
      effectiveAssets !== expectedAssets ||
      config.assets?.binding !== "ASSETS" ||
      config.vars?.PUBLIC_SITE_URL !== TLSN_TESTPLAY_SITE_URL) {
    throw new Error("Wrangler's effective TLSN testplay config does not match the isolated profile");
  }
}

export function assertTestplayBuiltConfig(config) {
  const serverDirectory = resolve(packageRoot, TLSN_TESTPLAY_OUTPUT_DIR, "server");
  const expectedMain = resolve(serverDirectory, "entry.mjs");
  const actualMain = typeof config.main === "string"
    ? resolve(serverDirectory, config.main)
    : "";
  const expectedAssets = resolve(packageRoot, TLSN_TESTPLAY_OUTPUT_DIR, "client");
  const actualAssets = typeof config.assets?.directory === "string"
    ? resolve(serverDirectory, config.assets.directory)
    : "";
  const routes = config.routes ?? (config.route ? [config.route] : []);
  const emptyResourceArrays = [
    config.services,
    config.r2_buckets,
    config.d1_databases,
    config.kv_namespaces,
    config.workflows,
  ];
  const durableObjectBindings = config.durable_objects?.bindings ?? [];
  const queueBindings = config.queues ?? {};
  const environments = config.env ?? {};
  const vars = config.vars ?? {};

  if (config.name !== TLSN_TESTPLAY_WORKER_NAME ||
      actualMain !== expectedMain ||
      config.workers_dev !== false ||
      config.preview_urls !== false ||
      config.send_metrics !== false ||
      !usesOnlyTestplayCustomDomain(routes) ||
      actualAssets !== expectedAssets ||
      config.assets?.binding !== "ASSETS" ||
      Object.keys(config.assets ?? {}).length !== 2 ||
      Object.keys(vars).length !== 1 ||
      vars.PUBLIC_SITE_URL !== TLSN_TESTPLAY_SITE_URL ||
      emptyResourceArrays.some((bindings) => !Array.isArray(bindings) || bindings.length !== 0) ||
      !Array.isArray(durableObjectBindings) ||
      durableObjectBindings.length !== 0 ||
      !Array.isArray(queueBindings.producers) ||
      queueBindings.producers.length !== 0 ||
      !Array.isArray(queueBindings.consumers) ||
      queueBindings.consumers.length !== 0 ||
      Object.keys(environments).length !== 0) {
    throw new Error("Astro's generated TLSN testplay Wrangler config is not isolated");
  }
}

export function readAndValidateTestplayBuiltConfig() {
  const configPath = resolve(
    packageRoot,
    TLSN_TESTPLAY_OUTPUT_DIR,
    "server",
    "wrangler.json",
  );
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assertTestplayBuiltConfig(config);
  return config;
}

export function readAndValidateTestplayWranglerConfig() {
  const { rawConfig } = experimental_readRawConfig(
    { config: wranglerConfigPath },
    { hideWarnings: true },
  );
  assertTestplayRawConfig(rawConfig);
  const config = unstable_readConfig(
    { config: wranglerConfigPath },
    { hideWarnings: true },
  );
  assertEffectiveConfig(config);
  return { rawConfig, config };
}
