import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { canonicalJson } from "../src/origin-trust-contract.mjs";
import {
  hasActiveResultSigningKey,
  selectProductionResultRegistryBindings,
  verifySignedResultRegistryEnvelope,
} from "../src/result-registry-contract.mjs";

globalThis.crypto ??= webcrypto;

const manifestSourcePath = new URL("../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs", import.meta.url);
const appBuildReportPath = new URL("../../FUSOU-APP/src-tauri/src/tlsn_build_handoff.rs", import.meta.url);
const appPreflightSourcePath = new URL("../../FUSOU-APP/src-tauri/src/tlsn_preflight.rs", import.meta.url);
const appProxySourcePath = new URL("../../FUSOU-APP/src-tauri/src/wrap_proxy.rs", import.meta.url);
const proxyTlsnSourcePath = new URL("../../FUSOU-PROXY/proxy-https/src/production_tlsn.rs", import.meta.url);
const configsSourcePath = new URL("../../configs/src/configs.rs", import.meta.url);
const configsLibraryPath = new URL("../../configs/src/lib.rs", import.meta.url);
const handoffSourcePath = new URL("./app-build-handoff.mjs", import.meta.url);
const workerSourcePath = new URL("../src/index.ts", import.meta.url);
const workerRequestSchemaPath = new URL("../src/verification_jobs.ts", import.meta.url);

function createRegistryEnvelope() {
  const root = generateKeyPairSync("ed25519");
  const signer = generateKeyPairSync("ed25519");
  const rootKeyId = "worker-result-root-v1";
  const rootPublicKeySpki = root.publicKey.export({
    format: "der",
    type: "spki",
  }).toString("base64url");
  const signerPublicKeySpki = signer.publicKey.export({
    format: "der",
    type: "spki",
  }).toString("base64url");
  const registry = {
    schema_version: 1,
    scope: "tlsn-result-signing-key-registry",
    keys: [{
      key_id: "worker-result-v1",
      public_key_spki: signerPublicKeySpki,
      status: "ACTIVE",
      not_before: "2026-01-01T00:00:00Z",
      not_after: null,
    }],
  };
  const registryRaw = canonicalJson(registry);
  const envelopePayload = {
    schema_version: 1,
    scope: "fusou-result-signing-key-registry-envelope",
    signature_algorithm: "Ed25519",
    root_key_id: rootKeyId,
    root_public_key_spki: rootPublicKeySpki,
    registry_sha256: createHash("sha256").update(registryRaw, "utf8").digest("base64url"),
    registry,
  };
  const envelope = {
    ...envelopePayload,
    signature_base64url: sign(
      null,
      Buffer.from(canonicalJson(envelopePayload), "utf8"),
      root.privateKey,
    ).toString("base64url"),
  };
  return {
    registry,
    registryRaw,
    envelope,
    rootKeyId,
    rootPublicKeySpki,
  };
}

test("Worker verifies the exact Result registry bytes using its own root binding", async () => {
  const fixture = createRegistryEnvelope();
  assert.equal(await verifySignedResultRegistryEnvelope({
    registryRaw: fixture.registryRaw,
    registryEnvelopeRaw: JSON.stringify(fixture.envelope),
    trustedRootKeyId: fixture.rootKeyId,
    trustedRootPublicKeySpki: fixture.rootPublicKeySpki,
  }), true);
});

test("Worker selects separate Production and Canary registry roots without cross-role fallback", async () => {
  const production = createRegistryEnvelope();
  const canary = createRegistryEnvelope();
  const selected = (fixture) => ({
    publicKeySpki: fixture.registry.keys[0].public_key_spki,
    signerKeyId: fixture.registry.keys[0].key_id,
    registryRaw: fixture.registryRaw,
    registryEnvelopeRaw: JSON.stringify(fixture.envelope),
    rootKeyId: fixture.rootKeyId,
    rootPublicKeySpki: fixture.rootPublicKeySpki,
  });
  const bindings = {
    production: selected(production),
    canary: selected(canary),
  };
  const productionBindings = selectProductionResultRegistryBindings(bindings, "production");
  const canaryBindings = selectProductionResultRegistryBindings(bindings, "canary");
  assert.deepEqual(productionBindings, bindings.production);
  assert.deepEqual(canaryBindings, bindings.canary);
  assert.equal(await verifySignedResultRegistryEnvelope({
    registryRaw: productionBindings.registryRaw,
    registryEnvelopeRaw: productionBindings.registryEnvelopeRaw,
    trustedRootKeyId: productionBindings.rootKeyId,
    trustedRootPublicKeySpki: productionBindings.rootPublicKeySpki,
  }), true);
  await assert.rejects(() => verifySignedResultRegistryEnvelope({
    registryRaw: productionBindings.registryRaw,
    registryEnvelopeRaw: productionBindings.registryEnvelopeRaw,
    trustedRootKeyId: canaryBindings.rootKeyId,
    trustedRootPublicKeySpki: canaryBindings.rootPublicKeySpki,
  }));
  const missingRoot = selectProductionResultRegistryBindings({
    ...bindings,
    production: { ...bindings.production, rootKeyId: undefined, rootPublicKeySpki: undefined },
  }, "production");
  await assert.rejects(() => verifySignedResultRegistryEnvelope({
    registryRaw: missingRoot.registryRaw,
    registryEnvelopeRaw: missingRoot.registryEnvelopeRaw,
    trustedRootKeyId: missingRoot.rootKeyId,
    trustedRootPublicKeySpki: missingRoot.rootPublicKeySpki,
  }));
});

test("Worker accepts only the configured ACTIVE Result signer within its validity window", () => {
  const fixture = createRegistryEnvelope();
  const signerKeyId = fixture.registry.keys[0].key_id;
  const signerPublicKeySpki = fixture.registry.keys[0].public_key_spki;
  const nowMs = Date.parse("2026-10-24T00:00:00.000Z");
  const valid = structuredClone(fixture.registry);
  assert.equal(hasActiveResultSigningKey(valid, signerKeyId, signerPublicKeySpki, nowMs), true);

  assert.equal(hasActiveResultSigningKey(valid, "missing-result-key", signerPublicKeySpki, nowMs), false);
  assert.equal(hasActiveResultSigningKey(valid, signerKeyId, "another-public-key", nowMs), false);
  for (const [label, mutate] of [
    ["REVOKED", (key) => { key.status = "REVOKED"; }],
    ["VERIFY_ONLY", (key) => { key.status = "VERIFY_ONLY"; }],
    ["not yet valid", (key) => { key.not_before = "2026-10-25T00:00:00.000Z"; }],
    ["expired", (key) => { key.not_after = "2026-10-23T23:59:59.999Z"; }],
  ]) {
    const registry = structuredClone(fixture.registry);
    mutate(registry.keys[0]);
    assert.equal(
      hasActiveResultSigningKey(registry, signerKeyId, signerPublicKeySpki, nowMs),
      false,
      label,
    );
  }
});

for (const [label, mutate, overrides] of [
  ["the registry bytes", (fixture) => { fixture.registryRaw += "\n"; }, {}],
  ["the envelope signature", (fixture) => {
    const bytes = Buffer.from(fixture.envelope.signature_base64url, "base64url");
    bytes[0] ^= 1;
    fixture.envelope.signature_base64url = bytes.toString("base64url");
  }, {}],
  ["the envelope registry payload", (fixture) => {
    fixture.envelope.registry.keys[0].status = "REVOKED";
  }, {}],
  ["the envelope schema", (fixture) => {
    fixture.envelope.schema_version = 2;
  }, {}],
  ["the envelope scope", (fixture) => {
    fixture.envelope.scope = "another-registry";
  }, {}],
  ["the envelope signature algorithm", (fixture) => {
    fixture.envelope.signature_algorithm = "ECDSA";
  }, {}],
  ["an untrusted root key ID", () => {}, { trustedRootKeyId: "another-root" }],
  ["a missing root key ID", () => {}, { trustedRootKeyId: "" }],
  ["an untrusted root public key", () => {}, {
    trustedRootPublicKeySpki: generateKeyPairSync("ed25519").publicKey
      .export({ format: "der", type: "spki" }).toString("base64url"),
  }],
  ["a missing root public key", () => {}, { trustedRootPublicKeySpki: "" }],
  ["an unknown envelope field", (fixture) => {
    fixture.envelope.unrecognized = true;
  }, {}],
]) {
  test(`Worker rejects a Result registry bound to ${label}`, async () => {
    const fixture = createRegistryEnvelope();
    mutate(fixture);
    await assert.rejects(
      () => verifySignedResultRegistryEnvelope({
        registryRaw: fixture.registryRaw,
        registryEnvelopeRaw: JSON.stringify(fixture.envelope),
        trustedRootKeyId: overrides.trustedRootKeyId ?? fixture.rootKeyId,
        trustedRootPublicKeySpki: overrides.trustedRootPublicKeySpki ?? fixture.rootPublicKeySpki,
      }),
    );
  });
}

test("APP build source contains only Bootstrap pins and uses Manifest-approved Origin targets", async () => {
  const [manifestSource, configsSource, configsLibrary, buildReportSource, handoffSource, appPreflightSource, appProxySource, proxyTlsnSource] = await Promise.all([
    readFile(manifestSourcePath, "utf8"),
    readFile(configsSourcePath, "utf8"),
    readFile(configsLibraryPath, "utf8"),
    readFile(appBuildReportPath, "utf8"),
    readFile(handoffSourcePath, "utf8"),
    readFile(appPreflightSourcePath, "utf8"),
    readFile(appProxySourcePath, "utf8"),
    readFile(proxyTlsnSourcePath, "utf8"),
  ]);
  const pins = [...manifestSource.matchAll(/option_env!\("([^"]+)"\)/g)]
    .map((match) => match[1])
    .filter((name) => name.startsWith("FUSOU_TLSN_"));
  assert.deepEqual(pins.sort(), [
    "FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL",
    "FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID",
    "FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI",
  ]);
  assert.doesNotMatch(configsSource, /get_tlsn_origin_inventory|TlsnOriginInventory|tlsn-origin-inventory\.json/);
  assert.doesNotMatch(configsLibrary, /get_tlsn_origin_inventory|TlsnOriginInventory|TlsnOriginTarget/);
  assert.doesNotMatch(configsSource, /option_env!\("FUSOU_TLSN_/);
  assert.doesNotMatch(configsLibrary, /get_tlsn_compile_inputs/);
  assert.doesNotMatch(buildReportSource, /get_tlsn_compile_inputs|worker_source_sha|active_version_id|entry_input_sha256/);
  assert.doesNotMatch(handoffSource, /\.\.\.reference\.compile_inputs/);
  assert.doesNotMatch(appPreflightSource, /get_tlsn_(?:notary_endpoint|verification_endpoint|worker_health_endpoint)/);
  assert.doesNotMatch(appPreflightSource, /get_tlsn_origin_inventory/);
  assert.doesNotMatch(appProxySource, /ServerIdentityPolicy::from_shipped_inventory/);
  assert.match(appProxySource, /ServerIdentityPolicy::from_approved_targets\([\s\S]*approved_targets\(\)[\s\S]*approved\.port\(\)/);
  assert.doesNotMatch(proxyTlsnSource, /get_tlsn_origin_inventory|from_shipped_inventory/);
  assert.match(proxyTlsnSource, /pub fn from_approved_targets\([\s\S]*Vec<\(String, u16\)>/);
  assert.match(proxyTlsnSource, /server_identity_policy\.allows_target\(&self\.target\)/);
});

test("Worker reads its Result registry root from bindings, not from APP request fields", async () => {
  const [workerSource, requestSchema] = await Promise.all([
    readFile(workerSourcePath, "utf8"),
    readFile(workerRequestSchemaPath, "utf8"),
  ]);
  const requestStart = requestSchema.indexOf("export const verificationInputRequestSchema =");
  const statusSchemaStart = requestSchema.indexOf("export const verificationStatusRequestSchema =", requestStart);
  assert(requestStart >= 0 && statusSchemaStart > requestStart);
  const externalRequestSchema = requestSchema.slice(requestStart, statusSchemaStart);
  assert.match(workerSource, /TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE\?: string/);
  assert.match(workerSource, /TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI\?: string/);
  assert.match(workerSource, /TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI\?: string/);
  assert.match(workerSource, /selectProductionResultRegistryBindings\(/);
  assert.match(workerSource, /hasActiveResultSigningKey\(/);
  assert.match(workerSource, /verifySignedResultRegistryEnvelope\(/);
  assert.match(workerSource, /if \(production && !resultIdentityConfigured\) return null/);
  assert.match(workerSource, /if \(production \|\| resultRegistryTrustConfigured\)/);
  assert.match(workerSource, /productionRuntimeTrustIdentity\(env\)/);
  assert.match(workerSource, /inspect_alpha15_server_identity\(/);
  assert.match(workerSource, /resolveApprovedProductionIdentity\(/);
  assert.match(workerSource, /canaryRuntimeConfigValid = await readConfig\(c\.env\) !== null/);
  assert.match(workerSource, /const config = await readConfig\(c\.env\)/);
  assert.doesNotMatch(workerSource, /FUSOU_TLSN_RUNTIME_CONFIG_(?:MANIFEST_URL|SIGNER_KEY_ID|SIGNER_PUBLIC_KEY_SPKI)/);
  assert.match(externalRequestSchema, /\.strict\(\)/);
  assert.doesNotMatch(externalRequestSchema, /result_registry_root|notary_registry|origin_inventory_sha256/);
});
