import { createHash, createPublicKey, verify } from "node:crypto";
import { TextDecoder } from "node:util";
import { ENTRY_INPUT_CONTRACT, assertBuildReference } from "./app-build-handoff.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { assertResultSigningIdentity } from "./production-trust-contract.mjs";
import { verifyTlsnRuntimeConfigIndependentInputs } from "./tlsn-runtime-config-independent-verification.mjs";
import { assertAlpha15NotaryVerifyingKey } from "../src/origin-trust-contract.mjs";

export const TLSN_RUNTIME_CONFIG_MANIFEST_SCHEMA_VERSION = 2;
export const TLSN_RUNTIME_CONFIG_MANIFEST_SCOPE = "fusou-tlsn-runtime-config-manifest-v2";
export const TLSN_RUNTIME_CONFIG_ENVELOPE_SCOPE = "fusou-tlsn-runtime-config-envelope-v2";
export const TLSN_RUNTIME_CONFIG_TRUST_SCOPE = "fusou-tlsn-runtime-config-signing-root-v2";
export const TLSN_RUNTIME_CONFIG_SIGNATURE_ALGORITHM = "Ed25519";

const DOMAIN = Buffer.from("FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0", "ascii");
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const WORKER_NAME_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const MAX_U64 = 18446744073709551615n;
const MAX_SAFE_POLICY_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
const SOURCE_FIELDS = [
  "worker_reference_sha256",
  "observed_at",
  "account_id",
  "script_name",
  "logical_deployment_id",
  "cloudflare_deployment_id",
  "active_version_id",
  "worker_git_commit_sha",
  "disclosure_mode",
];
const AUTHORITY_PIN_FIELDS = [
  "origin_inventory_sha256",
  "target_approval_artifact_sha256",
  "security_registry_set_sha256",
];
const MANIFEST_FIELDS = [
  "schema_version",
  "scope",
  "environment",
  "epoch",
  "issued_at",
  "not_before",
  "expires_at",
  "source",
  "compile_inputs",
  "production_authority_pins",
  "result_registry_pins",
];
const ENVELOPE_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "signer_key_id",
  "payload_base64url",
  "signature_base64url",
];
const TRUSTED_SIGNER_FIELDS = ["scope", "key_id", "public_key_spki"];
const POLICY_FIELDS = [
  "now_ms",
  "last_accepted_epoch",
  "max_lifetime_seconds",
  "max_clock_skew_seconds",
  "max_reference_age_seconds",
  "max_envelope_bytes",
];

function assertExactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())
  ) {
    throw new Error(`${label} field inventory is invalid`);
  }
}

function assertWellFormedJsonStrings(value, label) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      for (let index = 0; index < current.length; index += 1) {
        const code = current.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = current.charCodeAt(index + 1);
          if (!(next >= 0xdc00 && next <= 0xdfff)) {
            throw new Error(`${label} contains an invalid Unicode string`);
          }
          index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          throw new Error(`${label} contains an invalid Unicode string`);
        }
      }
    } else if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
    } else if (current && typeof current === "object") {
      for (const [key, item] of Object.entries(current)) pending.push(key, item);
    }
  }
}

function assertKeyId(value, label) {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 base64url digest`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    throw new Error(`${label} must be canonical SHA-256 base64url`);
  }
}

function decodeBase64Url(value, label, expectedLength) {
  if (
    typeof value !== "string" ||
    !BASE64URL_PATTERN.test(value) ||
    value.length % 4 === 1
  ) {
    throw new Error(`${label} must be canonical unpadded base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    decoded.toString("base64url") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return decoded;
}

function assertEd25519Spki(value, label) {
  const bytes = decodeBase64Url(value, label);
  try {
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
  } catch {
    throw new Error(`${label} must be a valid Ed25519 SPKI public key`);
  }
}

function assertCanonicalUtc(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new Error(`${label} must be canonical UTC RFC3339`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) {
    throw new Error(`${label} must be canonical UTC RFC3339`);
  }
  return millis;
}

function assertEpoch(value, label, allowZero = false) {
  const pattern = allowZero ? /^(?:0|[1-9][0-9]{0,19})$/ : /^[1-9][0-9]{0,19}$/;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} must be a canonical UInt64 decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_U64) throw new Error(`${label} exceeds UInt64`);
  return parsed;
}

function assertCleanHttpsEndpoint(value, path, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== path ||
    parsed.href !== value
  ) {
    throw new Error(`${label} must be a clean HTTPS DNS URL with path ${path}`);
  }
  return parsed;
}

function assertNotaryEndpoint(value) {
  if (typeof value !== "string" || !value || /\s|:\/\//.test(value)) {
    throw new Error("Notary endpoint must be a raw host:port value");
  }
  let host;
  let port;
  if (value.startsWith("[")) {
    const separator = value.lastIndexOf("]:");
    if (separator < 0) throw new Error("Notary endpoint must use [host]:port syntax");
    host = value.slice(1, separator);
    port = value.slice(separator + 2);
  } else {
    const separator = value.lastIndexOf(":");
    if (separator <= 0 || value.indexOf(":") !== separator) {
      throw new Error("Notary endpoint must use host:port syntax");
    }
    host = value.slice(0, separator);
    port = value.slice(separator + 1);
  }
  if (
    !host ||
    host.includes("[") ||
    host.includes("]") ||
    !/^\d+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  ) {
    throw new Error("Notary endpoint must contain a valid port");
  }
}

function assertManifestPayload(payload, validationTime = new Date()) {
  assertWellFormedJsonStrings(payload, "runtime configuration manifest");
  assertExactKeys(payload, MANIFEST_FIELDS, "runtime configuration manifest");
  if (
    payload.schema_version !== TLSN_RUNTIME_CONFIG_MANIFEST_SCHEMA_VERSION ||
    payload.scope !== TLSN_RUNTIME_CONFIG_MANIFEST_SCOPE ||
    payload.environment !== "production"
  ) {
    throw new Error("runtime configuration manifest schema or environment is invalid");
  }
  assertEpoch(payload.epoch, "manifest epoch");
  assertCanonicalUtc(payload.issued_at, "manifest issued_at");
  assertCanonicalUtc(payload.not_before, "manifest not_before");
  assertCanonicalUtc(payload.expires_at, "manifest expires_at");

  assertExactKeys(payload.source, SOURCE_FIELDS, "manifest source");
  assertDigest(payload.source.worker_reference_sha256, "Worker reference digest");
  assertCanonicalUtc(payload.source.observed_at, "Worker reference observation time");
  if (
    typeof payload.source.account_id !== "string" ||
    !/^[0-9a-f]{32}$/.test(payload.source.account_id) ||
    typeof payload.source.script_name !== "string" ||
    !WORKER_NAME_PATTERN.test(payload.source.script_name) ||
    typeof payload.source.logical_deployment_id !== "string" ||
    !payload.source.logical_deployment_id.trim() ||
    typeof payload.source.cloudflare_deployment_id !== "string" ||
    !UUID_PATTERN.test(payload.source.cloudflare_deployment_id) ||
    payload.source.cloudflare_deployment_id === NIL_UUID ||
    typeof payload.source.active_version_id !== "string" ||
    !UUID_PATTERN.test(payload.source.active_version_id) ||
    payload.source.active_version_id === NIL_UUID ||
    typeof payload.source.worker_git_commit_sha !== "string" ||
    !SHA_PATTERN.test(payload.source.worker_git_commit_sha) ||
    !["complete", "sparse"].includes(payload.source.disclosure_mode)
  ) {
    throw new Error("manifest Worker source identity is invalid");
  }

  assertExactKeys(payload.compile_inputs, ENTRY_INPUT_CONTRACT.compile_inputs, "manifest compile inputs");
  if (
    Object.values(payload.compile_inputs).some(
      (value) => typeof value !== "string" || !value.trim() || value.includes("\0"),
    )
  ) {
    throw new Error("manifest compile input is missing or invalid");
  }
  const inputs = payload.compile_inputs;
  if (
    inputs.FUSOU_TLSN_EXPECTED_BINDING_MODE !== "random" ||
    inputs.FUSOU_TLSN_EXPECTED_WORKER_NAME !== payload.source.script_name ||
    inputs.FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID !== payload.source.logical_deployment_id ||
    inputs.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID !== payload.source.active_version_id ||
    inputs.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA !== payload.source.worker_git_commit_sha
  ) {
    throw new Error("manifest compile inputs disagree with the observed Worker reference");
  }
  assertNotaryEndpoint(inputs.FUSOU_TLSN_NOTARY_ENDPOINT);
  assertAlpha15NotaryVerifyingKey(
    inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY,
    "manifest Notary verifying key",
  );
  const resultIdentity = assertResultSigningIdentity({
    registry: inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY,
    keyId: inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID,
    publicKeySpki: inputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI,
    now: validationTime,
  });
  assertWellFormedJsonStrings(resultIdentity.key_registry, "Result signing registry");
  for (const [index, key] of resultIdentity.key_registry.keys.entries()) {
    assertCanonicalUtc(key.not_before, `Result registry key ${index}.not_before`);
    if (key.not_after !== null) {
      assertCanonicalUtc(key.not_after, `Result registry key ${index}.not_after`);
    }
  }
  const health = assertCleanHttpsEndpoint(
    inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT,
    "/health",
    "manifest Worker health endpoint",
  );
  const session = assertCleanHttpsEndpoint(
    inputs.FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT,
    "/attestation/session",
    "manifest Session Authority endpoint",
  );
  const verificationPath = payload.source.disclosure_mode === "complete"
    ? "/verify/tlsn"
    : "/verify/tlsn/sparse";
  const verification = assertCleanHttpsEndpoint(
    inputs.FUSOU_TLSN_VERIFICATION_ENDPOINT,
    verificationPath,
    "manifest Verification endpoint",
  );
  if (health.origin !== session.origin || health.origin !== verification.origin) {
    throw new Error("manifest Worker endpoint origins disagree");
  }
  assertEd25519Spki(
    inputs.FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY,
    "manifest Session Authority public key",
  );

  assertExactKeys(payload.production_authority_pins, AUTHORITY_PIN_FIELDS, "Production authority pins");
  for (const name of AUTHORITY_PIN_FIELDS) {
    assertDigest(payload.production_authority_pins[name], name);
  }
  assertExactKeys(
    payload.result_registry_pins,
    [
      "result_registry_sha256",
      "result_registry_envelope_sha256",
      "result_registry_root_key_id",
      "result_registry_root_public_key_spki",
    ],
    "Result registry pins",
  );
  assertDigest(payload.result_registry_pins.result_registry_sha256, "Result registry digest");
  assertDigest(
    payload.result_registry_pins.result_registry_envelope_sha256,
    "Result registry envelope digest",
  );
  assertKeyId(
    payload.result_registry_pins.result_registry_root_key_id,
    "Result registry root key ID",
  );
  assertEd25519Spki(
    payload.result_registry_pins.result_registry_root_public_key_spki,
    "Result registry root public key",
  );
  const registryDigest = createHash("sha256")
    .update(inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY, "utf8")
    .digest("base64url");
  if (registryDigest !== payload.result_registry_pins.result_registry_sha256) {
    throw new Error("Result registry digest does not match the signed compile input");
  }
  return payload;
}

function assertTrustedSigner(trustedSigner) {
  assertExactKeys(trustedSigner, TRUSTED_SIGNER_FIELDS, "trusted configuration signer");
  if (trustedSigner.scope !== TLSN_RUNTIME_CONFIG_TRUST_SCOPE) {
    throw new Error("trusted signer is not scoped to runtime configuration");
  }
  assertKeyId(trustedSigner.key_id, "trusted configuration signer key ID");
  assertEd25519Spki(trustedSigner.public_key_spki, "trusted configuration signer public key");
}

function assertPolicy(policy) {
  assertExactKeys(policy, POLICY_FIELDS, "runtime configuration verification policy");
  if (!Number.isSafeInteger(policy.now_ms) || !Number.isFinite(new Date(policy.now_ms).getTime())) {
    throw new Error("verification time is invalid");
  }
  assertEpoch(policy.last_accepted_epoch, "last accepted epoch", true);
  for (const field of [
    "max_lifetime_seconds",
    "max_clock_skew_seconds",
    "max_reference_age_seconds",
    "max_envelope_bytes",
  ]) {
    if (!Number.isSafeInteger(policy[field]) || policy[field] < 1) {
      throw new Error(`verification policy ${field} must be an explicit positive safe integer`);
    }
    if (field !== "max_envelope_bytes" && policy[field] > MAX_SAFE_POLICY_SECONDS) {
      throw new Error(`verification policy ${field} exceeds the interoperable millisecond range`);
    }
  }
}

function signingBytes(signerKeyId, payloadBytes) {
  assertKeyId(signerKeyId, "configuration signer key ID");
  const keyIdBytes = Buffer.from(signerKeyId, "ascii");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(keyIdBytes.length);
  return Buffer.concat([DOMAIN, length, keyIdBytes, payloadBytes]);
}

export function tlsnRuntimeConfigSigningBytes(signerKeyId, payload) {
  assertManifestPayload(payload);
  return signingBytes(
    signerKeyId,
    Buffer.from(canonicalJson(payload), "utf8"),
  );
}

export function prepareTlsnRuntimeConfigManifest({
  workerReferenceRaw,
  approvedRelease,
  epoch,
  issuedAt,
  notBefore,
  expiresAt,
}) {
  if (!(typeof workerReferenceRaw === "string" || workerReferenceRaw instanceof Uint8Array)) {
    throw new Error("raw approved Worker reference bytes are required");
  }
  const referenceBytes = Buffer.from(workerReferenceRaw);
  let reference;
  try {
    reference = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(referenceBytes));
  } catch {
    throw new Error("approved Worker reference is malformed JSON");
  }
  if (
    Buffer.from(`${JSON.stringify(reference, null, 2)}\n`).compare(referenceBytes) !== 0
  ) {
    throw new Error("approved Worker reference bytes are not in the captured canonical format");
  }
  assertBuildReference(reference, reference.compile_inputs?.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA);
  assertExactKeys(
    approvedRelease,
    ["context", "publicBindings", "disclosureMode", "production_authority_pins", "compile_inputs"],
    "approved Production release",
  );
  assertExactKeys(
    approvedRelease.compile_inputs,
    ENTRY_INPUT_CONTRACT.compile_inputs.filter(
      (name) => name !== "FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID",
    ),
    "approved release compile inputs before active version observation",
  );
  assertExactKeys(approvedRelease.production_authority_pins, AUTHORITY_PIN_FIELDS, "approved Production authority pins");
  const expectedCompileInputs = {
    ...approvedRelease.compile_inputs,
    FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID: reference.cloudflare.version_id,
  };
  if (
    canonicalJson(reference.compile_inputs) !== canonicalJson(expectedCompileInputs) ||
    canonicalJson(reference.release_context) !== canonicalJson(approvedRelease.context) ||
    canonicalJson(reference.cloudflare.checked_public_bindings) !== canonicalJson(approvedRelease.publicBindings) ||
    reference.disclosure_mode !== approvedRelease.disclosureMode
  ) {
    throw new Error("approved Worker reference does not match the independently approved release");
  }
  for (const name of AUTHORITY_PIN_FIELDS) {
    assertDigest(approvedRelease.production_authority_pins[name], `approved ${name}`);
  }
  const registryRaw = expectedCompileInputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY;
  const registryEnvelopeRaw =
    approvedRelease.publicBindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE;
  const registryRootKeyId =
    approvedRelease.publicBindings.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID;
  const registryRootPublicKeySpki =
    approvedRelease.publicBindings.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI;
  if (
    approvedRelease.publicBindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY !== registryRaw ||
    approvedRelease.publicBindings.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI !==
      expectedCompileInputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI ||
    approvedRelease.publicBindings.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID !==
      expectedCompileInputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID
  ) {
    throw new Error("approved Result signer bindings disagree with the compile inputs");
  }
  assertResultSigningIdentity({
    registry: registryRaw,
    registryRaw,
    keyId: expectedCompileInputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID,
    publicKeySpki: expectedCompileInputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI,
    registryEnvelope: registryEnvelopeRaw,
    registryRootKeyId,
    registryRootPublicKeySpki,
    now: new Date(issuedAt),
  });

  const payload = assertManifestPayload({
    schema_version: TLSN_RUNTIME_CONFIG_MANIFEST_SCHEMA_VERSION,
    scope: TLSN_RUNTIME_CONFIG_MANIFEST_SCOPE,
    environment: "production",
    epoch,
    issued_at: issuedAt,
    not_before: notBefore,
    expires_at: expiresAt,
    source: {
      worker_reference_sha256: createHash("sha256").update(referenceBytes).digest("base64url"),
      observed_at: reference.observed_at,
      account_id: reference.cloudflare.account_id,
      script_name: reference.cloudflare.script_name,
      logical_deployment_id: reference.compile_inputs.FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID,
      cloudflare_deployment_id: reference.cloudflare.deployment_id,
      active_version_id: reference.cloudflare.version_id,
      worker_git_commit_sha: reference.compile_inputs.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA,
      disclosure_mode: reference.disclosure_mode,
    },
    compile_inputs: reference.compile_inputs,
    production_authority_pins: approvedRelease.production_authority_pins,
    result_registry_pins: {
      result_registry_sha256: createHash("sha256")
        .update(registryRaw, "utf8")
        .digest("base64url"),
      result_registry_envelope_sha256: createHash("sha256")
        .update(registryEnvelopeRaw, "utf8")
        .digest("base64url"),
      result_registry_root_key_id: registryRootKeyId,
      result_registry_root_public_key_spki: registryRootPublicKeySpki,
    },
  });
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  return {
    payload,
    payload_base64url: payloadBytes.toString("base64url"),
    signing_bytes(signerKeyId) {
      return tlsnRuntimeConfigSigningBytes(signerKeyId, payload).toString("base64url");
    },
  };
}

export function createTlsnRuntimeConfigEnvelopeRaw({
  signerKeyId,
  payloadBase64Url,
  signatureBase64Url,
}) {
  assertKeyId(signerKeyId, "configuration signer key ID");
  decodeBase64Url(payloadBase64Url, "manifest payload");
  decodeBase64Url(signatureBase64Url, "manifest signature", 64);
  return canonicalJson({
    schema_version: TLSN_RUNTIME_CONFIG_MANIFEST_SCHEMA_VERSION,
    scope: TLSN_RUNTIME_CONFIG_ENVELOPE_SCOPE,
    signature_algorithm: TLSN_RUNTIME_CONFIG_SIGNATURE_ALGORITHM,
    signer_key_id: signerKeyId,
    payload_base64url: payloadBase64Url,
    signature_base64url: signatureBase64Url,
  });
}

export function verifyTlsnRuntimeConfigEnvelope(rawEnvelope, { trustedSigner, policy } = {}) {
  assertTrustedSigner(trustedSigner);
  assertPolicy(policy);
  if (!(typeof rawEnvelope === "string" || rawEnvelope instanceof Uint8Array)) {
    throw new Error("raw signed runtime configuration envelope bytes are required");
  }
  const envelopeBytes = Buffer.from(rawEnvelope);
  if (envelopeBytes.length > policy.max_envelope_bytes) {
    throw new Error("runtime configuration envelope exceeds the supplied byte limit");
  }
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(envelopeBytes));
  } catch {
    throw new Error("runtime configuration envelope is malformed JSON");
  }
  assertExactKeys(envelope, ENVELOPE_FIELDS, "runtime configuration envelope");
  if (
    envelope.schema_version !== TLSN_RUNTIME_CONFIG_MANIFEST_SCHEMA_VERSION ||
    envelope.scope !== TLSN_RUNTIME_CONFIG_ENVELOPE_SCOPE ||
    envelope.signature_algorithm !== TLSN_RUNTIME_CONFIG_SIGNATURE_ALGORITHM
  ) {
    throw new Error("runtime configuration envelope schema or signature algorithm is invalid");
  }
  if (envelope.signer_key_id !== trustedSigner.key_id) {
    throw new Error("runtime configuration signer key ID does not match the external trust pin");
  }
  if (canonicalJson(envelope) !== envelopeBytes.toString("utf8")) {
    throw new Error("runtime configuration envelope is not canonical JSON");
  }

  const payloadBytes = decodeBase64Url(envelope.payload_base64url, "manifest payload");
  const signature = decodeBase64Url(envelope.signature_base64url, "manifest signature", 64);
  const key = createPublicKey({
    key: decodeBase64Url(trustedSigner.public_key_spki, "trusted signer public key"),
    format: "der",
    type: "spki",
  });
  if (!verify(null, signingBytes(envelope.signer_key_id, payloadBytes), key, signature)) {
    throw new Error("runtime configuration signature verification failed");
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    throw new Error("runtime configuration payload is malformed JSON");
  }
  assertWellFormedJsonStrings(payload, "runtime configuration payload");
  if (canonicalJson(payload) !== payloadBytes.toString("utf8")) {
    throw new Error("runtime configuration payload is not canonical JSON");
  }
  assertManifestPayload(payload, new Date(policy.now_ms));

  const epoch = assertEpoch(payload.epoch, "manifest epoch");
  if (epoch <= assertEpoch(policy.last_accepted_epoch, "last accepted epoch", true)) {
    throw new Error("runtime configuration epoch is not newer than the persisted high-water mark");
  }
  const issuedAt = assertCanonicalUtc(payload.issued_at, "manifest issued_at");
  const notBefore = assertCanonicalUtc(payload.not_before, "manifest not_before");
  const expiresAt = assertCanonicalUtc(payload.expires_at, "manifest expires_at");
  const observedAt = assertCanonicalUtc(payload.source.observed_at, "Worker reference observation time");
  const now = policy.now_ms;
  const skewMs = policy.max_clock_skew_seconds * 1000;
  if (
    issuedAt > notBefore ||
    notBefore >= expiresAt ||
    expiresAt - notBefore > policy.max_lifetime_seconds * 1000 ||
    issuedAt > now + skewMs ||
    notBefore > now + skewMs ||
    expiresAt <= now - skewMs
  ) {
    throw new Error("runtime configuration validity window is invalid or not current");
  }
  if (
    observedAt > now + skewMs ||
    now - observedAt > policy.max_reference_age_seconds * 1000
  ) {
    throw new Error("runtime configuration Worker reference is not fresh");
  }
  return payload;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function verifyTlsnRuntimeConfigProductionEnvelope(rawEnvelope, {
  trustedSigner,
  policy,
  independentInputs,
} = {}) {
  if (!independentInputs) {
    throw new Error("independent Production verification inputs are required");
  }
  const payload = verifyTlsnRuntimeConfigEnvelope(rawEnvelope, { trustedSigner, policy });
  const matchedInputs = verifyTlsnRuntimeConfigIndependentInputs(
    payload,
    independentInputs,
    policy.now_ms,
  );
  return Object.freeze({
    state: "MANIFEST_AND_SIGNED_PINS_VERIFIED",
    payload: deepFreeze(payload),
    matched_inputs: matchedInputs,
  });
}

export function createTlsnRuntimeConfigPublicationObjects(rawEnvelope, verification) {
  const verified = verifyTlsnRuntimeConfigProductionEnvelope(rawEnvelope, verification);
  const payload = verified.payload;
  const inputs = verification.independentInputs;
  const artifacts = [
    ["worker-reference", payload.source.worker_reference_sha256, inputs.worker_reference_raw],
    [
      "origin-inventory",
      payload.production_authority_pins.origin_inventory_sha256,
      inputs.origin_inventory_raw,
    ],
    [
      "target-approval",
      payload.production_authority_pins.target_approval_artifact_sha256,
      inputs.target_approval_raw,
    ],
    [
      "security-registry-set",
      payload.production_authority_pins.security_registry_set_sha256,
      inputs.security_registry_set_raw,
    ],
    [
      "result-registry-envelope",
      payload.result_registry_pins.result_registry_envelope_sha256,
      inputs.result_registry_envelope_raw,
    ],
  ];
  const objects = artifacts.map(([kind, digest, body]) => ({
    key: `tlsn/runtime-config/v2/artifacts/${kind}/${digest}`,
    content_type: "application/octet-stream",
    cache_control: "public, max-age=31536000, immutable",
    body: Buffer.from(body),
  }));
  objects.push({
    key: "tlsn/runtime-config/v2/manifest.json",
    content_type: "application/json",
    cache_control: "no-store",
    body: Buffer.from(rawEnvelope),
  });
  return Object.freeze(objects.map((object) => Object.freeze(object)));
}
