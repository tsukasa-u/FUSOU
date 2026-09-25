#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CANARY_INPUTS,
  CANARY_PUBLIC_INPUTS,
  CANARY_SECRET_INPUTS,
  CANARY_SENSITIVE_INPUTS,
  CANARY_WORKER_PUBLIC_INPUTS,
  CANARY_WORKER_SECRET_CONTRACT,
  EVIDENCE_WORKER_PUBLIC_INPUTS,
  EVIDENCE_WORKER_DECLARED_INPUTS,
  EVIDENCE_WORKER_SECRET_INPUTS,
  EVIDENCE_WORKER_SECRET_CONTRACT,
  EVIDENCE_WORKER_SENSITIVE_INPUTS,
  PRODUCTION_DECLARED_INPUTS,
  PRODUCTION_PUBLIC_INPUTS,
  PRODUCTION_SECRET_INPUTS,
  PRODUCTION_SENSITIVE_INPUTS,
  TEST_EXECUTION_MODES,
  TEST_WORKER_DECLARED_INPUTS,
  TEST_WORKER_PUBLIC_INPUTS,
  TEST_WORKER_SECRET_INPUTS,
  TEST_WORKER_SENSITIVE_INPUTS,
  TEST_WORKER_SECRET_CONTRACT,
  PRODUCTION_EVIDENCE_INPUTS,
  PRODUCTION_EVIDENCE_PUBLIC_INPUTS,
  PRODUCTION_EVIDENCE_SECRET_INPUTS,
  PRODUCTION_EVIDENCE_SENSITIVE_INPUTS,
  workerSecretBundleForEvidence,
  workerSecretBundleForCanary,
  workerSecretBundleForTest,
} from "./deployment-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const manifest = JSON.parse(await readFile(resolve(packageDirectory, "scripts/production-inputs.json"), "utf8"));
const deploySource = await readFile(resolve(packageDirectory, "scripts/deploy-canary.mjs"), "utf8");
const evidenceDeploySource = await readFile(resolve(packageDirectory, "scripts/deploy-evidence.mjs"), "utf8");
const testDeploySource = await readFile(resolve(packageDirectory, "scripts/deploy-test.mjs"), "utf8");
const runtimeSource = await readFile(resolve(packageDirectory, "src/index.ts"), "utf8");
const directVerifierSource = await readFile(resolve(packageDirectory, "src/direct_verifier.ts"), "utf8");

function assertPartition(label, categories, expected) {
  const flattened = categories.flat();
  assert.equal(new Set(flattened).size, flattened.length, `${label} categories must not overlap`);
  assert.deepEqual(new Set(flattened), new Set(expected), `${label} categories must cover exactly the contract`);
}

assertPartition(
  "Canary input",
  [
    CANARY_PUBLIC_INPUTS,
    CANARY_SENSITIVE_INPUTS,
    CANARY_SECRET_INPUTS.filter((name) => CANARY_INPUTS.includes(name)),
  ],
  CANARY_INPUTS,
);
assertPartition(
  "Production input",
  [PRODUCTION_PUBLIC_INPUTS, PRODUCTION_SENSITIVE_INPUTS, PRODUCTION_SECRET_INPUTS],
  PRODUCTION_DECLARED_INPUTS,
);
assertPartition(
  "Production Evidence input",
  [PRODUCTION_EVIDENCE_PUBLIC_INPUTS, PRODUCTION_EVIDENCE_SENSITIVE_INPUTS, PRODUCTION_EVIDENCE_SECRET_INPUTS],
  PRODUCTION_EVIDENCE_INPUTS,
);
assertPartition(
  "Evidence Worker input",
  [
    [...new Set(Object.values(EVIDENCE_WORKER_PUBLIC_INPUTS).flat())],
    [...new Set(Object.values(EVIDENCE_WORKER_SENSITIVE_INPUTS).flat())],
    EVIDENCE_WORKER_SECRET_INPUTS,
  ],
  EVIDENCE_WORKER_DECLARED_INPUTS,
);
assertPartition(
  "Test input",
  [
    [...new Set(Object.values(TEST_WORKER_PUBLIC_INPUTS).flat())],
    [...new Set(Object.values(TEST_WORKER_SENSITIVE_INPUTS).flat())],
    TEST_WORKER_SECRET_INPUTS,
  ],
  TEST_WORKER_DECLARED_INPUTS,
);

assert.deepEqual(manifest.canary_public_inputs, CANARY_PUBLIC_INPUTS);
assert.deepEqual(manifest.canary_sensitive_inputs, CANARY_SENSITIVE_INPUTS);
assert.deepEqual(manifest.canary_secret_inputs, CANARY_SECRET_INPUTS);
assert.deepEqual(manifest.production_evidence_public_inputs, PRODUCTION_EVIDENCE_PUBLIC_INPUTS);
assert.deepEqual(manifest.production_evidence_sensitive_inputs, PRODUCTION_EVIDENCE_SENSITIVE_INPUTS);
assert.deepEqual(manifest.production_evidence_secret_inputs, PRODUCTION_EVIDENCE_SECRET_INPUTS);

const dummyEnvironment = Object.fromEntries(
  CANARY_SECRET_INPUTS.map((name) => [name, `dummy-${name}`]),
);
for (const worker of ["bootstrap", "main", "verifier"]) {
  const bundle = workerSecretBundleForCanary(worker, dummyEnvironment);
  assert.deepEqual(Object.keys(bundle), CANARY_WORKER_SECRET_CONTRACT[worker]);
  for (const name of Object.keys(bundle)) {
    assert.ok(CANARY_SECRET_INPUTS.includes(name), `${worker} received undeclared secret ${name}`);
    assert.equal(PRODUCTION_EVIDENCE_SECRET_INPUTS.includes(name), false, `${worker} received evidence secret ${name}`);
    assert.notEqual(name, "TLSN_CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8");
    assert.notEqual(name, "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER");
  }
}

const evidenceDummyEnvironment = Object.fromEntries(
  [...new Set(Object.values(EVIDENCE_WORKER_SECRET_CONTRACT).flat())]
    .map((name) => [name, `dummy-${name}`]),
);
for (const worker of ["bootstrap", "main", "verifier"]) {
  const bundle = workerSecretBundleForEvidence(worker, evidenceDummyEnvironment);
  assert.deepEqual(Object.keys(bundle), EVIDENCE_WORKER_SECRET_CONTRACT[worker]);
  for (const name of Object.keys(bundle)) {
    assert.equal(name.startsWith("TLSN_PRODUCTION_EVIDENCE_"), false, `${worker} received Production Evidence secret ${name}`);
    assert.equal(name.startsWith("TLSN_CANARY_"), false, `${worker} received Canary secret ${name}`);
  }
}
assert.deepEqual(EVIDENCE_WORKER_SECRET_CONTRACT.bootstrap, []);
assert.deepEqual(EVIDENCE_WORKER_PUBLIC_INPUTS.bootstrap, []);
assert.deepEqual(EVIDENCE_WORKER_SENSITIVE_INPUTS.bootstrap, []);
assert.equal(EVIDENCE_WORKER_SECRET_CONTRACT.main.includes("TLSN_DIRECT_CALLBACK_SECRET"), true);
assert.equal(EVIDENCE_WORKER_SECRET_CONTRACT.verifier.includes("TLSN_DIRECT_CALLBACK_SECRET"), true);
assert.equal(EVIDENCE_WORKER_SECRET_CONTRACT.main.includes("TLSN_TEST_DIRECT_VERIFIER_MODE"), false);
assert.equal(EVIDENCE_WORKER_SECRET_CONTRACT.verifier.includes("TLSN_TEST_AUTH_USERS"), false);
assert.equal(EVIDENCE_WORKER_SECRET_CONTRACT.verifier.includes("TLSN_TEST_BINDING_VALUE"), false);
assert.equal(EVIDENCE_WORKER_PUBLIC_INPUTS.main.includes("TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS"), true);
assert.equal(EVIDENCE_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_TEST_DIRECT_VERIFIER_MODE"), true);
assert.equal(EVIDENCE_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_EXECUTION_MODE"), false);
assert.equal(EVIDENCE_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE"), false);
assert.equal(EVIDENCE_WORKER_PUBLIC_INPUTS.main.includes("TLSN_TRUST_ROOT_CERTIFICATE_DER"), true);
assert.equal(EVIDENCE_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_TRUST_ROOT_CERTIFICATE_DER"), true);
for (const name of [
  "TLSN_TEST_COMPLETION_DELAY_MS",
  "TLSN_TEST_COMPLETION_DELAY_ONCE",
  "TLSN_TEST_VERIFICATION_LEASE_MS",
  "TLSN_TEST_POST_RESULT_DELAY_MS",
  "TLSN_TEST_POST_RESULT_DELAY_ONCE",
  "TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS",
  "TLSN_TEST_DIRECT_VERIFIER_MODE",
  "TLSN_TEST_DIRECT_VERIFIER_DELAY_MS",
]) {
  assert.equal(EVIDENCE_WORKER_SECRET_CONTRACT.main.includes(name), false, `${name} must not be an Evidence secret`);
  assert.equal(EVIDENCE_WORKER_SECRET_CONTRACT.verifier.includes(name), false, `${name} must not be an Evidence secret`);
}

const testDummyEnvironment = Object.fromEntries(
  TEST_WORKER_SECRET_INPUTS.map((name) => [name, `dummy-${name}`]),
);
for (const mode of TEST_EXECUTION_MODES) {
  const mainBundle = workerSecretBundleForTest("main", testDummyEnvironment, mode);
  assert.deepEqual(Object.keys(mainBundle), TEST_WORKER_SECRET_CONTRACT.main[mode]);
  assert.equal(mainBundle.TLSN_TEST_BINDING_VALUE, undefined, `${mode} main received binding test data as a secret`);
  assert.equal(mainBundle.TLSN_TEST_BINDING_VALUES, undefined, `${mode} main received binding test data as a secret`);
  assert.equal(mainBundle.TLSN_TEST_COMPLETION_DELAY_MS, undefined, `${mode} main received timing config as a secret`);
  assert.equal(mainBundle.TLSN_TEST_AUTH_USERS !== undefined, true);
  assert.equal(mainBundle.TLSN_DIRECT_CALLBACK_SECRET !== undefined, mode === "direct");
  assert.equal(mainBundle.TLSN_TRIGGER_SECRET_KEY !== undefined, mode === "trigger");
  assert.equal(mainBundle.TLSN_TRIGGER_CALLBACK_SECRET !== undefined, mode === "trigger");
  assert.equal(mainBundle.TLSN_QUEUE_CALLBACK_SECRET !== undefined, mode === "queue");
  const verifierBundle = workerSecretBundleForTest("verifier", testDummyEnvironment, mode);
  if (mode === "direct") {
    assert.deepEqual(Object.keys(verifierBundle), TEST_WORKER_SECRET_CONTRACT.verifier.direct);
    assert.equal(verifierBundle.TLSN_DIRECT_CALLBACK_SECRET !== undefined, true);
  } else {
    assert.deepEqual(verifierBundle, {});
  }
}
assert.ok(TEST_WORKER_PUBLIC_INPUTS.main.includes("TLSN_TEST_BINDING_VALUE"));
assert.ok(TEST_WORKER_PUBLIC_INPUTS.main.includes("TLSN_TEST_COMPLETION_DELAY_MS"));
assert.ok(TEST_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_TEST_DIRECT_VERIFIER_MODE"));
assert.ok(TEST_WORKER_SENSITIVE_INPUTS.main.includes("TLSN_TEST_DEVICE_ID"));
assert.equal(TEST_WORKER_SECRET_INPUTS.includes("TLSN_TEST_BINDING_VALUE"), false);
assert.equal(TEST_WORKER_SECRET_INPUTS.includes("TLSN_TEST_COMPLETION_DELAY_MS"), false);
assert.equal(TEST_WORKER_SECRET_INPUTS.includes("TLSN_TEST_DIRECT_VERIFIER_MODE"), false);
assert.equal(TEST_WORKER_SECRET_CONTRACT.main.sync.includes("TLSN_TRIGGER_SECRET_KEY"), false);
assert.equal(TEST_WORKER_SECRET_CONTRACT.main.queue.includes("TLSN_TRIGGER_SECRET_KEY"), false);
assert.equal(TEST_WORKER_SECRET_CONTRACT.main.direct.includes("TLSN_QUEUE_CALLBACK_SECRET"), false);
assert.equal(TEST_WORKER_SECRET_CONTRACT.verifier.direct.includes("TLSN_TRIGGER_SECRET_KEY"), false);
assert.equal(TEST_WORKER_SECRET_CONTRACT.verifier.direct.includes("TLSN_QUEUE_CALLBACK_SECRET"), false);

assert.throws(
  () => workerSecretBundleForTest("main", testDummyEnvironment, "invalid"),
  /unsupported Test execution mode/,
);
assert.throws(
  () => workerSecretBundleForTest("main", {
    ...testDummyEnvironment,
    TLSN_TRIGGER_CALLBACK_SECRET: undefined,
  }, "trigger"),
  /missing Test Worker secret: TLSN_TRIGGER_CALLBACK_SECRET/,
);
assert.match(runtimeSource, /signSessionAuthorityReceipt/);
assert.match(runtimeSource, /signBindingAuthorityReceipt/);
assert.match(runtimeSource, /signResult/);
assert.match(runtimeSource, /triggerExecutionConfig/);
assert.match(runtimeSource, /queueCallbackSecret/);
assert.match(runtimeSource, /directCallbackSecret/);
assert.match(runtimeSource, /testBindingValueForRequest/);
assert.match(runtimeSource, /authenticateRequest/);
assert.match(directVerifierSource, /processVerificationCompletion/);
assert.match(directVerifierSource, /TLSN_DIRECT_CALLBACK_SECRET/);
assert.equal(TEST_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE"), false);
assert.ok(TEST_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_TEST_DIRECT_VERIFIER_MODE"));
assert.ok(TEST_WORKER_PUBLIC_INPUTS.main.includes("TLSN_TRUST_ROOT_CERTIFICATE_DER"));
assert.ok(TEST_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_TRUST_ROOT_CERTIFICATE_DER"));

assert.deepEqual(CANARY_WORKER_SECRET_CONTRACT.bootstrap, []);
assert.deepEqual(CANARY_WORKER_PUBLIC_INPUTS.bootstrap, []);
assert.ok(CANARY_WORKER_SECRET_CONTRACT.main.includes("TLSN_CANARY_BINDING_VALUE"));
assert.ok(CANARY_WORKER_SECRET_CONTRACT.verifier.includes("TLSN_CANARY_DIRECT_CALLBACK_SECRET"));
assert.equal(CANARY_WORKER_SECRET_CONTRACT.main.includes("TLSN_CANARY_DIRECT_CALLBACK_SECRET"), false);
assert.equal(CANARY_WORKER_SECRET_CONTRACT.verifier.includes("TLSN_CANARY_TRIGGER_SECRET_KEY"), false);
assert.equal(CANARY_WORKER_SECRET_CONTRACT.verifier.includes("TLSN_CANARY_TRIGGER_CALLBACK_SECRET"), false);
assert.ok(CANARY_WORKER_PUBLIC_INPUTS.main.includes("TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER"));
assert.ok(CANARY_WORKER_PUBLIC_INPUTS.verifier.includes("TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER"));
for (const worker of ["bootstrap", "main", "verifier"]) {
  for (const name of CANARY_WORKER_PUBLIC_INPUTS[worker]) {
    assert.equal(CANARY_SECRET_INPUTS.includes(name), false, `${worker} public vars include secret ${name}`);
    assert.equal(CANARY_SENSITIVE_INPUTS.includes(name), false, `${worker} public vars include sensitive input ${name}`);
  }
}

assert.doesNotMatch(deploySource, /const secretsPath =/);
assert.doesNotMatch(deploySource, /bootstrapDeployArguments\.push\("--secrets-file"/);
assert.match(deploySource, /mainSecretsPath/);
assert.match(deploySource, /verifierSecretsPath/);
assert.match(deploySource, /await rm\(secretDirectory, \{ recursive: true, force: true \}\)/);
assert.doesNotMatch(evidenceDeploySource, /const secretsPath =/);
assert.doesNotMatch(evidenceDeploySource, /bootstrapDeployArguments\.push\("--secrets-file"/);
assert.match(evidenceDeploySource, /mainSecretsPath/);
assert.match(evidenceDeploySource, /verifierSecretsPath/);
assert.match(evidenceDeploySource, /workerSecretBundleForEvidence/);
assert.doesNotMatch(testDeploySource, /const secretsPath =/);
assert.match(testDeploySource, /mainSecretsPath/);
assert.match(testDeploySource, /verifierSecretsPath/);
assert.match(testDeploySource, /workerSecretBundleForTest/);
assert.match(testDeploySource, /executionMode\)/);
assert.match(testDeploySource, /if \(directMode\)/);

console.log("[tlsn-secret-boundary-contract] input classification and Worker-specific secret delivery PASS");