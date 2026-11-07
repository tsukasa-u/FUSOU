import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertProductionEvidenceManifest,
  blockedProductionEvidenceManifest,
  createProductionEvidenceItem,
  PRODUCTION_EVIDENCE_SEMANTIC_PREDICATES,
  PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS,
  PRODUCTION_EVIDENCE_SPARSE_SEMANTIC_PREDICATE_DEFINITIONS,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function preserveStatuses(definitions, existing) {
  return Object.fromEntries(Object.entries(definitions).map(([name, item]) => [
    name,
    {
      ...item,
      status: existing?.[name]?.status ?? item.status,
    },
  ]));
}

function prepareMaterialManifest(path) {
  const existing = readJson(path);
  const contractManifest = blockedProductionEvidenceManifest({
    captureId: existing.capture_id,
    now: existing.capture_started_at,
    workflowContext: existing.workflow_context ?? null,
    deploymentIdentity: existing.deployment_identity ?? null,
    securityIdentity: existing.security_identity ?? null,
    resultIdentity: existing.result_identity ?? null,
    subjectIdentity: existing.subject_identity ?? null,
    captureProvenance: existing.capture_provenance,
  });
  const manifest = { ...contractManifest, ...existing };
  manifest.artifacts = existing.artifacts;
  manifest.evidence = preserveStatuses(contractManifest.evidence, existing.evidence);
  manifest.evidence.real_production_result_registry_authentication =
    createProductionEvidenceItem("real_production_result_registry_authentication", {
      timestamp: existing.capture_started_at,
      status: existing.evidence?.real_production_result_registry_authentication?.status ?? "PASS",
      detail: "synthetic finalizer fixture preserves the verifier's registry-authentication input",
    });
  manifest.semantic_predicates = contractManifest.semantic_predicates;
  manifest.device_predicates = preserveStatuses(
    contractManifest.device_predicates,
    existing.device_predicates,
  );
  manifest.capture_predicates = preserveStatuses(
    contractManifest.capture_predicates,
    existing.capture_predicates,
  );
  manifest.semantic_verification = null;
  manifest.independent_verification = contractManifest.independent_verification;
  writeFileSync(path, `${JSON.stringify(manifest)}\n`);
}

function validateFinalizedBundle(bundlePath) {
  const manifest = readJson(join(bundlePath, "manifest.json"));
  assertProductionEvidenceManifest(manifest);

  const semanticPath = join(bundlePath, "artifacts/semantic_verification.bin");
  const semanticBytes = readFileSync(semanticPath);
  const semantic = JSON.parse(semanticBytes);
  const descriptor = manifest.artifacts.semantic_verification;
  const sparse = semantic.semantic_result?.version === 3;
  const definitions = sparse
    ? {
      ...PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS,
      ...PRODUCTION_EVIDENCE_SPARSE_SEMANTIC_PREDICATE_DEFINITIONS,
    }
    : PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS;
  const expectedNames = [...PRODUCTION_EVIDENCE_SEMANTIC_PREDICATES].sort();

  assert.deepEqual(Object.keys(manifest.semantic_predicates).sort(), expectedNames);
  assert.deepEqual(Object.keys(semantic.predicates).sort(), expectedNames);
  assert.deepEqual(semantic.predicates, manifest.semantic_predicates);
  assert.equal(semantic.generation_origin, "offline_finalizer");
  assert.equal(manifest.semantic_verification.source, "offline_finalizer");
  assert.equal(descriptor.provenance, "offline_finalizer");
  assert.equal(descriptor.path, "artifacts/semantic_verification.bin");
  assert.equal(descriptor.byte_length, semanticBytes.length);
  assert.equal(
    descriptor.artifact_sha256,
    createHash("sha256").update(semanticBytes).digest("base64url"),
  );
  assert.equal(semantic.input.presentation_sha256, manifest.artifacts.presentation.artifact_sha256);
  assert.equal(semantic.input.presentation_size_bytes, manifest.artifacts.presentation.byte_length);
  assert.equal(manifest.semantic_verification.status, "VERIFIED");
  assert.equal(manifest.semantic_verification.verifier_identity, semantic.verifier_identity);
  assert.equal(manifest.semantic_verification.verified_at, semantic.verified_at);
  assert.equal(manifest.verification_status, "VERIFIED");
  assert.equal(manifest.status, "BLOCKED");
  assert.equal(manifest.production_evidence_status, "BLOCKED");
  assert.equal(manifest.p0_05_status, "BLOCKED");

  for (const name of PRODUCTION_EVIDENCE_SEMANTIC_PREDICATES) {
    const predicate = manifest.semantic_predicates[name];
    const definition = definitions[name];
    for (const field of [
      "required_artifacts",
      "required_fields",
      "verification_method",
      "authority_identity",
      "derived_fields",
    ]) {
      assert.deepEqual(predicate[field], definition[field], `${name}.${field}`);
    }
    assert.equal(predicate.status, "PASS", `${name}.status`);
    assert.equal(predicate.verified_at, semantic.verified_at, `${name}.verified_at`);
    assert.ok(
      predicate.required_artifacts.every((role) => predicate.evidence_artifacts.includes(role)),
      `${name} evidence artifacts cover its required roles`,
    );
    assert.ok(
      predicate.evidence_artifacts.every((role) => manifest.artifacts[role]),
      `${name} evidence artifacts exist in the published manifest`,
    );
    assert.ok(predicate.detail.length > 0, `${name}.detail`);
    for (const field of predicate.derived_fields) {
      assert.ok(Object.hasOwn(predicate.observed, field), `${name}.observed.${field}`);
    }
  }

  if (sparse) {
    assert.equal(semantic.semantic_result.disclosure_mode, "sparse");
    assert.equal(Object.hasOwn(semantic.derived_from_presentation, "request_transcript_sha256"), false);
    assert.equal(Object.hasOwn(semantic.derived_from_presentation, "response_transcript_sha256"), false);
    for (const predicate of Object.values(manifest.semantic_predicates)) {
      assert.equal(Object.hasOwn(predicate.observed, "request_transcript_sha256"), false);
      assert.equal(Object.hasOwn(predicate.observed, "response_transcript_sha256"), false);
    }
  } else {
    assert.equal(semantic.semantic_result.version, 2);
    assert.equal(typeof semantic.derived_from_presentation.request_transcript_sha256, "string");
    assert.equal(typeof semantic.derived_from_presentation.response_transcript_sha256, "string");
  }
}

const [mode, path] = process.argv.slice(2);
if (mode === "prepare") {
  prepareMaterialManifest(path);
} else if (mode === "validate") {
  validateFinalizedBundle(path);
} else {
  throw new Error("expected mode 'prepare' or 'validate'");
}
