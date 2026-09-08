#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertDistinctResultKeys,
  assertManifest,
  CANARY_INPUTS,
  CANARY_SECRET_INPUTS,
  COMMON_INPUTS,
  environmentForNames,
  FORBIDDEN_CANARY_INPUTS,
  FORBIDDEN_PRODUCTION_INPUTS,
  PRODUCTION_INPUTS,
  PRODUCTION_SECRET_INPUTS,
  inputsForRole,
  secretInputsForRole,
} from "./deployment-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const workflowPath = resolve(packageDirectory, "../../.github/workflows/tlsn-production-deploy.yml");
const manifest = JSON.parse(await readFile(resolve(packageDirectory, "scripts/production-inputs.json"), "utf8"));
const workflow = await readFile(workflowPath, "utf8");
const canaryWrapper = await readFile(resolve(packageDirectory, "scripts/deploy-canary.mjs"), "utf8");
const productionWrapper = await readFile(resolve(packageDirectory, "scripts/deploy-production.mjs"), "utf8");

assertManifest(manifest);
assert.deepEqual(new Set(CANARY_INPUTS).intersection(new Set(PRODUCTION_INPUTS)), new Set());
assert.deepEqual(new Set(CANARY_SECRET_INPUTS).intersection(new Set(PRODUCTION_SECRET_INPUTS)), new Set());
assert.deepEqual(new Set(inputsForRole("canary")).intersection(new Set(PRODUCTION_INPUTS)), new Set());
assert.deepEqual(new Set(inputsForRole("production")).intersection(new Set(CANARY_INPUTS)), new Set());
assert.deepEqual(new Set(secretInputsForRole("canary")).intersection(new Set(secretInputsForRole("production"))), new Set());

const allInputs = Object.fromEntries(
  [...new Set([...COMMON_INPUTS, ...CANARY_INPUTS, ...PRODUCTION_INPUTS, ...CANARY_SECRET_INPUTS, ...PRODUCTION_SECRET_INPUTS])]
    .map((name) => [name, `fixture-${name}`]),
);
const canaryChildEnvironment = environmentForNames(allInputs, [...COMMON_INPUTS, ...CANARY_INPUTS, ...CANARY_SECRET_INPUTS]);
const productionChildEnvironment = environmentForNames(allInputs, [...COMMON_INPUTS, ...PRODUCTION_INPUTS, ...PRODUCTION_SECRET_INPUTS]);
for (const name of FORBIDDEN_CANARY_INPUTS) assert.equal(canaryChildEnvironment[name], undefined, `Canary received ${name}`);
for (const name of FORBIDDEN_PRODUCTION_INPUTS) assert.equal(productionChildEnvironment[name], undefined, `Production received ${name}`);

const securityIdentity = {
  git_commit_sha: "a".repeat(40),
  server_identity: "game.example.com",
  profile_sha256: "A".repeat(43),
  verifier_key_id: "verifier",
  notary_key_id: "notary",
  security_registry_set_sha256: "B".repeat(43),
  notary_registry_sha256: "C".repeat(43),
  binding_authority: "durable-single-use",
};
const canaryProvenance = {
  security_identity: securityIdentity,
  deployment_identity: {
    deployment_id: "canary",
    deployment_role: "canary",
    binding_mode: "fixed_canary",
    trust_root_certificate_sha256: "D".repeat(43),
    worker_name: "fusou-tlsn-canary",
  },
  result_identity: {
    result_public_key_spki: "canary-key",
    result_signer_key_id: "canary-result",
    result_key_registry_sha256: "C".repeat(43),
  },
};
const productionProvenance = {
  security_identity: { ...securityIdentity },
  deployment_identity: {
    deployment_id: "production",
    deployment_role: "production",
    binding_mode: "random",
    trust_root_certificate_sha256: "E".repeat(43),
    worker_name: "fusou-tlsn-production",
  },
  result_identity: {
    result_public_key_spki: "production-key",
    result_signer_key_id: "production-result",
    result_key_registry_sha256: "D".repeat(43),
  },
};
assert.deepEqual(canaryProvenance.security_identity, productionProvenance.security_identity);
assert.notEqual(canaryProvenance.deployment_identity.trust_root_certificate_sha256, productionProvenance.deployment_identity.trust_root_certificate_sha256);
assert.doesNotThrow(() => assertDistinctResultKeys(
  canaryProvenance,
  productionProvenance,
));

assert.match(workflow, /environment: tlsn-canary/);
assert.match(workflow, /environment: tlsn-production/);
assert.doesNotMatch(workflow, /environment: production/);
const canaryJob = workflow.slice(workflow.indexOf("\n  canary:"), workflow.indexOf("\n  remote-validation:"));
const remoteJob = workflow.slice(workflow.indexOf("\n  remote-validation:"), workflow.indexOf("\n  production:"));
const productionJob = workflow.slice(workflow.indexOf("\n  production:"));
assert.doesNotMatch(canaryJob, /TLSN_PRODUCTION_|PRODUCTION_SIGNING|PRODUCTION_TRUST/);
assert.doesNotMatch(remoteJob, /TLSN_PRODUCTION_|PRODUCTION_SIGNING|PRODUCTION_TRUST/);
assert.doesNotMatch(remoteJob, /TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8|TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER/);
assert.doesNotMatch(productionJob, /TLSN_CANARY_|CANARY_SIGNING|CANARY_TRUST/);
assert.match(productionJob, /TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8/);
assert.match(remoteJob, /TLSN_REMOTE_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8/);
assert.doesNotMatch(productionJob, /TLSN_REMOTE_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8/);
assert.match(productionJob, /TLSN_ATTESTATION_SIGNER_PUBLIC_KEY_SPKI/);
assert.match(workflow, /remote-validation:\n\s+name:[\s\S]*?needs: canary/);
assert.match(workflow, /production:\n\s+name:[\s\S]*?needs: remote-validation/);
assert.match(remoteJob, /run: pnpm --filter fusou-tlsn-verification-worker run verify:remote-gate/);
assert.match(remoteJob, /tlsn-remote-validation-attestation\.json/);
assert.match(productionJob, /TLSN_REMOTE_ATTESTATION_PATH/);
assert.doesNotMatch(workflow, /TLSN_REMOTE_ALLOW_DECLARED_BLOCKED/);
for (const field of ["TLSN_WORKFLOW_RUN_ID", "TLSN_WORKFLOW_RUN_ATTEMPT", "TLSN_REPOSITORY", "TLSN_WORKFLOW_FILE_IDENTITY"]) {
  assert.match(workflow, new RegExp(field));
}
assert.match(canaryWrapper, /wrangler", "deploy", "--env", "canary/);
assert.match(productionWrapper, /wrangler", "deploy", "--env", "production/);

console.log("[tlsn-deployment-isolation] role input, key, provenance, and workflow boundaries OK");
