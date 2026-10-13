import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { assertResultSigningIdentity, canonicalJson } from "./production-trust-contract.mjs";
import {
  assertAlpha15NotaryVerifyingKey,
  parseOriginInventory,
  parseTargetApproval,
} from "../src/origin-trust-contract.mjs";

const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const INVENTORY_SOURCE = "packages/configs/configs.toml:[app.connect_kc_server.server_list]";
const RESULT_REGISTRY_INPUT = "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY";
const RESULT_SIGNER_ID_INPUT = "FUSOU_TLSN_RESULT_SIGNER_KEY_ID";
const RESULT_SIGNER_KEY_INPUT = "FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI";
const NOTARY_KEY_INPUT = "FUSOU_TLSN_NOTARY_VERIFYING_KEY";

function assertExactKeys(value, fields, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...fields].sort())
  ) {
    throw new Error(`${label} field inventory is invalid`);
  }
}

function requiredBytes(value, label) {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`${label} raw bytes are required`);
  }
  return Buffer.from(value);
}

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
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

function parseJsonBytes(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return { text, value };
}

function verifyWorkerReference(payload, raw, expectedDigest, resultRegistryEnvelopeRaw) {
  const actualDigest = sha256Base64Url(raw);
  if (actualDigest !== expectedDigest || payload.source.worker_reference_sha256 !== expectedDigest) {
    throw new Error("Worker reference bytes do not match the signed manifest digest");
  }

  const { value: reference } = parseJsonBytes(raw, "Worker reference");
  const source = payload.source;
  const cloudflare = reference.cloudflare;
  const bindings = cloudflare?.checked_public_bindings;
  const resultPins = payload.result_registry_pins;
  if (
    reference.schema_version !== 2 ||
    reference.scope !== "tlsn-app-approved-worker-deployment-reference" ||
    reference.authority !== "operator-controlled-approved-release-and-authenticated-cloudflare-control-plane" ||
    reference.observed_at !== source.observed_at ||
    reference.disclosure_mode !== source.disclosure_mode ||
    !cloudflare ||
    cloudflare.account_id !== source.account_id ||
    cloudflare.script_name !== source.script_name ||
    cloudflare.deployment_id !== source.cloudflare_deployment_id ||
    cloudflare.version_id !== source.active_version_id ||
    cloudflare.percentage !== 100 ||
    !reference.release_context ||
    reference.release_context.deployment_role !== "production" ||
    reference.release_context.git_commit_sha !== source.worker_git_commit_sha ||
    canonicalJson(reference.compile_inputs) !== canonicalJson(payload.compile_inputs) ||
    reference.compile_inputs?.FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID !== source.logical_deployment_id ||
    reference.compile_inputs?.FUSOU_TLSN_EXPECTED_WORKER_NAME !== source.script_name ||
    reference.compile_inputs?.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID !== source.active_version_id ||
    reference.compile_inputs?.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA !== source.worker_git_commit_sha ||
    !bindings ||
    bindings.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI !==
      payload.compile_inputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI ||
    bindings.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID !==
      payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID ||
    bindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY !==
      payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY ||
    bindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE !==
      new TextDecoder("utf-8", { fatal: true }).decode(resultRegistryEnvelopeRaw) ||
    bindings.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID !==
      resultPins.result_registry_root_key_id ||
    bindings.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI !==
      resultPins.result_registry_root_public_key_spki
  ) {
    throw new Error("Worker reference identity does not match the signed manifest");
  }
  return actualDigest;
}

function verifyAuthorityArtifacts(payload, rawInventory, rawApproval, rawSecurityRegistrySet, expectedPins) {
  const inventoryDigest = sha256Base64Url(rawInventory);
  const approvalDigest = sha256Base64Url(rawApproval);
  const securitySetDigest = sha256Base64Url(rawSecurityRegistrySet);
  if (
    inventoryDigest !== expectedPins.origin_inventory_sha256 ||
    approvalDigest !== expectedPins.target_approval_artifact_sha256 ||
    securitySetDigest !== expectedPins.security_registry_set_sha256 ||
    canonicalJson(payload.production_authority_pins) !== canonicalJson(expectedPins)
  ) {
    throw new Error("Production authority artifact bytes do not match the signed manifest digests");
  }

  const inventoryText = new TextDecoder("utf-8", { fatal: true }).decode(rawInventory);
  const approvalText = new TextDecoder("utf-8", { fatal: true }).decode(rawApproval);
  const securitySetText = new TextDecoder("utf-8", { fatal: true }).decode(rawSecurityRegistrySet);
  const inventory = parseOriginInventory(inventoryText);
  parseTargetApproval(approvalText, inventory, inventoryDigest);

  const securitySet = JSON.parse(securitySetText);
  assertExactKeys(securitySet, [
    "notary_key_id",
    "notary_registry",
    "origin_inventory_sha256",
    "target_approval_artifact_sha256",
    "profile_policy_sha256",
  ], "Production security registry set");
  if (
    canonicalJson(securitySet) !== securitySetText ||
    securitySet.origin_inventory_sha256 !== inventoryDigest ||
    securitySet.target_approval_artifact_sha256 !== approvalDigest ||
    typeof securitySet.notary_key_id !== "string" ||
    !KEY_ID_PATTERN.test(securitySet.notary_key_id) ||
    !securitySet.notary_registry ||
    typeof securitySet.notary_registry !== "object" ||
    Array.isArray(securitySet.notary_registry) ||
    securitySet.notary_registry[securitySet.notary_key_id] !== payload.compile_inputs[NOTARY_KEY_INPUT] ||
    typeof securitySet.profile_policy_sha256 !== "string" ||
    !DIGEST_PATTERN.test(securitySet.profile_policy_sha256)
  ) {
    throw new Error("Production security registry set does not bind the verified authority artifacts");
  }
  const notaryEntries = Object.entries(securitySet.notary_registry);
  if (notaryEntries.length === 0) {
    throw new Error("Production security registry set Notary registry is empty");
  }
  for (const [keyId, verifyingKey] of notaryEntries) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof verifyingKey !== "string") {
      throw new Error("Production security registry set Notary registry contains an invalid entry");
    }
    assertAlpha15NotaryVerifyingKey(verifyingKey, "Production security registry set Notary key");
  }
  assertDigest(securitySet.profile_policy_sha256, "Production profile policy digest");

  return {
    origin_inventory_sha256: inventoryDigest,
    target_approval_artifact_sha256: approvalDigest,
    security_registry_set_sha256: securitySetDigest,
  };
}

function verifyResultRegistry(payload, rawEnvelope, validationTime) {
  const expectedPins = payload.result_registry_pins;
  const registryRaw = payload.compile_inputs[RESULT_REGISTRY_INPUT];
  const registryBytes = Buffer.from(registryRaw, "utf8");
  const registryDigest = sha256Base64Url(registryBytes);
  const envelopeDigest = sha256Base64Url(rawEnvelope);
  if (
    registryDigest !== expectedPins.result_registry_sha256 ||
    envelopeDigest !== expectedPins.result_registry_envelope_sha256
  ) {
    throw new Error("Result signer registry bytes do not match the signed manifest digests");
  }

  const { text: envelopeRaw } = parseJsonBytes(rawEnvelope, "Result signer registry envelope");
  const identity = assertResultSigningIdentity({
    registry: registryRaw,
    registryRaw,
    keyId: payload.compile_inputs[RESULT_SIGNER_ID_INPUT],
    publicKeySpki: payload.compile_inputs[RESULT_SIGNER_KEY_INPUT],
    registryEnvelope: envelopeRaw,
    registryRootKeyId: expectedPins.result_registry_root_key_id,
    registryRootPublicKeySpki: expectedPins.result_registry_root_public_key_spki,
    now: new Date(validationTime),
  });
  return {
    result_registry_sha256: registryDigest,
    result_registry_envelope_sha256: envelopeDigest,
    result_registry_root_key_id: identity.result_registry_root_key_id,
    result_signer_key_id: identity.key_id,
    result_signer_public_key_spki: identity.public_key_spki,
  };
}

export function verifyTlsnRuntimeConfigIndependentInputs(payload, inputs, validationTime) {
  assertExactKeys(inputs, [
    "worker_reference_raw",
    "origin_inventory_raw",
    "target_approval_raw",
    "security_registry_set_raw",
    "result_registry_envelope_raw",
  ], "independent runtime configuration inputs");
  assertExactKeys(payload.production_authority_pins, [
    "origin_inventory_sha256",
    "target_approval_artifact_sha256",
    "security_registry_set_sha256",
  ], "signed Production authority pins");
  const pins = payload.result_registry_pins;
  assertExactKeys(pins, [
    "result_registry_sha256",
    "result_registry_envelope_sha256",
    "result_registry_root_key_id",
    "result_registry_root_public_key_spki",
  ], "signed Result registry pins");

  for (const [name, digest] of [
    ["Worker reference", payload.source.worker_reference_sha256],
    ["Origin Inventory", payload.production_authority_pins.origin_inventory_sha256],
    ["Target Approval", payload.production_authority_pins.target_approval_artifact_sha256],
    ["security registry set", payload.production_authority_pins.security_registry_set_sha256],
    ["Result signer registry", pins.result_registry_sha256],
    ["Result registry envelope", pins.result_registry_envelope_sha256],
  ]) {
    assertDigest(digest, `${name} expected digest`);
  }
  if (!Number.isSafeInteger(validationTime) || !Number.isFinite(new Date(validationTime).getTime())) {
    throw new Error("independent runtime configuration validation time is invalid");
  }
  if (
    typeof pins.result_registry_root_key_id !== "string" ||
    !KEY_ID_PATTERN.test(pins.result_registry_root_key_id) ||
    typeof pins.result_registry_root_public_key_spki !== "string"
  ) {
    throw new Error("independent Result registry root pin is missing or invalid");
  }

  const workerReferenceRaw = requiredBytes(inputs.worker_reference_raw, "Worker reference");
  const originInventoryRaw = requiredBytes(inputs.origin_inventory_raw, "Origin Inventory");
  const targetApprovalRaw = requiredBytes(inputs.target_approval_raw, "Target Approval");
  const securityRegistrySetRaw = requiredBytes(inputs.security_registry_set_raw, "Production security registry set");
  const resultRegistryEnvelopeRaw = requiredBytes(
    inputs.result_registry_envelope_raw,
    "Result signer registry envelope",
  );

  const workerReferenceDigest = verifyWorkerReference(
    payload,
    workerReferenceRaw,
    payload.source.worker_reference_sha256,
    resultRegistryEnvelopeRaw,
  );
  const authorityDigests = verifyAuthorityArtifacts(
    payload,
    originInventoryRaw,
    targetApprovalRaw,
    securityRegistrySetRaw,
    payload.production_authority_pins,
  );
  const registryBinding = verifyResultRegistry(
    payload,
    resultRegistryEnvelopeRaw,
    validationTime,
  );

  return Object.freeze({
    state: "MATCHED_SIGNED_MANIFEST_PINS",
    worker_reference_sha256: workerReferenceDigest,
    ...authorityDigests,
    ...registryBinding,
  });
}
