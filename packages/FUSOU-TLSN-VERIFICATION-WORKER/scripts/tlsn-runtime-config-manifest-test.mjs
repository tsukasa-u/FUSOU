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
    /payload is malformed JSON|signature verification failed/,
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
