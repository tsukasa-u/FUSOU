import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createECDH, createHash, generateKeyPairSync } from "node:crypto";
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
const newAuthorityKey = () => generateKeyPairSync("ed25519").publicKey
  .export({ type: "spki", format: "der" }).toString("base64url");

function fixture() {
  const envelope = JSON.parse(vector.manifest_envelope_utf8);
  const payload = JSON.parse(Buffer.from(envelope.payload_base64url, "base64url"));
  const app = payload.compile_inputs;
  const independentInputs = Object.fromEntries(Object.entries(vector.inputs_base64url)
    .map(([name, value]) => [name, Buffer.from(value, "base64url")]));
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
    envelopeRaw: Buffer.from(vector.manifest_envelope_utf8),
    trustedSigner: vector.trusted_signer,
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

test("coherent independently approved public settings match the signed Complete Runtime Config offline", () => {
  const { args, approve, row } = fixture();
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
