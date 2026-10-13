#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { canonicalJson } from "./production-trust-contract.mjs";
import {
  createTlsnRuntimeConfigPublicationObjects,
  createTlsnRuntimeConfigEnvelopeRaw,
  prepareTlsnRuntimeConfigManifest,
  tlsnRuntimeConfigSigningBytes,
  verifyTlsnRuntimeConfigEnvelope,
  verifyTlsnRuntimeConfigProductionEnvelope,
} from "./tlsn-runtime-config-manifest.mjs";
import {
  publishTlsnRuntimeConfig,
  publishTlsnRuntimeConfigForTest,
  signTlsnRuntimeConfigManifest,
  signTlsnRuntimeConfigManifestForTest,
} from "./tlsn-runtime-config-release.mjs";
import { createTestOnlyRuntimeConfigObjectStore } from "./tlsn-runtime-config-test-only-store.mjs";
import { RuntimeConfigPointerConflictError } from "./tlsn-runtime-config-r2-store.mjs";
import { verifyTlsnRuntimeConfigIndependentInputs } from "./tlsn-runtime-config-independent-verification.mjs";
import {
  account,
  controls,
  customMapping,
  controlPlaneResponse,
  environment,
  manifest,
  now,
  provenance,
  release,
  version1,
  version2,
} from "./app-worker-reference-fixture.mjs";
import { createAppWorkerReference } from "./app-worker-deployment-reference.mjs";
import { productionSecurityRegistrySetHash } from "./security-registry-set-contract.mjs";

const signerKeyId = "runtime-config-test";
const keyPair = generateKeyPairSync("ed25519");
const trustedSigner = {
  scope: "fusou-tlsn-runtime-config-signing-root-v2",
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
    last_accepted_manifest_sha256: null,
    max_lifetime_seconds: 3600,
    max_clock_skew_seconds: 30,
    max_reference_age_seconds: 600,
    max_envelope_bytes: 1024 * 1024,
    ...overrides,
  };
}

async function loadIndependentVerificationVector() {
  return JSON.parse(await readFile(
    new URL("./fixtures/tlsn-runtime-config-independent-v2-vector.json", import.meta.url),
    "utf8",
  ));
}

function independentInputsFrom(vector) {
  return {
    ...Object.fromEntries(
      Object.entries(vector.inputs_base64url).map(([name, value]) => [
        name,
        Buffer.from(value, "base64url"),
      ]),
    ),
  };
}

function vectorPayload(vector) {
  const envelope = JSON.parse(vector.manifest_envelope_utf8);
  return JSON.parse(Buffer.from(envelope.payload_base64url, "base64url").toString("utf8"));
}

function currentIndependentInputs(workerReferenceRaw = referenceRaw()) {
  const originInventoryRaw = readFileSync(
    new URL("../../configs/tlsn-origin-inventory.json", import.meta.url),
  );
  const targetApprovalRaw = readFileSync(
    new URL("../../configs/tlsn-target-approval.json", import.meta.url),
  );
  const securityRegistrySetRaw = Buffer.from(
    productionSecurityRegistrySetHash({
      notaryKeyId: release.publicBindings.TLSN_CANDIDATE_NOTARY_KEY_ID,
      notaryRegistryRaw: release.publicBindings.TLSN_PRODUCTION_NOTARY_REGISTRY,
      targetApprovalArtifactSha256: createHash("sha256")
        .update(targetApprovalRaw)
        .digest("base64url"),
    }).canonical,
    "utf8",
  );
  return {
    worker_reference_raw: workerReferenceRaw,
    origin_inventory_raw: originInventoryRaw,
    target_approval_raw: targetApprovalRaw,
    security_registry_set_raw: securityRegistrySetRaw,
    result_registry_envelope_raw: Buffer.from(
      release.publicBindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE,
      "utf8",
    ),
  };
}

function testSignerProvider() {
  return {
    mode: "test-only",
    key_id: signerKeyId,
    public_key_spki: trustedSigner.public_key_spki,
    sign(bytes) {
      return sign(null, bytes, keyPair.privateKey);
    },
  };
}

function workerReferenceRevalidation() {
  return {
    environment,
    provenance,
    publicManifest: manifest,
    fetchImpl: async (url) => new Response(JSON.stringify(controlPlaneResponse(url))),
  };
}

class FakeRuntimeConfigObjectStore {
  constructor(options = {}) {
    return createTestOnlyRuntimeConfigObjectStore(options);
  }

  async getManifestState() {
    this.events.push("read-manifest-state");
    if (this.manifestBody === null) return null;
    const body = Buffer.from(this.manifestBody);
    if (this.corruptManifestReadback) {
      this.corruptManifestReadback = false;
      body[0] ^= 1;
    }
    return { body, etag: this.manifestETag };
  }

  async putImmutable(object) {
    this.events.push(`put:${object.key}`);
    const existing = this.objects.get(object.key);
    if (existing && !existing.equals(object.body)) {
      throw new Error("content-addressed object already contains different bytes");
    }
    this.objects.set(object.key, Buffer.from(object.body));
  }

  async getObject(key) {
    this.events.push(`read:${key}`);
    const body = key === "tlsn/runtime-config/v2/manifest.json"
      ? this.manifestBody
      : this.objects.get(key);
    if (!body) return null;
    const readback = Buffer.from(body);
    if (this.corruptArtifactReadback && key !== "tlsn/runtime-config/v2/manifest.json") {
      this.corruptArtifactReadback = false;
      readback[0] ^= 1;
    }
    return readback;
  }

  async compareAndSwapManifest(expectedETag, object) {
    this.events.push("manifest-cas");
    if (this.raceManifestPointer) {
      this.manifestETag = "concurrent-update";
      this.manifestBody = Buffer.from("concurrent manifest");
      throw new RuntimeConfigPointerConflictError(
        "Runtime Config manifest pointer changed during publication",
      );
    }
    if (this.manifestETag !== expectedETag) {
      throw new RuntimeConfigPointerConflictError(
        "Runtime Config manifest pointer changed during publication",
      );
    }
    this.manifestETag = `etag-${this.events.length}`;
    this.manifestBody = Buffer.from(object.body);
    return this.manifestETag;
  }
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
      Buffer.from("FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0", "ascii"),
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

  assert.equal(prepared.payload.schema_version, 2);
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
    canonicalPayload.replace('"schema_version":2,', '"schema_version":2,"schema_version":2,'),
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

test("rollback, exact same-epoch revalidation, expiry, stale references and byte limits fail closed", () => {
  const prepared = preparedOptions();
  const raw = signedRaw(prepared);
  const rawSha256 = createHash("sha256").update(raw).digest("base64url");
  assert.doesNotThrow(() => verifyTlsnRuntimeConfigEnvelope(raw, {
    trustedSigner,
    policy: policy(prepared, {
      last_accepted_epoch: "1",
      last_accepted_manifest_sha256: rawSha256,
    }),
  }));
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner,
      policy: policy(prepared, {
        last_accepted_epoch: "1",
        last_accepted_manifest_sha256: createHash("sha256")
          .update("different accepted envelope")
          .digest("base64url"),
      }),
    }),
    /already accepted with different manifest bytes/,
  );
  const changedSameEpoch = signedRaw(prepared, {
    not_before: new Date(Date.parse(prepared.payload.not_before) + 1).toISOString(),
  });
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(changedSameEpoch, {
      trustedSigner,
      policy: policy(prepared, {
        last_accepted_epoch: "1",
        last_accepted_manifest_sha256: rawSha256,
      }),
    }),
    /already accepted with different manifest bytes/,
  );
  assert.throws(
    () => verifyTlsnRuntimeConfigEnvelope(raw, {
      trustedSigner,
      policy: policy(prepared, {
        last_accepted_epoch: "2",
        last_accepted_manifest_sha256: rawSha256,
      }),
    }),
    /older than the persisted high-water mark/,
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
    new URL("./fixtures/tlsn-runtime-config-manifest-v2-vector.json", import.meta.url),
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
      last_accepted_manifest_sha256: null,
      max_lifetime_seconds: 3600,
      max_clock_skew_seconds: 30,
      max_reference_age_seconds: 600,
      max_envelope_bytes: 4096,
    },
  });
  assert.equal(verified.epoch, "1");
});

test("Production verification binds raw artifacts to pins authenticated by the signed manifest", async () => {
  const vector = await loadIndependentVerificationVector();
  assert.equal(vector.test_only, true);
  const verified = verifyTlsnRuntimeConfigProductionEnvelope(vector.manifest_envelope_utf8, {
    trustedSigner: vector.trusted_signer,
    policy: vector.policy,
    independentInputs: independentInputsFrom(vector),
  });

  assert.equal(verified.state, "MANIFEST_AND_SIGNED_PINS_VERIFIED");
  assert.equal(verified.matched_inputs.state, "MATCHED_SIGNED_MANIFEST_PINS");
  assert.equal(
    verified.matched_inputs.worker_reference_sha256,
    verified.payload.source.worker_reference_sha256,
  );
  assert.equal(
    verified.matched_inputs.origin_inventory_sha256,
    verified.payload.production_authority_pins.origin_inventory_sha256,
  );
  assert.equal(
    verified.matched_inputs.target_approval_artifact_sha256,
    verified.payload.production_authority_pins.target_approval_artifact_sha256,
  );
  assert.equal(
    verified.matched_inputs.result_registry_root_key_id,
    verified.payload.result_registry_pins.result_registry_root_key_id,
  );
  assert.equal(Object.isFrozen(verified.payload), true);
  assert.equal(Object.isFrozen(verified.matched_inputs), true);
});

test("publication objects use signed content-addressed keys and publish the mutable manifest last", async () => {
  const vector = await loadIndependentVerificationVector();
  const objects = createTlsnRuntimeConfigPublicationObjects(
    vector.manifest_envelope_utf8,
    {
      trustedSigner: vector.trusted_signer,
      policy: vector.policy,
      independentInputs: independentInputsFrom(vector),
    },
  );
  const manifest = objects.at(-1);
  assert.equal(manifest.key, "tlsn/runtime-config/v2/manifest.json");
  assert.equal(manifest.cache_control, "no-store");
  for (const artifact of objects.slice(0, -1)) {
    const digest = createHash("sha256").update(artifact.body).digest("base64url");
    assert.equal(artifact.key.endsWith(`/${digest}`), true);
    assert.equal(artifact.cache_control, "public, max-age=31536000, immutable");
  }
});

test("test-only Runtime Config signing verifies the ephemeral signer against its explicit test pin", async () => {
  const inputs = currentIndependentInputs();
  const prepared = preparedOptions(inputs.worker_reference_raw, release, "1");
  let signerCalls = 0;
  const signerProvider = {
    ...testSignerProvider(),
    sign(bytes) {
      signerCalls += 1;
      return sign(null, bytes, keyPair.privateKey);
    },
  };

  const signed = await signTlsnRuntimeConfigManifestForTest({
    prepared,
    signerProvider,
    trustedSigner,
    policy: policy(prepared),
    independentInputs: inputs,
  });
  assert.equal(signerCalls, 1);
  assert.equal(signed.verification.state, "MANIFEST_AND_SIGNED_PINS_VERIFIED");
  assert.equal(JSON.parse(signed.raw_envelope).signer_key_id, trustedSigner.key_id);
  assert.doesNotThrow(() => verifyTlsnRuntimeConfigEnvelope(signed.raw_envelope, {
      trustedSigner,
    policy: policy(prepared),
    }));

  await assert.rejects(
    () => signTlsnRuntimeConfigManifestForTest({
      prepared,
      signerProvider: { ...signerProvider, key_id: "untrusted-signer" },
      trustedSigner,
      policy: policy(prepared),
      independentInputs: inputs,
    }),
    /does not match the independent signer pin/,
  );
  await assert.rejects(
    () => signTlsnRuntimeConfigManifestForTest({
      prepared,
      signerProvider: { ...testSignerProvider(), sign: async () => Buffer.alloc(64) },
      trustedSigner,
      policy: policy(prepared),
      independentInputs: inputs,
    }),
    /runtime configuration signature verification failed/,
  );
  assert.equal(signerCalls, 1);
});

test("Production signing and publication fail closed before signer use or object-store access", async () => {
  const inputs = currentIndependentInputs();
  const prepared = preparedOptions(inputs.worker_reference_raw, release, "1");
  let signerCalls = 0;
  const signerProvider = {
    ...testSignerProvider(),
    mode: "production",
    sign(bytes) {
      signerCalls += 1;
      return sign(null, bytes, keyPair.privateKey);
    },
  };
  const store = new FakeRuntimeConfigObjectStore();

  await assert.rejects(
    () => signTlsnRuntimeConfigManifest({
      prepared,
      signerProvider,
      trustedSigner,
      policy: policy(prepared),
      independentInputs: inputs,
    }),
    /Production Runtime Config signing is blocked/,
  );
  await assert.rejects(
    () => publishTlsnRuntimeConfig({
      prepared,
      signerProvider,
      trustedSigner,
      policy: policy(prepared),
      independentInputs: inputs,
      workerReferenceRevalidation: workerReferenceRevalidation(),
      objectStore: store,
    }),
    /Production Runtime Config signing is blocked/,
  );
  assert.equal(signerCalls, 0);
  assert.deepEqual(store.events, []);
});

test("test-only publication refuses an unset signer before accessing the fake object store", async () => {
  const inputs = currentIndependentInputs();
  const prepared = preparedOptions(inputs.worker_reference_raw, release, "1");
  const store = new FakeRuntimeConfigObjectStore();

  await assert.rejects(
    () => publishTlsnRuntimeConfigForTest({
      objectStore: { test_only: true },
    }),
    /requires an in-memory test-only object store/,
  );
  await assert.rejects(
    () => publishTlsnRuntimeConfigForTest({
      prepared,
      signerProvider: undefined,
      trustedSigner,
      policy: policy(prepared),
      independentInputs: inputs,
      workerReferenceRevalidation: workerReferenceRevalidation(),
      objectStore: store,
    }),
    /test-only manifest signer provider does not match the independent signer pin/,
  );
  assert.deepEqual(store.events, []);
  assert.equal(store.objects.size, 0);
  assert.equal(store.manifestBody, null);
});

test("Runtime Config publisher reads back immutable artifacts before atomic manifest CAS", async () => {
  const inputs = currentIndependentInputs();
  const prepared = preparedOptions(inputs.worker_reference_raw, release, "1");
  const store = new FakeRuntimeConfigObjectStore();
  const result = await publishTlsnRuntimeConfigForTest({
    prepared,
    signerProvider: testSignerProvider(),
    trustedSigner,
    policy: policy(prepared),
    independentInputs: inputs,
    workerReferenceRevalidation: workerReferenceRevalidation(),
    objectStore: store,
  });

  assert.equal(result.state, "TEST_ONLY_PUBLISHED_TO_FAKE_STORE");
  const casIndex = store.events.indexOf("manifest-cas");
  assert.equal(store.events[casIndex + 1], "read-manifest-state");
  assert.equal(result.object_keys.at(-1), "tlsn/runtime-config/v2/manifest.json");
  assert.equal(
    createHash("sha256").update(store.manifestBody).digest("base64url"),
    result.manifest_sha256,
  );
  assert(
    store.events
      .filter((event) => event.startsWith("read:") && !event.endsWith("/manifest.json"))
      .every((event) => store.events.indexOf(event) < casIndex),
  );
});

test("Runtime Config publisher refuses a bad artifact readback or a raced manifest pointer", async () => {
  const inputs = currentIndependentInputs();
  const prepared = preparedOptions(inputs.worker_reference_raw, release, "1");
  const options = {
    prepared,
    signerProvider: testSignerProvider(),
    trustedSigner,
    policy: policy(prepared),
    independentInputs: inputs,
    workerReferenceRevalidation: workerReferenceRevalidation(),
  };
  const corruptStore = new FakeRuntimeConfigObjectStore({ corruptArtifactReadback: true });
  await assert.rejects(
    () => publishTlsnRuntimeConfigForTest({ ...options, objectStore: corruptStore }),
    /immutable Runtime Config artifact readback mismatch/,
  );
  assert.equal(corruptStore.manifestETag, null);
  assert.equal(corruptStore.events.includes("manifest-cas"), false);

  const racedStore = new FakeRuntimeConfigObjectStore({ raceManifestPointer: true });
  await assert.rejects(
    () => publishTlsnRuntimeConfigForTest({ ...options, objectStore: racedStore }),
    /not valid under the configured signer and policy/,
  );
  assert.equal(racedStore.manifestBody.toString(), "concurrent manifest");

  const rotatedStore = new FakeRuntimeConfigObjectStore();
  await assert.rejects(
    () => publishTlsnRuntimeConfigForTest({
      ...options,
      workerReferenceRevalidation: {
        ...workerReferenceRevalidation(),
        fetchImpl: async (url) => new Response(JSON.stringify(
          controlPlaneResponse(url, release, version2),
        )),
      },
      objectStore: rotatedStore,
    }),
    /deployment or endpoint mapping changed before manifest publication/,
  );
  assert.equal(rotatedStore.manifestETag, null);
  assert.equal(rotatedStore.events.includes("manifest-cas"), false);
});

test("Runtime Config publication distinguishes a verified competing release from a damaged pointer", async () => {
  const inputs = currentIndependentInputs();
  const preparedOne = preparedOptions(inputs.worker_reference_raw, release, "1");
  const preparedTwo = preparedOptions(inputs.worker_reference_raw, release, "2");
  const store = new FakeRuntimeConfigObjectStore();
  const publish = (prepared) => publishTlsnRuntimeConfigForTest({
    prepared,
    signerProvider: testSignerProvider(),
    trustedSigner,
    policy: policy(prepared),
    independentInputs: inputs,
    workerReferenceRevalidation: workerReferenceRevalidation(),
    objectStore: store,
  });
  const outcomes = await Promise.allSettled([publish(preparedOne), publish(preparedTwo)]);

  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = outcomes.find(({ status }) => status === "rejected");
  assert(rejected.reason instanceof RuntimeConfigPointerConflictError);
  assert.match(rejected.reason.message, /fully verified Runtime Config release/);
  assert.equal(
    createHash("sha256").update(store.manifestBody).digest("base64url"),
    outcomes.find(({ status }) => status === "fulfilled").value.manifest_sha256,
  );

  const damagedStore = new FakeRuntimeConfigObjectStore({ corruptManifestReadback: true });
  const prepared = preparedOptions(inputs.worker_reference_raw, release, "3");
  await assert.rejects(
    () => publishTlsnRuntimeConfigForTest({
      prepared,
      signerProvider: testSignerProvider(),
      trustedSigner,
      policy: policy(prepared),
      independentInputs: inputs,
      workerReferenceRevalidation: workerReferenceRevalidation(),
      objectStore: damagedStore,
    }),
    /not valid under the configured signer and policy/,
  );
});

test("Production verification fails closed for missing, changed, swapped, or self-asserted inputs", async () => {
  const vector = await loadIndependentVerificationVector();
  const verify = (inputs) => verifyTlsnRuntimeConfigProductionEnvelope(
    vector.manifest_envelope_utf8,
    {
      trustedSigner: vector.trusted_signer,
      policy: vector.policy,
      independentInputs: inputs,
    },
  );
  const inputs = independentInputsFrom(vector);

  assert.throws(
    () => verify(undefined),
    /independent Production verification inputs are required/,
  );
  assert.throws(
    () => verify({ ...inputs, independent_pins: {} }),
    /independent runtime configuration inputs field inventory is invalid/,
  );

  const missingReference = independentInputsFrom(vector);
  missingReference.worker_reference_raw = undefined;
  assert.throws(() => verify(missingReference), /Worker reference raw bytes are required/);

  const mutatedReference = independentInputsFrom(vector);
  mutatedReference.worker_reference_raw[0] ^= 1;
  assert.throws(
    () => verify(mutatedReference),
    /Worker reference bytes do not match the signed manifest digest/,
  );

  const swappedAuthorityPair = independentInputsFrom(vector);
  [
    swappedAuthorityPair.origin_inventory_raw,
    swappedAuthorityPair.target_approval_raw,
  ] = [
    swappedAuthorityPair.target_approval_raw,
    swappedAuthorityPair.origin_inventory_raw,
  ];
  assert.throws(
    () => verify(swappedAuthorityPair),
    /Production authority artifact bytes do not match the signed manifest digests/,
  );

  const mutatedApproval = independentInputsFrom(vector);
  mutatedApproval.target_approval_raw[0] ^= 1;
  assert.throws(
    () => verify(mutatedApproval),
    /Production authority artifact bytes do not match the signed manifest digests/,
  );

  const envelope = JSON.parse(vector.manifest_envelope_utf8);
  const payloadBytes = Buffer.from(envelope.payload_base64url, "base64url");
  const tamperedPayload = JSON.parse(payloadBytes.toString("utf8"));
  tamperedPayload.production_authority_pins.target_approval_artifact_sha256 = "A".repeat(43);
  envelope.payload_base64url = Buffer.from(canonicalJson(tamperedPayload), "utf8").toString("base64url");
  assert.throws(
    () => verifyTlsnRuntimeConfigProductionEnvelope(JSON.stringify(envelope), {
      trustedSigner: vector.trusted_signer,
      policy: vector.policy,
      independentInputs: inputs,
    }),
    /runtime configuration signature verification failed/,
  );

  const missingApproval = independentInputsFrom(vector);
  missingApproval.target_approval_raw = undefined;
  assert.throws(() => verify(missingApproval), /Target Approval raw bytes are required/);
});

test("Result registry signature and manifest pins are independently enforced", async () => {
  const vector = await loadIndependentVerificationVector();
  const verify = (inputs) => verifyTlsnRuntimeConfigProductionEnvelope(
    vector.manifest_envelope_utf8,
    {
      trustedSigner: vector.trusted_signer,
      policy: vector.policy,
      independentInputs: inputs,
    },
  );
  const valid = verify(independentInputsFrom(vector));
  assert.equal(
    valid.matched_inputs.result_registry_root_key_id,
    valid.payload.result_registry_pins.result_registry_root_key_id,
  );

  const changedSignature = independentInputsFrom(vector);
  const envelope = JSON.parse(changedSignature.result_registry_envelope_raw.toString("utf8"));
  const signatureBytes = Buffer.from(envelope.signature_base64url, "base64url");
  signatureBytes[0] ^= 1;
  envelope.signature_base64url = signatureBytes.toString("base64url");
  changedSignature.result_registry_envelope_raw = Buffer.from(JSON.stringify(envelope), "utf8");
  assert.throws(
    () => verify(changedSignature),
    /Worker reference identity does not match the signed manifest/,
  );

  const untrustedPayload = vectorPayload(vector);
  const untrustedInputs = independentInputsFrom(vector);
  const untrustedEnvelope = JSON.parse(
    untrustedInputs.result_registry_envelope_raw.toString("utf8"),
  );
  const untrustedSignature = Buffer.from(untrustedEnvelope.signature_base64url, "base64url");
  untrustedSignature[0] ^= 1;
  untrustedEnvelope.signature_base64url = untrustedSignature.toString("base64url");
  const untrustedEnvelopeRaw = Buffer.from(canonicalJson(untrustedEnvelope), "utf8");
  const workerReference = JSON.parse(untrustedInputs.worker_reference_raw.toString("utf8"));
  workerReference.cloudflare.checked_public_bindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE =
    untrustedEnvelopeRaw.toString("utf8");
  untrustedInputs.worker_reference_raw = Buffer.from(
    `${JSON.stringify(workerReference, null, 2)}\n`,
    "utf8",
  );
  untrustedInputs.result_registry_envelope_raw = untrustedEnvelopeRaw;
  untrustedPayload.source.worker_reference_sha256 = createHash("sha256")
    .update(untrustedInputs.worker_reference_raw)
    .digest("base64url");
  untrustedPayload.result_registry_pins.result_registry_envelope_sha256 = createHash("sha256")
    .update(untrustedEnvelopeRaw)
    .digest("base64url");
  assert.throws(
    () => verifyTlsnRuntimeConfigIndependentInputs(
      untrustedPayload,
      untrustedInputs,
      vector.policy.now_ms,
    ),
    /result registry envelope signature is invalid/i,
  );

  const tamperedManifest = JSON.parse(vector.manifest_envelope_utf8);
  const payload = JSON.parse(Buffer.from(tamperedManifest.payload_base64url, "base64url").toString("utf8"));
  payload.result_registry_pins.result_registry_root_key_id = "attacker-controlled-root";
  tamperedManifest.payload_base64url = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  assert.throws(
    () => verifyTlsnRuntimeConfigProductionEnvelope(JSON.stringify(tamperedManifest), {
      trustedSigner: vector.trusted_signer,
      policy: vector.policy,
      independentInputs: independentInputsFrom(vector),
    }),
    /runtime configuration signature verification failed/,
  );
});
