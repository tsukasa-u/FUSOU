import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { acquireAppWorkerReference, approvedProductionRelease, createAppWorkerReference } from "./app-worker-deployment-reference.mjs";
import { assertWorkerEndpointMapping } from "./app-worker-endpoint-mapping.mjs";
import {
  environment, provenance, manifest, release, controls, account, now, version2,
  controlPlaneResponse,
} from "./app-worker-reference-fixture.mjs";

async function acquire(mutate = () => {}, selectedEnvironment = environment, selectedManifest = manifest) {
  return acquireAppWorkerReference({
    environment: selectedEnvironment, provenance, publicManifest: selectedManifest,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, "error");
      const payload = controlPlaneResponse(url);
      mutate(payload, url);
      return new Response(JSON.stringify(payload));
    },
  });
}

test("Custom Domain maps approved HTTPS origin to the authenticated account/script with no overriding routes", async () => {
  const record = await acquire();
  assert.equal(record.schema_version, 2);
  assert.equal(record.endpoint_mapping.kind, "custom_domain");
  assert.equal(record.endpoint_mapping.script_name, record.cloudflare.script_name);
  assert.equal(record.endpoint_mapping.account_id, record.cloudflare.account_id);
  assert.equal(record.endpoint_mapping.schema_version, 1);
  assert.equal(record.endpoint_mapping.empty_worker_routes, true);
  const input = controls(release);
  assert.throws(() => createAppWorkerReference(release, input.deployment, input.version, account, now), /mapping is missing/);
});

test("Custom Domain on a shared zone accepts and records only disjoint literal host routes", async () => {
  const routes = [
    { pattern: "example.com/*", script: "ordinary-web" },
    { pattern: "https://s.example.com/*", script: "url-shortener" },
  ];
  let observations = 0;
  const record = await acquire((p, url) => {
    if (url.includes("/workers/domains?")) {
      p.result[0].id = "c".repeat(38);
      p.result[0].enabled = true;
    }
    if (url.endsWith("/workers/routes")) {
      p.result = ++observations === 1 ? routes : routes.toReversed();
      p.result_info = { page: 1, total_pages: 1, total_count: 2, count: 2 };
    }
  });
  assert.equal(observations, 2);
  const mapping = record.endpoint_mapping;
  assert.equal(mapping.schema_version, 2);
  assert.equal(mapping.domain_id, "c".repeat(38));
  assert.equal(mapping.no_overriding_worker_routes, true);
  assert.equal(mapping.worker_routes_sha256, createHash("sha256")
    .update(JSON.stringify(routes.map((route) => route.pattern).sort())).digest("base64url"));
  const args = [mapping.origin, mapping.account_id, mapping.script_name];
  assert.equal(assertWorkerEndpointMapping(mapping, ...args), mapping);
  for (const mutation of [
    { no_overriding_worker_routes: false },
    { worker_routes_sha256: "x".repeat(43) },
    { schema_version: 1 },
    { empty_worker_routes: true },
  ]) {
    assert.throws(() => assertWorkerEndpointMapping({ ...mapping, ...mutation }, ...args), /mapping/);
  }
});

test("Custom Domain refuses partial inventories and routes whose authority cannot be proved disjoint", async () => {
  for (const pattern of [
    "production-worker.example.com/attestation/*",
    "HTTPS://PRODUCTION-WORKER.example.com/health",
    "*.example.com/*",
    "*example.com/*",
    "*.unrelated.example.com/*",
    "example.com:443/*",
    "example.com\\production-worker.example.com/*",
    "other.invalid/*",
    "example.com/*\n",
  ]) {
    await assert.rejects(acquire((p, url) => {
      if (url.endsWith("/workers/routes")) p.result = [{ pattern }];
    }), /Worker Routes/, pattern);
  }
  for (const resultInfo of [{ total_pages: 2 }, { total_count: 3 }, { cursors: { after: "next" } }]) {
    await assert.rejects(acquire((p, url) => {
      if (!url.endsWith("/workers/routes")) return;
      p.result = [{ pattern: "example.com/*" }];
      p.result_info = resultInfo;
    }), /Worker Routes inventory is incomplete/);
  }
});

test("missing/wrong/ambiguous Custom Domain, account, script, environment, zone and overriding routes fail closed", async () => {
  for (const [label, path, mutate] of [
    ["Route-only", "/workers/domains?", (p) => { p.result = []; }],
    ["wrong host", "/workers/domains?", (p) => { p.result[0].hostname = "other.example.com"; }],
    ["wrong script", "/workers/domains?", (p) => { p.result[0].service = "another-worker"; }],
    ["disabled domain", "/workers/domains?", (p) => { p.result[0].enabled = false; }],
    ["malformed domain ID", "/workers/domains?", (p) => { p.result[0].id = "not/an/id"; }],
    ["duplicate", "/workers/domains?", (p) => { p.result.push(p.result[0]); }],
    ["partial page", "/workers/domains?", (p) => { p.result_info.total_pages = 2; }],
    ["missing environment", "/workers/domains?", (p) => { delete p.result[0].environment; }],
    ["legacy environment", "/workers/domains?", (p) => { p.result[0].environment = "other"; }],
    ["wrong account", `/zones/${"b".repeat(32)}`, (p) => { p.result.account.id = "d".repeat(32); }],
    ["wrong zone", `/zones/${"b".repeat(32)}`, (p) => { p.result.id = "d".repeat(32); }],
    ["inactive zone", `/zones/${"b".repeat(32)}`, (p) => { p.result.status = "pending"; }],
    ["missing routes", "/workers/routes", (p) => { delete p.result; }],
    ["override route", "/workers/routes", (p) => { p.result = [{ id: "d".repeat(32), pattern: "*.example.com/*", script: "another-worker" }]; }],
    ["same script route", "/workers/routes", (p) => { p.result = [{ id: "d".repeat(32), pattern: "production-worker.example.com/*", script: "fusou-tlsn-production" }]; }],
  ]) {
    await assert.rejects(acquire((payload, url) => { if (url.includes(path)) mutate(payload); }), undefined, label);
  }
});

test("workers.dev requires the independently approved account subdomain and enabled expected script, never preview URLs", async () => {
  const origin = "https://fusou-tlsn-production.approved-account.workers.dev";
  const selectedEnvironment = { ...environment, TLSN_VERIFY_WORKER_URL: origin };
  const selectedManifest = structuredClone(manifest);
  selectedManifest.verification_endpoint = `${origin}/verify/tlsn`;
  selectedManifest.session_authority.endpoint = `${origin}/attestation/session`;
  const selectedRelease = approvedProductionRelease(selectedEnvironment, provenance, selectedManifest);
  async function observe(subdomain, enabled) {
    return acquireAppWorkerReference({
      environment: selectedEnvironment, provenance, publicManifest: selectedManifest,
      fetchImpl: async (url) => {
        const payload = url.endsWith("/workers/subdomain")
          ? { success: true, result: { subdomain } }
          : url.endsWith("/subdomain")
            ? { success: true, result: { enabled, previews_enabled: true } }
            : controlPlaneResponse(url, selectedRelease);
        return new Response(JSON.stringify(payload));
      },
    });
  }
  assert.equal((await observe("approved-account", true)).endpoint_mapping.kind, "workers_dev");
  for (const [subdomain, enabled] of [["wrong-account", true], ["approved-account", false], [undefined, true], ["approved-account", undefined]]) {
    await assert.rejects(observe(subdomain, enabled), /workers.dev mapping/);
  }
});

test("mapping and active deployment are both re-observed; rotation/partial traffic/routing races are rejected", async () => {
  for (const [path, mutate, boundary] of [
    ["/deployments", (p) => { p.result.deployments[0].versions[0].version_id = version2; }, /deployment changed/],
    ["/deployments", (p) => { p.result.deployments[0].id = "7b064508-1cdb-453c-826b-bdea36a8b1e5"; }, /deployment changed/],
    ["/deployments", (p) => { p.result.deployments[0].versions[0].percentage = 50; }, /100%/],
    ["/workers/domains?", (p) => { p.result[0].id = "d".repeat(32); }, /mapping changed/],
    ["/workers/routes", (p) => { p.result.push({ pattern: "*.example.com/*", script: "another-worker" }); }, /Worker Routes/],
    ["/workers/routes", (p) => { p.result.push({ pattern: "example.com/*", script: "ordinary-web" }); }, /mapping changed/],
  ]) {
    let observations = 0;
    await assert.rejects(acquire((payload, url) => {
      if (url.includes(path) && ++observations === 2) mutate(payload);
    }), boundary);
  }
});

test("Cloudflare HTTP/permission/redirect/network/JSON failures are explicit and never disclose credentials", async () => {
  const secret = environment.CLOUDFLARE_API_TOKEN;
  for (const fetchImpl of [
    async () => new Response(secret, { status: 403 }),
    async () => new Response(secret, { status: 404 }),
    async () => new Response(secret, { status: 503 }),
    async () => new Response(secret, { status: 302 }),
    async () => new Response(`{"private_token":"${secret}"`),
    async () => { throw new Error(`network exception containing ${secret}`); },
    async () => new Response(JSON.stringify({ success: false, result: null, errors: [{ message: secret }] })),
    async () => {
      const response = new Response(JSON.stringify(controlPlaneResponse("https://mock/deployments")));
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
    async () => {
      const response = new Response(JSON.stringify(controlPlaneResponse("https://mock/deployments")));
      Object.defineProperty(response, "url", { value: "https://another-host.example.com/deployments" });
      return response;
    },
  ]) {
    await assert.rejects(acquireAppWorkerReference({ environment, provenance, publicManifest: manifest, fetchImpl }), (error) => {
      assert.match(error.message, /Cloudflare/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  for (const status of [403, 404, 500]) {
    await assert.rejects(acquireAppWorkerReference({
      environment, provenance, publicManifest: manifest,
      fetchImpl: async (url) => url.includes("/workers/domains?")
        ? new Response(secret, { status }) : new Response(JSON.stringify(controlPlaneResponse(url))),
    }), new RegExp(`failed \\(${status}\\)`));
  }
  await assert.rejects(acquire((payload, url) => {
    if (url.includes("/versions/")) payload.result.id = version2;
  }), /active deployment\/version/);
  await assert.rejects(acquire((payload, url) => {
    if (url.includes("/versions/")) payload.result.resources.bindings = [];
  }), /approved release binding/);
  await assert.rejects(acquire((payload, url) => {
    if (url.includes("/versions/")) payload.result.resources.bindings.push(null);
  }), /binding metadata is invalid/);
});
