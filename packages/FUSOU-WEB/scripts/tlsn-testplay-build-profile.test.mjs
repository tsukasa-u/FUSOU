import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTestplayBuiltConfig,
  assertTestplayRawConfig,
  createIsolatedTestplayBuildEnvironment,
  readAndValidateTestplayWranglerConfig,
  resolveTestplaySupabase,
  TLSN_TESTPLAY_CUSTOM_DOMAIN,
  TLSN_TESTPLAY_SITE_URL,
  TLSN_TESTPLAY_WORKER_NAME,
} from "./tlsn-testplay-build-profile.mjs";

const localInputs = {
  FUSOU_TLSN_TESTPLAY_SUPABASE_URL: "http://127.0.0.1:54321",
  FUSOU_TLSN_TESTPLAY_SUPABASE_ALLOWED_HOSTS: "127.0.0.1",
};

test("the dedicated Wrangler file resolves to exactly the isolated Worker and Custom Domain", () => {
  const { config } = readAndValidateTestplayWranglerConfig();
  assert.equal(config.name, TLSN_TESTPLAY_WORKER_NAME);
  assert.deepEqual(config.routes, [{ pattern: TLSN_TESTPLAY_CUSTOM_DOMAIN, zone_name: "fusou.dev", custom_domain: true }]);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.vars.PUBLIC_SITE_URL, TLSN_TESTPLAY_SITE_URL);
});

test("the config guard rejects the normal Worker name, route, bindings, and Supabase vars", () => {
  const { rawConfig } = readAndValidateTestplayWranglerConfig();
  assert.throws(() => assertTestplayRawConfig({ ...rawConfig, name: "fusou" }));
  assert.throws(() => assertTestplayRawConfig({
    ...rawConfig,
    routes: [{ ...rawConfig.routes[0], pattern: "fusou.dev/*" }],
  }));
  assert.throws(() => assertTestplayRawConfig({
    ...rawConfig,
    routes: [{ ...rawConfig.routes[0], custom_domain: false }],
  }));
  assert.throws(() => assertTestplayRawConfig({ ...rawConfig, services: [] }));
  assert.throws(() => assertTestplayRawConfig({
    ...rawConfig,
    vars: { PUBLIC_SITE_URL: TLSN_TESTPLAY_SITE_URL, PUBLIC_SUPABASE_URL: "https://db.example.test" },
  }));
});

test("the generated Wrangler config stays on the built TLSN Worker and has no external bindings", () => {
  const builtConfig = {
    name: TLSN_TESTPLAY_WORKER_NAME,
    main: "entry.mjs",
    routes: [{ pattern: TLSN_TESTPLAY_CUSTOM_DOMAIN, zone_name: "fusou.dev", custom_domain: true }],
    workers_dev: false,
    preview_urls: false,
    send_metrics: false,
    assets: { directory: "../client", binding: "ASSETS" },
    vars: { PUBLIC_SITE_URL: TLSN_TESTPLAY_SITE_URL },
    services: [],
    r2_buckets: [],
    d1_databases: [],
    kv_namespaces: [],
    workflows: [],
    durable_objects: { bindings: [] },
    queues: { producers: [], consumers: [] },
  };
  assert.doesNotThrow(() => assertTestplayBuiltConfig(builtConfig));
  assert.throws(() => assertTestplayBuiltConfig({ ...builtConfig, name: "fusou" }));
  assert.throws(() => assertTestplayBuiltConfig({ ...builtConfig, preview_urls: true }));
  assert.throws(() => assertTestplayBuiltConfig({
    ...builtConfig,
    kv_namespaces: [{ binding: "PRODUCTION_KV" }],
  }));
  assert.throws(() => assertTestplayBuiltConfig({
    ...builtConfig,
    routes: [{ pattern: "fusou.dev/*", zone_name: "fusou.dev" }],
  }));
});

test("the build requires a single explicit verification Supabase host", () => {
  assert.deepEqual(resolveTestplaySupabase(localInputs), {
    url: "http://127.0.0.1:54321",
    hostname: "127.0.0.1",
  });
  assert.throws(() => resolveTestplaySupabase({
    ...localInputs,
    FUSOU_TLSN_TESTPLAY_SUPABASE_ALLOWED_HOSTS: "127.0.0.1,other.example.test",
  }));
  assert.throws(() => resolveTestplaySupabase({
    ...localInputs,
    PUBLIC_SUPABASE_URL: "https://production.example.test",
  }));
  assert.throws(() => resolveTestplaySupabase({
    ...localInputs,
    FUSOU_TLSN_TESTPLAY_SUPABASE_URL: "http://example.test",
    FUSOU_TLSN_TESTPLAY_SUPABASE_ALLOWED_HOSTS: "example.test",
  }));
});

test("the Astro build receives only allowlisted test inputs, not ambient secrets", () => {
  const { environment } = createIsolatedTestplayBuildEnvironment({
    ...localInputs,
    PATH: "/usr/bin",
    HOME: "/tmp",
    SUPABASE_SECRET_KEY: "not-forwarded",
    CLOUDFLARE_API_TOKEN: "not-forwarded",
    PUBLIC_SUPABASE_URL: localInputs.FUSOU_TLSN_TESTPLAY_SUPABASE_URL,
  });
  assert.equal(environment.PUBLIC_SUPABASE_URL, localInputs.FUSOU_TLSN_TESTPLAY_SUPABASE_URL);
  assert.equal(environment.PUBLIC_SITE_URL, TLSN_TESTPLAY_SITE_URL);
  assert.equal(environment.SUPABASE_SECRET_KEY, undefined);
  assert.equal(environment.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, "false");
});
