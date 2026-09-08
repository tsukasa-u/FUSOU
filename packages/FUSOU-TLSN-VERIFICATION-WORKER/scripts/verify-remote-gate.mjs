#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  assertCheckoutCommit,
  assertEvidenceContext,
  assertProvenanceEvidence,
  assertRemoteAttestation,
  assertRemoteReportGate,
  assertTimestamp,
  assertValidationId,
  assertValidationWindow,
  createRemoteAttestation,
  DEPLOYMENT_IDENTITY_FIELDS,
  RESULT_IDENTITY_FIELDS,
  SECURITY_IDENTITY_FIELDS,
  workflowContextFromEnvironment,
  writeImmutableJson,
} from "./deployment-attestation.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

async function readCanaryHealth(origin) {
  const response = await fetch(`${origin}/health`, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("current canary health endpoint redirected");
  }
  if (!response.ok) throw new Error(`current canary health returned ${response.status}`);
  return response.json();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function compareIdentity(left, right, label, fields) {
  for (const field of fields) {
    if (left?.[field] !== right?.[field]) {
      throw new Error(`${label} identity mismatch: ${field}`);
    }
  }
}

async function main() {
  const expectedContext = workflowContextFromEnvironment(process.env, "canary");
  assertCheckoutCommit(expectedContext, new URL("..", import.meta.url).pathname);
  const reportPath = process.env.TLSN_REMOTE_VALIDATION_REPORT_PATH?.trim()
    ?? process.env.TLSN_REMOTE_REPORT_PATH?.trim();
  if (!reportPath) throw new Error("missing required environment variable: TLSN_REMOTE_REPORT_PATH");
  const canaryPath = required("TLSN_REMOTE_EXPECTED_PROVENANCE_JSON");
  const report = await readJson(reportPath);
  const canaryBytes = await readFile(canaryPath);
  const reportBytes = await readFile(reportPath);
  const canary = JSON.parse(canaryBytes.toString("utf8"));
  assertRemoteReportGate(report);
  assertEvidenceContext(report, expectedContext, "remote report");
  assertTimestamp(report.created_at, "remote report created_at");
  assertValidationWindow(report.validation_started_at, report.validation_finished_at);
  assertValidationId(report.validation_id);
  assertProvenanceEvidence(canary, expectedContext, "canary");
  compareIdentity(report.security_identity, canary.security_identity, "remote validation security", SECURITY_IDENTITY_FIELDS);
  compareIdentity(report.deployment_identity, canary.deployment_identity, "remote validation deployment", DEPLOYMENT_IDENTITY_FIELDS);
  compareIdentity(report.result_identity, canary.result_identity, "remote validation result", RESULT_IDENTITY_FIELDS);
  const productionPath = optional("TLSN_PROVENANCE_REPORT_PATH");
  const production = productionPath ? await readJson(productionPath) : undefined;
  if (production) {
    assertProvenanceEvidence(production, { ...expectedContext, deployment_role: "production" }, "production");
    compareIdentity(canary.security_identity, production.security_identity, "canary/production security", SECURITY_IDENTITY_FIELDS);
    compareIdentity(report.security_identity, production.security_identity, "remote/production security", SECURITY_IDENTITY_FIELDS);
    if (canary.result_identity.result_public_key_spki === production.result_identity.result_public_key_spki) {
      throw new Error("canary and production result public keys must be different");
    }
  }
  const expectedOrigin = new URL(required("TLSN_REMOTE_WORKER_URL")).origin;
  if (report.worker_origin !== expectedOrigin) {
    throw new Error("remote validation report worker origin mismatch");
  }
  const health = await readCanaryHealth(expectedOrigin);
  if (health.environment !== "production" || health.deployment_role !== "canary") {
    throw new Error("current remote Worker is not the production canary");
  }
  compareIdentity(health.security_identity, canary.security_identity, "current canary Worker security", SECURITY_IDENTITY_FIELDS);
  compareIdentity(health.deployment_identity, canary.deployment_identity, "current canary Worker deployment", DEPLOYMENT_IDENTITY_FIELDS);
  compareIdentity(health.result_identity, canary.result_identity, "current canary Worker result", RESULT_IDENTITY_FIELDS);
  compareIdentity(report.security_identity, health.security_identity, "remote validation/current canary security", SECURITY_IDENTITY_FIELDS);

  const attestationPath = optional("TLSN_REMOTE_ATTESTATION_PATH");
  const attestationOutputPath = optional("TLSN_REMOTE_ATTESTATION_OUTPUT_PATH");
  if (!attestationPath && !attestationOutputPath) {
    throw new Error("remote validation attestation input or output path is required");
  }
  if (attestationPath) {
    const attestation = await readJson(attestationPath);
    assertRemoteAttestation(attestation, expectedContext, canary, report, canaryBytes, reportBytes);
  }
  if (attestationOutputPath) {
    const attestation = createRemoteAttestation({
      expectedContext,
      canaryProvenance: canary,
      remoteReport: report,
      canaryBytes,
      reportBytes,
    });
    assertRemoteAttestation(attestation, expectedContext, canary, report, canaryBytes, reportBytes);
    await writeImmutableJson(attestationOutputPath, attestation);
  }

  console.log(JSON.stringify({
    status: "PASS",
    validated_worker_origin: report.worker_origin,
    git_commit_sha: production?.security_identity?.git_commit_sha ?? canary.security_identity.git_commit_sha,
    deployment_id: production?.deployment_identity?.deployment_id ?? canary.deployment_identity.deployment_id,
    binding_mode: canary.deployment_identity.binding_mode,
    attestation_path: attestationOutputPath ?? attestationPath,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-verify-remote-gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});