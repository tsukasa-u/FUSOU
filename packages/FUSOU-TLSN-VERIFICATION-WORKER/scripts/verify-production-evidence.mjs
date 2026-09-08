#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import {
  assertNoSyntheticEvidence,
  assertObjectIdentity,
  assertProductionEvidenceArtifacts,
  assertResultSubjectIdentity,
  assertSignedProductionEvidenceManifest,
  assertSignedResult,
} from "./production-evidence.mjs";
import { PRODUCTION_EVIDENCE_REQUIREMENTS } from "./production-evidence-contract.mjs";
import { assertSigningKeyRegistry } from "./signing-key-registry.mjs";
import { canonicalJson, workflowContextFromEnvironment } from "./deployment-attestation.mjs";
import {
  assertSemanticResultMatches,
  assertSemanticVerificationArtifact,
  semanticRequirementStatus,
  verifySemanticPredicates,
  verifyProductionPresentation,
} from "./production-evidence-semantic.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseArtifactJson(artifacts, name) {
  if (!artifacts[name]) throw new Error(`production evidence artifact is missing: ${name}`);
  try {
    return JSON.parse(artifacts[name].toString("utf8"));
  } catch {
    throw new Error(`production evidence JSON artifact is invalid: ${name}`);
  }
}

function parseJson(name, value = required(name)) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain JSON`);
  }
}

async function readManifest() {
  const path = required("TLSN_PRODUCTION_EVIDENCE_MANIFEST_PATH");
  return {
    path,
    manifest: JSON.parse(await readFile(path, "utf8")),
  };
}

function expectedWorkflowContext() {
  return workflowContextFromEnvironment(process.env, "production");
}

function safeArtifactPath(manifestPath, artifactPath) {
  if (typeof artifactPath !== "string" || artifactPath.length === 0 || isAbsolute(artifactPath)) {
    throw new Error("production evidence artifact path must be relative");
  }
  const root = resolve(dirname(manifestPath));
  const path = resolve(root, artifactPath);
  const escaped = relative(root, path).startsWith("..");
  if (escaped) throw new Error("production evidence artifact path escapes the manifest directory");
  return path;
}

function assertAllEvidenceItemsPassed(manifest) {
  const artifactHashes = new Set(Object.values(manifest.artifacts ?? {}).map((artifact) => artifact?.artifact_sha256));
  for (const requirement of PRODUCTION_EVIDENCE_REQUIREMENTS) {
    const evidence = manifest.evidence[requirement];
    if (evidence?.status !== "PASS") {
      throw new Error(`production evidence item is not independently passed: ${requirement}`);
    }
    if (!evidence.required_artifacts.every((artifact) => manifest.artifacts?.[artifact])) {
      throw new Error(`production evidence item is missing a required artifact: ${requirement}`);
    }
    if (!artifactHashes.has(evidence.artifact_sha256)) {
      throw new Error(`production evidence item is not bound to a captured artifact: ${requirement}`);
    }
  }
}

async function main() {
  const { path: manifestPath, manifest } = await readManifest();
  const expectedWorkflow = expectedWorkflowContext();
  const expectedDeployment = parseJson("TLSN_PRODUCTION_EVIDENCE_EXPECTED_DEPLOYMENT_IDENTITY_JSON");
  const expectedSecurity = parseJson("TLSN_PRODUCTION_EVIDENCE_EXPECTED_SECURITY_IDENTITY_JSON");
  const expectedResult = parseJson("TLSN_PRODUCTION_EVIDENCE_EXPECTED_RESULT_IDENTITY_JSON");
  const expectedSubject = parseJson("TLSN_PRODUCTION_EVIDENCE_EXPECTED_SUBJECT_IDENTITY_JSON");
  assertSignedProductionEvidenceManifest(manifest, {
    expectedSignerKeyId: required("TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID"),
    expectedSignerPublicKeySpki: required("TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI"),
    expectedWorkflowContext: expectedWorkflow,
    expectedDeploymentIdentity: expectedDeployment,
    expectedSecurityIdentity: expectedSecurity,
    expectedResultIdentity: expectedResult,
    maxAgeSeconds: Number(optional("TLSN_MAX_PRODUCTION_EVIDENCE_AGE_SECONDS") ?? 900),
  });
  assertNoSyntheticEvidence(manifest);
  if (manifest.capture_provenance !== "production") throw new Error("production evidence provenance is unavailable");
  assertAllEvidenceItemsPassed(manifest);

  const artifacts = {};
  for (const [name, descriptor] of Object.entries(manifest.artifacts ?? {})) {
    artifacts[name] = await readFile(safeArtifactPath(manifestPath, descriptor.path));
  }
  assertProductionEvidenceArtifacts(manifest, artifacts);
  if (!artifacts.presentation) throw new Error("production Presentation artifact is required");
  if (!artifacts.result) throw new Error("production result artifact is required");
  if (!artifacts.semantic_verification) throw new Error("verifier-generated semantic artifact is required");
  if (!artifacts.result_registry) throw new Error("captured result registry artifact is required");
  const result = parseArtifactJson(artifacts, "result");
  const publishedResultRegistryRaw = required("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY");
  const registry = parseJson("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY", publishedResultRegistryRaw);
  const capturedResultRegistryRaw = artifacts.result_registry.toString("utf8");
  const capturedResultRegistry = parseArtifactJson(artifacts, "result_registry");
  if (createHash("sha256").update(capturedResultRegistryRaw).digest("base64url") !== createHash("sha256").update(publishedResultRegistryRaw).digest("base64url")) {
    throw new Error("captured result registry does not match the published result registry");
  }
  if (manifest.result_identity?.result_key_registry_sha256 !== createHash("sha256").update(capturedResultRegistryRaw).digest("base64url")) {
    throw new Error("captured result registry does not match the signed Result identity");
  }
  assertSigningKeyRegistry(capturedResultRegistry, {
    currentKeyId: required("TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID"),
    currentPublicKeySpki: required("TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI"),
  });
  const resultPublicKeySpki = required("TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI");
  const resultSignerKeyId = required("TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID");
  assertSigningKeyRegistry(registry, {
    currentKeyId: resultSignerKeyId,
    currentPublicKeySpki: resultPublicKeySpki,
  });
  const resultVerification = assertSignedResult(result, {
    publicKeySpki: resultPublicKeySpki,
    keyRegistry: capturedResultRegistry,
    signerKeyId: resultSignerKeyId,
  });
  assertResultSubjectIdentity(result, manifest.subject_identity);
  assertResultSubjectIdentity(result, expectedSubject);
  assertObjectIdentity(manifest.subject_identity, expectedSubject, "subject identity");
  if (manifest.result_identity?.result_public_key_spki !== resultPublicKeySpki || manifest.result_identity?.result_signer_key_id !== resultSignerKeyId) {
    throw new Error("production evidence result identity does not match the result trust anchor");
  }
  if (expectedResult && manifest.result_identity?.result_public_key_spki !== expectedResult.result_public_key_spki) {
    throw new Error("production evidence result identity is not independently trusted");
  }

  const session = parseArtifactJson(artifacts, "session");
  const subject = parseArtifactJson(artifacts, "subject");
  const health = parseArtifactJson(artifacts, "health");
  const replay = parseArtifactJson(artifacts, "replay");
  if (
    result.attestation_session_id !== session.session_id ||
    result.device_id !== session.device_id ||
    result.device_challenge !== session.device_challenge ||
    result.binding_value !== session.binding ||
    result.binding_nonce !== session.challenge
  ) {
    throw new Error("production Result is not bound to the captured session");
  }
  if (
    subject.user_id_sha256 !== manifest.subject_identity.canonical_user_id_sha256 ||
    subject.device_id_sha256 !== manifest.subject_identity.device_id_sha256 ||
    subject.attestation_session_id_sha256 !== manifest.subject_identity.attestation_session_id_sha256 ||
    subject.verified_member_id_sha256 !== manifest.subject_identity.verified_member_id_sha256 ||
    subject.binding_value_sha256 !== manifest.subject_identity.binding_value_sha256
  ) {
    throw new Error("captured subject artifact does not match the signed Result subject");
  }
  for (const [field, identityField] of [
    ["canonical_user_id", "user_id_sha256"],
    ["device_id", "device_id_sha256"],
    ["attestation_session_id", "attestation_session_id_sha256"],
    ["verified_member_id", "verified_member_id_sha256"],
    ["binding_value", "binding_value_sha256"],
  ]) {
    if (subject[identityField] !== createHash("sha256").update(result[field]).digest("base64url")) {
      throw new Error(`captured subject hash does not match the signed Result: ${field}`);
    }
  }
  if (
    replay.session_id !== session.session_id ||
    replay.device_id !== session.device_id ||
    replay.binding !== session.binding ||
    replay.status !== 409 ||
    !["binding_consumed", "device_possession_replayed"].includes(replay.error)
  ) {
    throw new Error("captured production replay evidence is invalid");
  }
  assertObjectIdentity(health.security_identity, manifest.security_identity, "health security identity");
  assertObjectIdentity(health.deployment_identity, manifest.deployment_identity, "health deployment identity");
  assertObjectIdentity(health.result_identity, manifest.result_identity, "health result identity");
  for (const [field, expected] of Object.entries({
    server_identity: expectedSecurity.server_identity,
    profile_sha256: expectedSecurity.profile_sha256,
    verifier_key_id: expectedSecurity.verifier_key_id,
    notary_key_id: expectedSecurity.notary_key_id,
  })) {
    if (result[field] !== expected) throw new Error(`signed Result security identity mismatch: ${field}`);
  }

  const presentation = artifacts.presentation;
  const notaryRegistry = parseArtifactJson(artifacts, "notary_registry");
  const notaryRegistryBytes = artifacts.notary_registry;
  const trustRootDer = artifacts.trust_root?.toString("base64url");
  if (!manifest.deployment_identity?.trust_root_certificate_sha256 || !trustRootDer) {
    throw new Error("production trust root is required for offline semantic verification");
  }
  if (
    trustRootDer &&
    manifest.deployment_identity?.trust_root_certificate_sha256 !== createHash("sha256").update(artifacts.trust_root).digest("base64url")
  ) {
    throw new Error("captured trust root does not match the trusted Worker identity");
  }
  if (
    manifest.security_identity?.notary_registry_sha256 !== undefined &&
    manifest.security_identity.notary_registry_sha256 !== createHash("sha256").update(notaryRegistryBytes).digest("base64url")
  ) {
    throw new Error("captured Notary registry hash does not match the trusted Worker identity");
  }
  const semanticVerification = await verifyProductionPresentation({
    presentationBytes: presentation,
    serverIdentity: expectedSecurity.server_identity,
    profileSha256: expectedSecurity.profile_sha256,
    verifierKeyId: expectedSecurity.verifier_key_id,
    notaryKeyId: expectedSecurity.notary_key_id,
    canonicalUserId: result.canonical_user_id,
    canonicalDeviceId: result.device_id,
    deviceChallenge: result.device_challenge,
    notaryRegistry,
    trustAnchorDer: trustRootDer,
  });
  const trustedInputs = {
    server_identity: expectedSecurity.server_identity,
    profile_id: "fusou-require-info-v1",
    profile_sha256: expectedSecurity.profile_sha256,
    verifier_key_id: expectedSecurity.verifier_key_id,
    notary_key_id: expectedSecurity.notary_key_id,
    notary_key_sha256: createHash("sha256").update(Buffer.from(notaryRegistry[expectedSecurity.notary_key_id], "base64url")).digest("base64url"),
    trust_root_certificate_sha256: manifest.deployment_identity.trust_root_certificate_sha256,
    result_public_key_spki: manifest.result_identity.result_public_key_spki,
    result_signer_key_id: manifest.result_identity.result_signer_key_id,
    result_key_registry_sha256: manifest.result_identity.result_key_registry_sha256,
  };
  const predicateResults = verifySemanticPredicates({
    presentationBytes: presentation,
    semanticVerification,
    result,
    trustedInputs,
    notaryRegistry,
    resultRegistry: capturedResultRegistry,
    resultPublicKeySpki,
    resultSignerKeyId,
  });
  if (Object.values(predicateResults).some((predicate) => predicate.status !== "PASS")) {
    throw new Error("recomputed semantic predicate verification did not pass");
  }
  assertSemanticResultMatches(result, semanticVerification);
  const semanticArtifact = parseArtifactJson(artifacts, "semantic_verification");
  assertSemanticVerificationArtifact(semanticArtifact, {
    presentationBytes: presentation,
    semanticVerification,
    result,
    predicateResults,
    trustedInputs,
  });
  if (manifest.semantic_verification?.artifact !== "semantic_verification" || manifest.semantic_verification.status !== "VERIFIED") {
    throw new Error("manifest does not reference a verified semantic artifact");
  }
  if (canonicalJson(manifest.semantic_predicates) !== canonicalJson(semanticArtifact.predicates)) {
    throw new Error("manifest semantic predicates do not match the verifier artifact");
  }
  for (const requirement of Object.keys(manifest.evidence)) {
    const expectedStatus = semanticRequirementStatus(requirement, predicateResults);
    if (expectedStatus !== "PASS" && manifest.evidence[requirement].status !== expectedStatus) {
      throw new Error(`evidence requirement is not blocked by its predicate result: ${requirement}`);
    }
  }

  assert.equal(manifest.production_evidence, "BLOCKED");
  assert.equal(manifest.p0_05, "BLOCKED");
  assert.equal(manifest.production_evidence_status, "BLOCKED");
  assert.equal(manifest.p0_05_status, "BLOCKED");
  console.log(JSON.stringify({
    status: "BLOCKED",
    manifest_path: manifestPath,
    capture_id: manifest.capture_id,
    independently_verified_items: PRODUCTION_EVIDENCE_REQUIREMENTS.length,
    verification_status: "VERIFIED",
    production_evidence: manifest.production_evidence,
    p0_05: manifest.p0_05,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-verify-production-evidence] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
