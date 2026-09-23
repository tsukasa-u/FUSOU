#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCanaryExternalPackage } from "./canary-external-package.mjs";
import {
  candidateManifestIdentity,
  checkCanaryExternalPackageCandidate,
  generateCanaryExternalPackageCandidate,
} from "./canary-external-package-candidate.mjs";
import { checkoutCommit } from "./deployment-attestation.mjs";

const currentHead = checkoutCommit("../..");

async function createCandidate(environment = {}) {
  const outputDirectory = await mkdtemp(join(tmpdir(), "tlsn-canary-candidate-test-"));
  const manifest = await generateCanaryExternalPackageCandidate({ environment, outputDirectory, currentHead });
  return { outputDirectory, manifest };
}

async function removeCandidate(outputDirectory) {
  await rm(outputDirectory, { recursive: true, force: true });
}

const first = await createCandidate();
const second = await createCandidate();
try {
  assert.equal(first.manifest.candidate_state, "CANDIDATE_INCOMPLETE");
  assert.equal(first.manifest.scope, "tlsn-canary-external-input-package-candidate");
  assert.equal(first.manifest.package_scope, "tlsn-canary-external-input-package");
  assert.equal(first.manifest.artifacts.length, 8);
  assert.equal(first.manifest.boundary.candidate_is_accepted_package, false);
  assert.equal(first.manifest.boundary.external_authority_approval, "NOT_PERFORMED");
  assert.equal(first.manifest.security.secret_exposure, "NONE");
  assert.deepEqual(first.manifest.identity, second.manifest.identity, "candidate identity must be deterministic");

  const initialReport = await checkCanaryExternalPackageCandidate({ outputDirectory: first.outputDirectory });
  assert.equal(initialReport.external_package_acceptance, "NOT_PERFORMED");
  assert.equal(initialReport.readiness, "BLOCKED");
  assert.equal(initialReport.deployment_executed, false);
  assert.equal(initialReport.runtime_executed, false);
  assert.equal(Object.keys(initialReport.artifact_identity_map).length, 8);

  const originalManifest = JSON.parse(await readFile(join(first.outputDirectory, "manifest.json"), "utf8"));
  const reorderedManifest = Object.fromEntries(Object.entries(originalManifest).reverse());
  await writeFile(join(first.outputDirectory, "manifest.json"), JSON.stringify(reorderedManifest, null, 4) + "\n");
  const reorderedReport = await checkCanaryExternalPackageCandidate({ outputDirectory: first.outputDirectory });
  assert.equal(reorderedReport.candidate_id, initialReport.candidate_id, "JSON formatting and key order must not change identity");

  await writeFile(join(first.outputDirectory, "artifacts/target-approval.json"), "tampered\n");
  await assert.rejects(
    () => checkCanaryExternalPackageCandidate({ outputDirectory: first.outputDirectory }),
    /candidate artifact hash does not match/,
  );
} finally {
  await removeCandidate(first.outputDirectory);
  await removeCandidate(second.outputDirectory);
}

const pathCandidate = await createCandidate();
try {
  const manifest = JSON.parse(await readFile(join(pathCandidate.outputDirectory, "manifest.json"), "utf8"));
  manifest.artifacts[0].path = "../manifest.json";
  manifest.identity = candidateManifestIdentity(manifest);
  await writeFile(join(pathCandidate.outputDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await assert.rejects(
    () => checkCanaryExternalPackageCandidate({ outputDirectory: pathCandidate.outputDirectory }),
    /escapes output directory/,
  );
} finally {
  await removeCandidate(pathCandidate.outputDirectory);
}

const secretValue = "candidate-test-secret-must-not-appear";
const secretCandidate = await createCandidate({
  TLSN_REMOTE_ACCESS_TOKEN_A: secretValue,
  TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL: "private-key-test-value",
  TLSN_CANARY_TRIGGER_CALLBACK_SECRET: "callback-secret-test-value",
});
try {
  const serialized = await readFile(join(secretCandidate.outputDirectory, "manifest.json"), "utf8");
  assert.doesNotMatch(serialized, /candidate-test-secret-must-not-appear|private-key-test-value|callback-secret-test-value/);
  const report = await checkCanaryExternalPackageCandidate({
    outputDirectory: secretCandidate.outputDirectory,
    environment: {
      TLSN_REMOTE_ACCESS_TOKEN_A: secretValue,
      TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL: "private-key-test-value",
      TLSN_CANARY_TRIGGER_CALLBACK_SECRET: "callback-secret-test-value",
    },
  });
  assert.equal(report.secret_exposure, "NONE");
} finally {
  await removeCandidate(secretCandidate.outputDirectory);
}

const acceptedBoundaryCandidate = await createCandidate();
try {
  await assert.rejects(
    () => assertCanaryExternalPackage(acceptedBoundaryCandidate.manifest, {
      packageRoot: acceptedBoundaryCandidate.outputDirectory,
      currentHead,
      environment: {},
    }),
    /schema|scope|secret value field/,
    "candidate must not enter the accepted package validator",
  );
} finally {
  await removeCandidate(acceptedBoundaryCandidate.outputDirectory);
}

await assert.rejects(
  () => createCandidate({ TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.test" }),
  /fixture, synthetic, or historical target identity/,
);

console.log("canary external package candidate tests passed");
