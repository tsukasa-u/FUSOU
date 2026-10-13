#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { canonicalJson } from "./production-trust-contract.mjs";
import {
  createTlsnRuntimeConfigEnvelopeRaw,
  prepareTlsnRuntimeConfigManifest,
  tlsnRuntimeConfigSigningBytes,
  verifyTlsnRuntimeConfigEnvelope,
} from "./tlsn-runtime-config-manifest.mjs";
import {
  account,
  controls,
  customMapping,
  now,
  release,
  version1,
} from "./app-worker-reference-fixture.mjs";
import { createAppWorkerReference } from "./app-worker-deployment-reference.mjs";

const signerKeyId = "runtime-config-test";
const keyPair = generateKeyPairSync("ed25519");
const trustedSigner = {
  scope: "fusou-tlsn-runtime-config-signing-root-v1",
  key_id: signerKeyId,
  public_key_spki: keyPair.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
};

function referenceRaw(selectedRelease = release, selectedVersion = version1) {
  const observed = controls(selectedRelease, selectedVersion);
  const reference = createAppWorkerReference(
    selectedRelease,
    observed.deployment,
    observed.version,
    account,
    now,
    customMapping(selectedRelease),
  );
  return Buffer.from(`${JSON.stringify(reference, null, 2)}\n`);
}

function preparedOptions(reference = referenceRaw(), selectedRelease = release, epoch = "1") {
  const issuedAt = new Date(Date.parse(now)).toISOString();
  return prepareTlsnRuntimeConfigManifest({
    workerReferenceRaw: reference,
    approvedRelease: selectedRelease,
    epoch,
    issuedAt,
    notBefore: issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 30 * 60 * 1000).toISOString(),
  });
}

function policy(prepared, overrides = {}) {
  const observedAt = Date.parse(prepared.payload.source.observed_at);
  return {
    now_ms: observedAt + 1000,
    last_accepted_epoch: "0",
    max_lifetime_seconds: 3600,
    max_clock_skew_seconds: 30,
    max_reference_age_seconds: 600,
    max_envelope_bytes: 1024 * 1024,
    ...overrides,
  };
}

function signedRaw(prepared, overrides = {}) {
  const payload = { ...prepared.payload, ...overrides };
  const payloadBase64Url = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  const signatureBase64Url = sign(
    null,
    tlsnRuntimeConfigSigningBytes(signerKeyId, payload),
    keyPair.privateKey,
  ).toString("base64url");
  return createTlsnRuntimeConfigEnvelopeRaw({
    signerKeyId,
    payloadBase64Url,
    signatureBase64Url,
  });
}

function signedRawPayloadBytes(payloadBytes) {
  const keyIdBytes = Buffer.from(signerKeyId, "utf8");
  const keyIdLength = Buffer.alloc(2);
  keyIdLength.writeUInt16BE(keyIdBytes.length);
  const signatureBase64Url = sign(
    null,
    Buffer.concat([
      Buffer.from("FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V1\0", "ascii"),
      keyIdLength,
      keyIdBytes,
      payloadBytes,
    ]),
    keyPair.privateKey,
  ).toString("base64url");
  return createTlsnRuntimeConfigEnvelopeRaw({
    signerKeyId,
    payloadBase64Url: payloadBytes.toString("base64url"),
    signatureBase64Url,
  });
}

test("manifest preparation binds the exact approved Worker reference and mandatory Production authority pair", () => {
  const rawReference = referenceRaw();
  const prepared = preparedOptions(rawReference);

  assert.equal(prepared.payload.schema_version, 1);
  assert.equal(prepared.payload.environment, "production");
  assert.equal(
    prepared.payload.source.worker_reference_sha256,
    createHash("sha256").update(rawReference).digest("base64url"),
  );
  assert.equal(
    prepared.payload.production_authority_pins.origin_inventory_sha256,
    release.production_authority_pins.origin_inventory_sha256,
  );
  assert.equal(
    prepared.payload.production_authority_pins.target_approval_artifact_sha256,
    release.production_authority_pins.target_approval_artifact_sha256,
  );
  assert.equal(prepared.payload.source.active_version_id, version1);
  assert.equal(
    prepared.signing_bytes(signerKeyId),
    tlsnRuntimeConfigSigningBytes(signerKeyId, prepared.payload).toString("base64url"),
  );
  assert.throws(
    () => createTlsnRuntimeConfigEnvelopeRaw({
      signerKeyId,
      payloadBase64Url: prepared.payload_base64url,
      signatureBase64Url: "A",
    }),
    /canonical unpadded base64url/,
  );
  assert.deepEqual(
    Object.keys(prepared.payload.compile_inputs).sort(),
    Object.keys(JSON.parse(rawReference.toString()).compile_inputs).sort(),
  );
  assert.ok(!JSON.stringify(prepared.payload).includes("private-control-plane-test-token"));
  assert.ok(!JSON.stringify(prepared.payload).includes("private-worker-key"));
  assert.ok(!("game_server_identity" in prepared.payload));
  assert.ok(!("observed_server_identity" in prepared.payload));
});

test("signed envelope verifies only with an explicit scoped external trust pin and policy", () => {
  const prepared = preparedOptions();
  const raw = signedRaw(prepared);
  const verified = verifyTlsnRuntimeConfigEnvelope(raw, {
    trustedSigner,
    policy: policy(prepared),
  });
  assert.equal(verified.epoch, "1");
  assert.equal(verified.compile_inputs.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID, version1);
  assert.throws(() => verifyTlsnRuntimeConfigEnvelope(raw), /trusted configuration signer field inventory/);
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner: { ...trustedSigner, key_id: "invalid key id" },
      policy: policy(prepared),
    }),
    /key ID is invalid/,
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner: { ...trustedSigner, public_key_spki: "A" },
      policy: policy(prepared),
    }),
    /canonical unpadded base64url/,
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner: { ...trustedSigner, scope: "fusou-result-signing-key-registry-envelope" },
      policy: policy(prepared),
    }),
    /not scoped to runtime configuration/,
  );
});

test("signer identity, signature, envelope bytes and payload bytes are strict", () => {
  const prepared = preparedOptions();
  const raw = signedRaw(prepared);
  const wrongSigner = { ...trustedSigner, key_id: "other-config-key" };
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, { trustedSigner: wrongSigner, policy: policy(prepared) }),
    /does not match the external trust pin/,
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(`${raw} `, { trustedSigner, policy: policy(prepared) }),
    /not canonical JSON/,
  );
  const envelope = JSON.parse(raw);
  const changedSignature = Buffer.from(envelope.signature_base64url, "base64url");
  changedSignature[0] ^= 1;
  envelope.signature_base64url = changedSignature.toString("base64url");
  const badSignature = canonicalJson(envelope);
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(badSignature, { trustedSigner, policy: policy(prepared) }),
    /signature verification failed/,
  );
  const changedPayload = Buffer.from(envelope.payload_base64url, "base64url");
  changedPayload[changedPayload.length - 1] ^= 1;
  envelope.payload_base64url = changedPayload.toString("base64url");
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(canonicalJson(envelope), { trustedSigner, policy: policy(prepared) }),
    /signature verification failed/,
  );
});

test("payload parsing follows signature authentication and rejects duplicate keys and lone surrogates", () => {
  const prepared = preparedOptions();
  const semanticMutation = structuredClone(prepared.payload);
  semanticMutation.source.logical_deployment_id = "";
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(
      signedRawPayloadBytes(Buffer.from(canonicalJson(semanticMutation), "utf8")),
      { trustedSigner, policy: policy(prepared) },
    ),
    /Worker source identity is invalid/,
  );

  const canonicalPayload = canonicalJson(prepared.payload);
  const duplicateKeyPayload = Buffer.from(
    canonicalPayload.replace('"schema_version":1,', '"schema_version":1,"schema_version":1,'),
    "utf8",
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(
      signedRawPayloadBytes(duplicateKeyPayload),
      { trustedSigner, policy: policy(prepared) },
    ),
    /payload is not canonical JSON/,
  );

  const invalidUnicode = structuredClone(prepared.payload);
  invalidUnicode.source.logical_deployment_id = "\ud800";
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(
      signedRawPayloadBytes(Buffer.from(canonicalJson(invalidUnicode), "utf8")),
      { trustedSigner, policy: policy(prepared) },
    ),
    /invalid Unicode string/,
  );

  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(
      signedRawPayloadBytes(Buffer.from("{", "utf8")),
      { trustedSigner, policy: policy(prepared) },
    ),
    /payload is malformed JSON/,
  );
});

test("rollback, expiry, future issuance, stale reference and explicit byte limits fail closed", () => {
  const prepared = preparedOptions();
  const raw = signedRaw(prepared);
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner,
      policy: policy(prepared, { last_accepted_epoch: "1" }),
    }),
    /not newer than the persisted high-water mark/,
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner,
      policy: policy(prepared, { now_ms: Date.parse(prepared.payload.expires_at) + 60_000 }),
    }),
    /validity window is invalid or not current/,
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner,
      policy: policy(prepared, { max_lifetime_seconds: 60 }),
    }),
    /validity window is invalid or not current/,
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner,
      policy: policy(prepared, { now_ms: Date.parse(now) + 20 * 60 * 1000 }),
    }),
    /Worker reference is not fresh/,
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner,
      policy: policy(prepared, { max_envelope_bytes: Buffer.byteLength(raw) - 1 }),
    }),
    /exceeds the supplied byte limit/,
  );
});

test("future, expired, noncanonical, and out-of-order signed validity windows are rejected", () => {
  const prepared = preparedOptions();
  const future = signedRaw(prepared, {
    issued_at: "2099-01-01T00:00:00.000Z",
    not_before: "2099-01-01T00:00:00.000Z",
    expires_at: "2099-01-01T00:30:00.000Z",
  });
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(future, { trustedSigner, policy: policy(prepared) }),
    /validity window is invalid or not current/,
  );
  for (const overrides of [
    { issued_at: "2030-01-01T00:01:00.000Z", not_before: "2030-01-01T00:00:00.000Z" },
    { expires_at: "2030-01-01T00:00:00.000Z" },
  ]) {
    const raw = signedRaw(prepared, overrides    );
    assert.throws(
      () => tlsnRuntimeConfigSigningBytes("runtime-config-test", {
        ...preparedOptions().payload,
        not_before: "2030-01-01T00:00:00Z",
      }),
      /canonical UTC RFC3339/,
    );
    assert.throws(() => verifyTlsnRuntimeConfigEnvelope(raw, { trustedSigner, policy: policy(prepared) }));
  }
});

test("reference and Production policy mutations cannot be promoted by the manifest contract", () => {
  const sourceRaw = referenceRaw();
  const reorderedReference = Buffer.from(sourceRaw.toString().replace('"schema_version": 2', '"schema_version": 2 '));
  assert.throws(
    () => preparedOptions(reorderedReference),
    /not in the captured canonical format/,
  );
  const changedRelease = {
    ...release,
    compile_inputs: {
      ...release.compile_inputs,
      FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID: "5b064508-1cdb-453c-826b-bdea36a8b1e5",
    },
  };
  assert.throws(() => preparedOptions(sourceRaw, changedRelease), /compile inputs.*field inventory/);
  const missingPair = {
    ...release,
    production_authority_pins: {
      ...release.production_authority_pins,
      target_approval_artifact_sha256: null,
    },
  };
  assert.throws(() => preparedOptions(sourceRaw, missingPair), /target_approval_artifact_sha256/);
  const canaryRelease = {
    ...release,
    compile_inputs: {
      ...release.compile_inputs,
      FUSOU_TLSN_EXPECTED_BINDING_MODE: "fixed_canary",
    },
  };
  assert.throws(() => preparedOptions(sourceRaw, canaryRelease), /independently approved release/);
});

test("the complete Production compile-input set is required and unknown fields are rejected", () => {
  const prepared = preparedOptions();
  for (const payload of [
    {
      ...prepared.payload,
      compile_inputs: Object.fromEntries(
        Object.entries(prepared.payload.compile_inputs).filter(([name]) => name !== "FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID"),
      ),
    },
    {
      ...prepared.payload,
      compile_inputs: { ...prepared.payload.compile_inputs, PRIVATE_SIGNING_KEY: "private-value" },
    },
    { ...prepared.payload, server_identity: "unobserved.example.com" },
  ]) {
    assert.throws(
      () => tlsnRuntimeConfigSigningBytes(signerKeyId, payload),
      /field inventory is invalid/,
    );
  }
});

test("Notary key and Production authority pin boundaries fail closed", () => {
  const prepared = preparedOptions();
  const cases = [
    ["nil deployment UUID", (payload) => { payload.source.cloudflare_deployment_id = "00000000-0000-0000-0000-000000000000"; }, /Worker source identity is invalid/],
    ["nil active version UUID", (payload) => { payload.source.active_version_id = "00000000-0000-0000-0000-000000000000"; }, /Worker source identity is invalid/],
    ["invalid Worker account ID", (payload) => { payload.source.account_id = "Z".repeat(32); }, /Worker source identity is invalid/],
    ["invalid Worker name", (payload) => { payload.source.script_name = "Uppercase-Worker"; }, /Worker source identity is invalid/],
    ["malformed Worker reference digest", (payload) => { payload.source.worker_reference_sha256 = "A"; }, /SHA-256/],
    ["missing Origin Inventory pin", (payload) => { payload.production_authority_pins.origin_inventory_sha256 = ""; }, /SHA-256/],
    ["missing Target Approval pin", (payload) => { payload.production_authority_pins.target_approval_artifact_sha256 = ""; }, /SHA-256/],
    ["malformed security registry pin", (payload) => { payload.production_authority_pins.security_registry_set_sha256 = "A"; }, /SHA-256/],
    ["unsupported Notary algorithm", (payload) => {
      const bytes = Buffer.from(payload.compile_inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY, "base64url");
      bytes[0] = 0;
      payload.compile_inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY = bytes.toString("base64url");
    }, /alpha\.15 K256/],
    ["malformed Notary base64url", (payload) => { payload.compile_inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY = "A"; }, /canonical base64url/],
    ["out-of-field Notary point", (payload) => {
      const bytes = Buffer.from(payload.compile_inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY, "base64url");
      bytes.fill(0xff, 9);
      payload.compile_inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY = bytes.toString("base64url");
    }, /canonical TLSNotary alpha\.15 K256/],
  ];

  for (const [label, mutate, expected] of cases) {
    const payload = structuredClone(prepared.payload);
    mutate(payload);
    assert.throws(() => tlsnRuntimeConfigSigningBytes(signerKeyId, payload), expected, label);
  }
});

test("Worker endpoint mapping and Result registry failures reject malformed signed inputs", () => {
  const prepared = preparedOptions();
  const sparse = structuredClone(prepared.payload);
  sparse.source.disclosure_mode = "sparse";
  const workerOrigin = new URL(
    sparse.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT,
  ).origin;
  sparse.compile_inputs.FUSOU_TLSN_VERIFICATION_ENDPOINT = `${workerOrigin}/verify/tlsn/sparse`;
  assert.doesNotThrow(() => tlsnRuntimeConfigSigningBytes(signerKeyId, sparse));

  const cases = [
    ["Notary endpoint without port", (payload) => { payload.compile_inputs.FUSOU_TLSN_NOTARY_ENDPOINT = "notary.example.test"; }, /Notary endpoint/],
    ["Notary endpoint invalid port", (payload) => { payload.compile_inputs.FUSOU_TLSN_NOTARY_ENDPOINT = "notary.example.test:65536"; }, /valid port/],
    ["Notary endpoint signed port", (payload) => { payload.compile_inputs.FUSOU_TLSN_NOTARY_ENDPOINT = "notary.example.test:+7047"; }, /valid port/],
    ["unbracketed IPv6 Notary endpoint", (payload) => { payload.compile_inputs.FUSOU_TLSN_NOTARY_ENDPOINT = "2001:db8::1:7047"; }, /host:port syntax/],
    ["malformed bracketed Notary host", (payload) => { payload.compile_inputs.FUSOU_TLSN_NOTARY_ENDPOINT = "[[::1]]:7047"; }, /valid port/],
    ["HTTP health endpoint", (payload) => { payload.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT = "http://worker.example.test/health"; }, /clean HTTPS DNS URL/],
    ["credential-bearing health endpoint", (payload) => { payload.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT = "https://user@worker.example.test/health"; }, /clean HTTPS DNS URL/],
    ["explicit default HTTPS port", (payload) => { payload.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT = "https://worker.example.test:443/health"; }, /clean HTTPS DNS URL/],
    ["health endpoint query", (payload) => { payload.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT = "https://worker.example.test/health?x=1"; }, /clean HTTPS DNS URL/],
    ["health endpoint fragment", (payload) => { payload.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT = "https://worker.example.test/health#fragment"; }, /clean HTTPS DNS URL/],
    ["noncanonical host casing", (payload) => { payload.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT = "https://WORKER.example.test/health"; }, /clean HTTPS DNS URL/],
    ["IP health endpoint", (payload) => { payload.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT = "https://127.0.0.1/health"; }, /clean HTTPS DNS URL/],
    ["health endpoint with wrong path", (payload) => { payload.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT = "https://worker.example.test/not-health"; }, /clean HTTPS DNS URL/],
    ["unsupported disclosure mode", (payload) => { payload.source.disclosure_mode = "mixed"; }, /Worker source identity is invalid/],
    ["sparse disclosure with complete endpoint", (payload) => {
      payload.source.disclosure_mode = "sparse";
    }, /clean HTTPS DNS URL/],
    ["verification endpoint on a different origin", (payload) => { payload.compile_inputs.FUSOU_TLSN_VERIFICATION_ENDPOINT = "https://other.example.test/verify/tlsn"; }, /origins disagree/],
    ["session endpoint with wrong path", (payload) => { payload.compile_inputs.FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT = "https://worker.example.test/attestation/other"; }, /clean HTTPS DNS URL/],
    ["Result registry with noncanonical timestamp", (payload) => {
      const registry = JSON.parse(payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY);
      registry.keys[0].not_before = "2020-01-01T00:00:00Z";
      payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY = JSON.stringify(registry);
    }, /canonical UTC RFC3339/],
    ["Result registry with noncanonical expiry", (payload) => {
      const registry = JSON.parse(payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY);
      registry.keys[0].not_after = "2099-01-01T00:00:00Z";
      payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY = JSON.stringify(registry);
    }, /canonical UTC RFC3339/],
    ["Result signer missing from registry", (payload) => {
      payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID = "unknown-result-key";
    }, /not .*published registry|does not match/],
    ["inactive Result signer", (payload) => {
      const registry = JSON.parse(payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY);
      registry.keys[0].status = "VERIFY_ONLY";
      payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY = JSON.stringify(registry);
    }, /ACTIVE/],
    ["expired Result signer", (payload) => {
      const registry = JSON.parse(payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY);
      const expiresAt = Date.parse(payload.source.observed_at) - 1000;
      registry.keys[0].not_before = new Date(expiresAt - 1000).toISOString();
      registry.keys[0].not_after = new Date(expiresAt).toISOString();
      payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY = JSON.stringify(registry);
    }, /validity window/],
  ];

  for (const [label, mutate, expected] of cases) {
    const payload = structuredClone(prepared.payload);
    mutate(payload);
    assert.throws(() => tlsnRuntimeConfigSigningBytes(signerKeyId, payload), expected, label);
  }
});

test("the Node-produced cross-language golden vector verifies without a production trust root", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/tlsn-runtime-config-manifest-v1-vector.json", import.meta.url),
    "utf8",
  ));
  assert.equal(fixture.test_only, true);
  const raw = gunzipSync(Buffer.from(fixture.envelope_gzip_base64url, "base64url"));
  assert.equal(raw.length, fixture.envelope_uncompressed_bytes);
  const envelope = JSON.parse(raw.toString("utf8"));
  const payloadBytes = Buffer.from(envelope.payload_base64url, "base64url");
  const payload = JSON.parse(payloadBytes.toString("utf8"));
  const observedAt = Date.parse(payload.source.observed_at);
  const verified = verifyTlsnRuntimeConfigEnvelope(raw, {
    trustedSigner: fixture.trusted_signer,
    policy: {
      now_ms: observedAt + 1000,
      last_accepted_epoch: "0",
      max_lifetime_seconds: 3600,
      max_clock_skew_seconds: 30,
      max_reference_age_seconds: 600,
      max_envelope_bytes: 4096,
    },
  });
  assert.equal(verified.epoch, "1");
});
