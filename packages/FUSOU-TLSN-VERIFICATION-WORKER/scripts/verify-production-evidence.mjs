#!/usr/bin/env node

import assert from "node:assert/strict";
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
import { workflowContextFromEnvironment } from "./deployment-attestation.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
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
    if (manifest.evidence[requirement]?.status !== "PASS") {
      throw new Error(`production evidence item is not independently passed: ${requirement}`);
    }
    if (!artifactHashes.has(manifest.evidence[requirement].artifact_sha256)) {
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
  const result = JSON.parse(artifacts.result.toString("utf8"));
  const registry = parseJson("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY");
  const resultPublicKeySpki = required("TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI");
  const resultSignerKeyId = required("TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID");
  assertSigningKeyRegistry(registry, {
    currentKeyId: resultSignerKeyId,
    currentPublicKeySpki: resultPublicKeySpki,
  });
  assertSignedResult(result, {
    publicKeySpki: resultPublicKeySpki,
    keyRegistry: registry,
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

  assert.equal(manifest.production_evidence, "BLOCKED");
  assert.equal(manifest.p0_05, "BLOCKED");
  console.log(JSON.stringify({
    status: "BLOCKED",
    manifest_path: manifestPath,
    capture_id: manifest.capture_id,
    independently_verified_items: PRODUCTION_EVIDENCE_REQUIREMENTS.length,
    production_evidence: manifest.production_evidence,
    p0_05: manifest.p0_05,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-verify-production-evidence] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
