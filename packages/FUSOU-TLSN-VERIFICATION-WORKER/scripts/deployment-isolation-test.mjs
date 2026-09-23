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
  TEST_ONLY_INPUTS,
  inputsForRole,
  secretInputsForRole,
} from "./deployment-contract.mjs";
import {
  assertCanonicalCanaryWorkerName,
  CANARY_BOOTSTRAP_WORKER_NAME,
  CANARY_VERIFIER_WORKER_NAME,
  CANARY_WORKER_NAME,
} from "./canary-deployment-target.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const manifest = JSON.parse(await readFile(resolve(packageDirectory, "scripts/production-inputs.json"), "utf8"));
const canaryWrapper = await readFile(resolve(packageDirectory, "scripts/deploy-canary.mjs"), "utf8");
const productionWrapper = await readFile(resolve(packageDirectory, "scripts/deploy-production.mjs"), "utf8");
const wrangler = await readFile(resolve(packageDirectory, "wrangler.toml"), "utf8");
const canaryBootstrapWrangler = await readFile(resolve(packageDirectory, "wrangler.canary-bootstrap.toml"), "utf8");
const canaryVerifierWrangler = await readFile(resolve(packageDirectory, "wrangler.verifier-canary.toml"), "utf8");
const rootPackage = JSON.parse(await readFile(resolve(packageDirectory, "../../package.json"), "utf8"));

function environmentSection(name) {
  const start = wrangler.indexOf(`[env.${name}]`);
  assert.notEqual(start, -1, `missing Wrangler environment ${name}`);
  const nextEnvironment = wrangler.indexOf("\n[env.", start + 1);
  return wrangler.slice(start, nextEnvironment === -1 ? undefined : nextEnvironment);
}

assertManifest(manifest);
assert.deepEqual(new Set(CANARY_INPUTS).intersection(new Set(PRODUCTION_INPUTS)), new Set());
assert.deepEqual(new Set(CANARY_SECRET_INPUTS).intersection(new Set(PRODUCTION_SECRET_INPUTS)), new Set());
assert.deepEqual(new Set(inputsForRole("canary")).intersection(new Set(PRODUCTION_INPUTS)), new Set());
assert.deepEqual(new Set(inputsForRole("production")).intersection(new Set(CANARY_INPUTS)), new Set());
assert.deepEqual(new Set(CANARY_SECRET_INPUTS).intersection(new Set(PRODUCTION_SECRET_INPUTS)), new Set());
assert.deepEqual(secretInputsForRole("canary"), [...CANARY_SECRET_INPUTS]);
assert.deepEqual(secretInputsForRole("production"), [...PRODUCTION_SECRET_INPUTS]);

const allInputs = Object.fromEntries(
  [...new Set([...COMMON_INPUTS, ...CANARY_INPUTS, ...PRODUCTION_INPUTS, ...CANARY_SECRET_INPUTS, ...PRODUCTION_SECRET_INPUTS, ...TEST_ONLY_INPUTS])]
    .map((name) => [name, `fixture-${name}`]),
);
const canaryChildEnvironment = environmentForNames(allInputs, [...COMMON_INPUTS, ...CANARY_INPUTS, ...CANARY_SECRET_INPUTS]);
const productionChildEnvironment = environmentForNames(allInputs, [...COMMON_INPUTS, ...PRODUCTION_INPUTS, ...PRODUCTION_SECRET_INPUTS]);
for (const name of FORBIDDEN_CANARY_INPUTS) assert.equal(canaryChildEnvironment[name], undefined, `Canary received ${name}`);
for (const name of FORBIDDEN_PRODUCTION_INPUTS) assert.equal(productionChildEnvironment[name], undefined, `Production received ${name}`);
for (const name of TEST_ONLY_INPUTS) {
  assert.equal(canaryChildEnvironment[name], undefined, `Canary received test-only input ${name}`);
  assert.equal(productionChildEnvironment[name], undefined, `Production received test-only input ${name}`);
}

const securityIdentity = {
  git_commit_sha: "a".repeat(40),
  server_identity: "game.example.com",
  profile_sha256: "A".repeat(43),
  sparse_profile_sha256: "D".repeat(43),
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

for (const name of ["tlsn:deploy:test", "tlsn:deploy:canary", "tlsn:deploy:production"]) {
  assert.match(rootPackage.scripts[name], /^dotenvx run --strict --overload /, `${name} must use dotenvx`);
}
assert.doesNotMatch(rootPackage.scripts["tlsn:deploy:canary"], /github|actions/i);
assert.doesNotMatch(rootPackage.scripts["tlsn:deploy:production"], /github|actions/i);
assert.doesNotThrow(() => assertCanonicalCanaryWorkerName(CANARY_WORKER_NAME));
for (const workerName of [
  "fusou-tlsn-verification-production",
  "fusou-tlsn-verification-canary-arbitrary",
  "",
  "fusou-tlsn-verification-canary-2026",
]) {
  assert.throws(
    () => assertCanonicalCanaryWorkerName(workerName),
    /DENIED:.*canonical Canary Worker identity/,
    `non-canonical Worker name must be denied: ${workerName || "<empty>"}`,
  );
}
assert.match(canaryWrapper, /assertCanonicalCanaryWorkerName\(process\.env\.TLSN_CANARY_WORKER_NAME\?\.trim\(\)\)/);
assert.match(canaryWrapper, /"--name", CANARY_WORKER_NAME/);
assert.match(canaryWrapper, /"--name", CANARY_BOOTSTRAP_WORKER_NAME/);
assert.match(canaryWrapper, /"--name", CANARY_VERIFIER_WORKER_NAME/);
assert.doesNotMatch(canaryWrapper, /--name", workerName/);
assert.doesNotMatch(canaryWrapper, /script_name = "\$\{workerName\}"/);
assert.ok(
  canaryWrapper.indexOf("  assertCanonicalCanaryWorkerName(process.env.TLSN_CANARY_WORKER_NAME?.trim());") < canaryWrapper.indexOf("build:wasm"),
  "canonical target denial must precede build",
);
assert.ok(
  canaryWrapper.indexOf("  assertCanonicalCanaryWorkerName(process.env.TLSN_CANARY_WORKER_NAME?.trim());") < canaryWrapper.indexOf("const secretDirectory = await mkdtemp("),
  "canonical target denial must precede secret directory creation",
);
assert.equal(CANARY_BOOTSTRAP_WORKER_NAME, "fusou-tlsn-verification-canary-bootstrap");
assert.equal(CANARY_VERIFIER_WORKER_NAME, "fusou-tlsn-verifier-canary");
assert.match(canaryWrapper, /wrangler", "deploy", "--env", "canary/);
assert.match(canaryWrapper, /wrangler\.canary-bootstrap\.toml/);
assert.match(canaryWrapper, /bootstrapDeploy/);
assert.match(canaryWrapper, /verifierConfigPath/);
assert.match(productionWrapper, /wrangler", "deploy", "--env", "production/);

const testEnvironment = environmentSection("test");
const evidenceEnvironment = environmentSection("evidence");
const canaryEnvironment = environmentSection("canary");
const productionEnvironment = environmentSection("production");
assert.match(testEnvironment, /binding = "TLSN_DIRECT_VERIFIER"/);
assert.match(evidenceEnvironment, /binding = "TLSN_DIRECT_VERIFIER"/);
assert.match(evidenceEnvironment, /service = "fusou-tlsn-verifier-evidence"/);
assert.match(evidenceEnvironment, /bucket_name = "fusou-tlsn-verification-evidence"/);
assert.match(canaryEnvironment, /binding = "TLSN_DIRECT_VERIFIER"/);
assert.match(canaryEnvironment, /service = "fusou-tlsn-verifier-canary"/);
assert.doesNotMatch(canaryEnvironment, /fusou-tlsn-verifier-test|fusou-tlsn-verification-test/);
assert.doesNotMatch(productionEnvironment, /TLSN_DIRECT_VERIFIER|fusou-tlsn-verifier-test|fusou-tlsn-verification-test/);
assert.doesNotMatch(canaryEnvironment, /fusou-tlsn-verifier-evidence|fusou-tlsn-verification-evidence/);
assert.doesNotMatch(productionEnvironment, /fusou-tlsn-verifier-evidence|fusou-tlsn-verification-evidence/);
assert.match(canaryVerifierWrangler, /script_name = "fusou-tlsn-verification-canary"/);
assert.match(canaryVerifierWrangler, /bucket_name = "fusou-tlsn-verification-canary"/);
assert.doesNotMatch(canaryBootstrapWrangler, /TLSN_DIRECT_VERIFIER|fusou-tlsn-verifier-canary/);
assert.match(canaryBootstrapWrangler, /bucket_name = "fusou-tlsn-verification-canary"/);
assert.match(testEnvironment, /bucket_name = "fusou-tlsn-verification-test"/);
assert.match(canaryEnvironment, /bucket_name = "fusou-tlsn-verification-canary"/);
assert.match(productionEnvironment, /bucket_name = "fusou-tlsn-verification-production"/);
assert.match(rootPackage.scripts["tlsn:deploy:evidence"], /^dotenvx run --strict --overload /);
assert.notEqual(canaryEnvironment.match(/^name = "([^"]+)"/m)?.[1], productionEnvironment.match(/^name = "([^"]+)"/m)?.[1]);

console.log("[tlsn-deployment-isolation] role input, key, provenance, and dotenvx deployment boundaries OK");
