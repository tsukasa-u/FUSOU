#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  assertProvenanceEvidence,
  canonicalJson,
  workflowContextFromEnvironment,
} from "./deployment-attestation.mjs";
import { assertPublicManifest } from "./production-trust-contract.mjs";
import { PROFILE_CONTRACT_SPEC } from "./profile-canonical-contract.mjs";

const securityIdentityFields = [
  "git_commit_sha",
  "verifier_key_id",
  "notary_key_id",
  "security_registry_set_sha256",
  "origin_inventory_sha256",
  "profile_policy_sha256",
  "notary_registry_sha256",
  "binding_authority",
];
const deploymentIdentityFields = ["deployment_id", "deployment_role", "binding_mode", "worker_name"];
const resultIdentityFields = [
  "result_public_key_spki",
  "result_public_key_spki_sha256",
  "result_signer_key_id",
  "result_key_registry_sha256",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const manifest = JSON.parse(await readFile(required("TLSN_PROVENANCE_REPORT_PATH"), "utf8"));
  const publicManifest = JSON.parse(await readFile(required("TLSN_PUBLIC_MANIFEST_PATH"), "utf8"));
  assertPublicManifest(publicManifest);
  assertProvenanceEvidence(manifest, workflowContextFromEnvironment(process.env, "production"), "production");
  const profilePolicySha256 = createHash("sha256")
    .update(canonicalJson(PROFILE_CONTRACT_SPEC), "utf8")
    .digest("base64url");
  if (
    manifest.security_identity.notary_key_id !== publicManifest.notary.key_id ||
    manifest.security_identity.notary_registry_sha256 !== publicManifest.notary.registry_sha256 ||
    manifest.security_identity.security_registry_set_sha256 !== publicManifest.security_registry_set_sha256 ||
    manifest.security_identity.origin_inventory_sha256 !== publicManifest.origin_inventory.sha256 ||
    manifest.security_identity.profile_policy_sha256 !== profilePolicySha256
  ) {
    throw new Error("Production provenance trust identity does not match the public manifest and profile policy");
  }

  const origin = new URL(required("TLSN_VERIFY_WORKER_URL")).origin;
  const response = await fetch(`${origin}/health`, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("production Worker health endpoint redirected");
  }
  if (!response.ok) throw new Error(`production Worker health returned ${response.status}`);
  const health = await response.json();
  if (health.environment !== "production" || health.deployment_role !== "production") {
    throw new Error("production Worker environment or role mismatch");
  }
  if (health.schema_version !== 3 || health.security_identity?.trust_contract_valid !== true) {
    throw new Error("production Worker health does not report a valid runtime trust contract");
  }
  for (const [name, fields] of [
    ["security_identity", securityIdentityFields],
    ["deployment_identity", deploymentIdentityFields],
    ["result_identity", resultIdentityFields],
  ]) {
    for (const field of fields) {
      if (health[name]?.[field] !== manifest[name]?.[field]) {
        throw new Error(`post-deploy identity mismatch: ${name}.${field}`);
      }
    }
  }
  if (
    health.security_identity?.notary_key_id !== publicManifest.notary.key_id ||
    health.security_identity?.notary_registry_sha256 !== publicManifest.notary.registry_sha256 ||
    health.security_identity?.security_registry_set_sha256 !== publicManifest.security_registry_set_sha256 ||
    health.authority_identity?.session_authority?.key_id !== publicManifest.session_authority.key_id ||
    health.authority_identity?.session_authority?.public_key_spki !== publicManifest.session_authority.public_key_spki ||
    health.authority_identity?.session_authority?.key_registry_sha256 !== publicManifest.session_authority.key_registry_sha256
  ) {
    throw new Error("deployed Worker trust identity does not match the public Production manifest");
  }
  const smokeResponse = await fetch(`${origin}/attestation/session`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (smokeResponse.status >= 300 && smokeResponse.status < 400) {
    throw new Error("production session endpoint redirected an unauthenticated request");
  }
  if (smokeResponse.status !== 401) {
    throw new Error(`production session smoke returned ${smokeResponse.status}, expected 401`);
  }

  console.log(JSON.stringify({
    status: "PASS",
    worker_origin: origin,
    git_commit_sha: manifest.security_identity.git_commit_sha,
    deployment_id: manifest.deployment_identity.deployment_id,
    verifier_key_id: manifest.security_identity.verifier_key_id,
    origin_inventory_sha256: manifest.security_identity.origin_inventory_sha256,
    profile_policy_sha256: manifest.security_identity.profile_policy_sha256,
    result_public_key_spki: manifest.result_identity.result_public_key_spki,
    smoke_status: smokeResponse.status,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-verify-deployment] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});