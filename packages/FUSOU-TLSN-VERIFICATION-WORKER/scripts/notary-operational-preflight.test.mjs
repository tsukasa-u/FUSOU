import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createECDH, createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../src/origin-trust-contract.mjs";
import { checkNotaryOperationalPreflight } from "./notary-operational-preflight.mjs";

const vector = JSON.parse(readFileSync(new URL(
  "./fixtures/tlsn-runtime-config-independent-v2-vector.json", import.meta.url,
)));
assert.equal(vector.test_only, true);
const digest = (raw) => createHash("sha256").update(raw).digest("base64url");
const raw = (value) => Buffer.from(canonicalJson(value));
const APP_RUNTIME_CONFIG_ARTIFACT_LIMIT = 1_048_576;
const RUNTIME_CONFIG_SIGNATURE_DOMAIN =
  Buffer.from("FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0", "ascii");
const runtimeConfigArtifacts = [
  ["worker_reference_raw", "worker-reference.json"],
  ["origin_inventory_raw", "origin-inventory.json"],
  ["target_approval_raw", "target-approval.json"],
  ["security_registry_set_raw", "security-registry-set.json"],
  ["result_registry_envelope_raw", "result-registry-envelope.json"],
];
const newAuthorityKey = () => generateKeyPairSync("ed25519").publicKey
  .export({ type: "spki", format: "der" }).toString("base64url");

function signManifestPayload(envelope, payload) {
  const keyPair = generateKeyPairSync("ed25519");
  const keyId = Buffer.from(envelope.signer_key_id, "ascii");
  const keyIdLength = Buffer.alloc(2);
  keyIdLength.writeUInt16BE(keyId.length);
  const payloadRaw = raw(payload);
  const signingBytes = Buffer.concat([
    RUNTIME_CONFIG_SIGNATURE_DOMAIN,
    keyIdLength,
    keyId,
    payloadRaw,
  ]);
  return {
    envelopeRaw: raw({
      ...envelope,
      payload_base64url: payloadRaw.toString("base64url"),
      signature_base64url: sign(null, signingBytes, keyPair.privateKey).toString("base64url"),
    }),
    trustedSigner: {
      ...vector.trusted_signer,
      public_key_spki: keyPair.publicKey.export({
        type: "spki",
        format: "der",
      }).toString("base64url"),
    },
  };
}

function padded(value, size) {
  assert.ok(value.length <= size);
  return Buffer.concat([value, Buffer.alloc(size - value.length, 0x20)]);
}

function fixture({ notaryEndpoint } = {}) {
  const envelope = JSON.parse(vector.manifest_envelope_utf8);
  const payload = JSON.parse(Buffer.from(envelope.payload_base64url, "base64url"));
  const independentInputs = Object.fromEntries(Object.entries(vector.inputs_base64url)
    .map(([name, value]) => [name, Buffer.from(value, "base64url")]));
  let envelopeRaw = Buffer.from(vector.manifest_envelope_utf8);
  let trustedSigner = vector.trusted_signer;
  if (notaryEndpoint) {
    const workerReference = JSON.parse(independentInputs.worker_reference_raw);
    workerReference.compile_inputs.FUSOU_TLSN_NOTARY_ENDPOINT = notaryEndpoint;
    independentInputs.worker_reference_raw = raw(workerReference);
    payload.compile_inputs.FUSOU_TLSN_NOTARY_ENDPOINT = notaryEndpoint;
    payload.source.worker_reference_sha256 = digest(independentInputs.worker_reference_raw);
    ({ envelopeRaw, trustedSigner } = signManifestPayload(envelope, payload));
  }
  const app = payload.compile_inputs;
  const operator = {
    endpoint: app.FUSOU_TLSN_NOTARY_ENDPOINT,
    notary_id: app.FUSOU_TLSN_NOTARY_ID,
    environment: payload.environment,
    notary_key_id: JSON.parse(independentInputs.security_registry_set_raw).notary_key_id,
    notary_verifying_key: app.FUSOU_TLSN_NOTARY_VERIFYING_KEY,
    session_authority_key_id: app.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID,
    session_authority_public_key_spki: app.FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY,
    wire_version: 1,
  };
  const sessionRegistry = {
    schema_version: 1,
    scope: "tlsn-session-authority-key-registry",
    keys: [{
      key_id: operator.session_authority_key_id,
      public_key_spki: operator.session_authority_public_key_spki,
      status: "ACTIVE",
      not_before: "2020-01-01T00:00:00.000Z",
      not_after: null,
    }],
  };
  const args = {
    envelopeRaw,
    trustedSigner,
    policy: { ...vector.policy, max_envelope_bytes: 65_536 },
    independentInputs,
    notaryPublicConfigRaw: raw(operator),
    sessionRegistryRaw: raw(sessionRegistry),
  };
  const row = { ...operator, session_authority_registry_sha256: digest(args.sessionRegistryRaw) };
  const approve = (...scopes) => {
    args.registrationRaw = raw({ schema_version: 1, scopes });
    args.approvedRegistrationSha256 = digest(args.registrationRaw);
  };
  approve(row);
  return { args, approve, operator, row, sessionRegistry };
}

function fixtureWithWorkerReference(workerReferenceRaw) {
  const { args, ...rest } = fixture();
  const envelope = JSON.parse(args.envelopeRaw);
  const payload = JSON.parse(Buffer.from(envelope.payload_base64url, "base64url"));
  args.independentInputs.worker_reference_raw = workerReferenceRaw;
  payload.source.worker_reference_sha256 = digest(workerReferenceRaw);
  const signed = signManifestPayload(envelope, payload);
  args.envelopeRaw = signed.envelopeRaw;
  args.trustedSigner = signed.trustedSigner;
  return { args, ...rest };
}

test("coherent independently approved public settings match the signed Complete Runtime Config offline", () => {
  const { args, approve, row } = fixture({
    notaryEndpoint: process.env.FUSOU_TEST_NOTARY_ENDPOINT,
  });
  if (process.env.FUSOU_TEST_NOTARY_PUBLIC_EXPORT) {
    args.notaryPublicConfigRaw = readFileSync(process.env.FUSOU_TEST_NOTARY_PUBLIC_EXPORT);
  }
  approve(row, {
    ...row, environment: "other", session_authority_key_id: "other-authority",
    session_authority_public_key_spki: newAuthorityKey(),
  });
  assert.deepEqual(checkNotaryOperationalPreflight(args), {
    status: "NOTARY_PUBLIC_CONFIGURATION_MATCHED_OFFLINE", gameplay_authorized: false,
  });
});

test("missing and substituted independently approved material is rejected", () => {
  const { args, operator } = fixture();
  for (const [field, error] of [
    ["registrationRaw", /registration digest/],
    ["approvedRegistrationSha256", /registration digest/],
    ["notaryPublicConfigRaw", /operator public configuration/],
    ["sessionRegistryRaw", /Authority registry digest/],
    ["independentInputs", /independent artifacts rejected/],
    ["trustedSigner", /signature, policy/],
  ]) {
    assert.throws(() => checkNotaryOperationalPreflight({ ...args, [field]: undefined }), error, field);
  }
  const { wire_version: _missing, ...partial } = operator;
  assert.throws(() => checkNotaryOperationalPreflight({
    ...args, notaryPublicConfigRaw: raw(partial),
  }), /operator public configuration/);
  assert.throws(() => checkNotaryOperationalPreflight({
    ...args, registrationRaw: Buffer.concat([args.registrationRaw, Buffer.from("\n")]),
  }), /registration digest/);
});

test("invalid Manifest signature and exact artifact mutation cannot supply APP expectations", () => {
  const { args } = fixture();
  const envelope = JSON.parse(args.envelopeRaw);
  const sig = Buffer.from(envelope.signature_base64url, "base64url");
  sig[0] ^= 1;
  envelope.signature_base64url = sig.toString("base64url");
  assert.throws(() => checkNotaryOperationalPreflight({
    ...args, envelopeRaw: raw(envelope),
  }), /signature, policy/);
  assert.throws(() => checkNotaryOperationalPreflight({
    ...args, independentInputs: {
      ...args.independentInputs, target_approval_raw: Buffer.from("{}"),
    },
  }), /independent artifacts rejected/);
  assert.throws(() => checkNotaryOperationalPreflight({
    ...args, policy: { ...args.policy, max_clock_skew_seconds: 31 },
  }), /signature, policy/);
});

test("operator and registration disagreement with the authenticated APP settings fails closed", () => {
  const { operator } = fixture();
  const otherNotaryKey = Buffer.from(operator.notary_verifying_key, "base64url");
  const ecdh = createECDH("secp256k1");
  const compressed = ecdh.generateKeys(null, "compressed");
  compressed.copy(otherNotaryKey, otherNotaryKey.length - compressed.length);
  const mutations = {
    endpoint: "other-notary.example.test:7047",
    notary_id: "different-service",
    environment: "canary",
    notary_key_id: "different-signing-key",
    notary_verifying_key: otherNotaryKey.toString("base64url"),
    session_authority_key_id: "different-session-key",
    session_authority_public_key_spki: newAuthorityKey(),
    wire_version: 2,
  };
  for (const [field, value] of Object.entries(mutations)) {
    const { args, approve, operator, row } = fixture();
    assert.notEqual(operator[field], value, field);
    assert.throws(() => checkNotaryOperationalPreflight({
      ...args, notaryPublicConfigRaw: raw({ ...operator, [field]: value }),
    }), new RegExp(`operator configuration mismatch: ${field}`), field);
    approve({ ...row, [field]: value });
    assert.throws(() => checkNotaryOperationalPreflight(args),
      ["notary_id", "environment"].includes(field) ? /No approved registration/ :
        new RegExp(`registration mismatch: ${field}`), field);
  }
});

test("a reused grant key is rejected even under a different key ID and environment", () => {
  const { args, row, approve } = fixture();
  approve(row, { ...row, environment: "other", session_authority_key_id: "key-alias" });
  assert.throws(() => checkNotaryOperationalPreflight(args), /reused across Notary scopes/);
  approve(row, { ...row, notary_id: "other-notary", session_authority_public_key_spki: newAuthorityKey() });
  assert.throws(() => checkNotaryOperationalPreflight(args), /reused across Notary scopes/);
});

test("approved registry bytes still must authorize an active matching grant key", () => {
  const { args, row, approve, sessionRegistry } = fixture();
  sessionRegistry.keys[0].status = "REVOKED";
  args.sessionRegistryRaw = raw(sessionRegistry);
  approve({ ...row, session_authority_registry_sha256: digest(args.sessionRegistryRaw) });
  assert.throws(() => checkNotaryOperationalPreflight(args), /does not authorize/);
});

test("CLI actually reads its local trust file and fails without exposing input contents or paths", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "fusou-notary-preflight-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { args } = fixture();
  const { now_ms: _now, ...policy } = args.policy;
  writeFileSync(join(directory, "runtime-config-trust.json"), raw({
    trusted_signer: args.trustedSigner, policy,
  }));
  const script = fileURLToPath(new URL("./notary-operational-preflight.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    script, directory, directory, args.approvedRegistrationSha256,
  ], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1, result.error?.message);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Notary preflight: Missing, unreadable, or oversized input: runtime-config-envelope.json\n");
});

test("direct checks apply the APP artifact limit to every independent input", () => {
  const { args } = fixture();
  for (const [field, name] of runtimeConfigArtifacts) {
    const exactLimit = padded(args.independentInputs[field], APP_RUNTIME_CONFIG_ARTIFACT_LIMIT);
    assert.throws(() => checkNotaryOperationalPreflight({
      ...args,
      independentInputs: { ...args.independentInputs, [field]: exactLimit },
    }), /Runtime Config signature, policy, or independent artifacts rejected/, `${name} at limit`);
    assert.throws(() => checkNotaryOperationalPreflight({
      ...args,
      independentInputs: {
        ...args.independentInputs,
        [field]: Buffer.concat([exactLimit, Buffer.from(" ")]),
      },
    }), new RegExp(`Runtime Config artifact exceeds APP 1 MiB limit: ${name}`), `${name} over limit`);
  }
});

test("a signed digest-matching Worker reference is accepted at the limit and rejected one byte over", () => {
  const sourceWorkerReference = fixture().args.independentInputs.worker_reference_raw;
  const exactLimit = padded(sourceWorkerReference, APP_RUNTIME_CONFIG_ARTIFACT_LIMIT);
  const exact = fixtureWithWorkerReference(exactLimit);
  assert.deepEqual(checkNotaryOperationalPreflight(exact.args), {
    status: "NOTARY_PUBLIC_CONFIGURATION_MATCHED_OFFLINE",
    gameplay_authorized: false,
  });

  const oversized = fixtureWithWorkerReference(Buffer.concat([exactLimit, Buffer.from(" ")]));
  assert.throws(
    () => checkNotaryOperationalPreflight(oversized.args),
    /Runtime Config artifact exceeds APP 1 MiB limit: worker-reference\.json/,
  );
});

test("CLI reads each independent Runtime Config artifact only up to the APP limit", (t) => {
  const snapshot = mkdtempSync(join(tmpdir(), "fusou-notary-preflight-snapshot-"));
  const approval = mkdtempSync(join(tmpdir(), "fusou-notary-preflight-approval-"));
  t.after(() => {
    rmSync(snapshot, { recursive: true, force: true });
    rmSync(approval, { recursive: true, force: true });
  });
  const { args } = fixture();
  const { now_ms: _now, ...policy } = args.policy;
  const files = {
    "runtime-config-envelope.json": args.envelopeRaw,
    "notary-operator-public-config.json": args.notaryPublicConfigRaw,
    "session-authority-registry.json": args.sessionRegistryRaw,
  };
  for (const [field, name] of runtimeConfigArtifacts) {
    files[name] = args.independentInputs[field];
  }
  for (const [name, value] of Object.entries(files)) writeFileSync(join(snapshot, name), value);
  writeFileSync(join(approval, "runtime-config-trust.json"), raw({
    trusted_signer: args.trustedSigner,
    policy,
  }));
  writeFileSync(join(approval, "notary-registration.json"), args.registrationRaw);

  const script = fileURLToPath(new URL("./notary-operational-preflight.mjs", import.meta.url));
  for (const [field, name] of runtimeConfigArtifacts) {
    const original = args.independentInputs[field];
    for (const [resetField, resetName] of runtimeConfigArtifacts) {
      writeFileSync(join(snapshot, resetName), args.independentInputs[resetField]);
    }
    for (const size of [APP_RUNTIME_CONFIG_ARTIFACT_LIMIT, APP_RUNTIME_CONFIG_ARTIFACT_LIMIT + 1]) {
      writeFileSync(join(snapshot, name), padded(original, size));
      const result = spawnSync(process.execPath, [
        script, snapshot, approval, args.approvedRegistrationSha256,
      ], { encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 1, `${name} at ${size} bytes`);
      const readFailure = `Notary preflight: Missing, unreadable, or oversized input: ${name}\n`;
      if (size === APP_RUNTIME_CONFIG_ARTIFACT_LIMIT) {
        assert.notEqual(result.stderr, readFailure, `${name} at the inclusive limit`);
      } else {
        assert.equal(result.stderr, readFailure, `${name} over the limit`);
      }
    }
  }
});
