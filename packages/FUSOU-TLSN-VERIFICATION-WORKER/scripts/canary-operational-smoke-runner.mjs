#!/usr/bin/env node

import { buildReadinessReport } from "./canary-readiness-test.mjs";
import { loadCanaryDeploymentManifest } from "./canary-deployment-manifest.mjs";
import { loadCanaryRuntimeAttestationKeyRegistry } from "./canary-runtime-attestation-key-registry.mjs";
import { runCanaryOperationalSmokeFromLiveEvidence } from "./canary-operational-smoke.mjs";

const REQUIRED_INPUTS = [
  "TLSN_CANARY_OPERATIONAL_SMOKE_PATH",
  "TLSN_CANARY_WORKER_INTERNAL_URL",
  "TLSN_CANARY_VERIFIER_WORKER_INTERNAL_URL",
  "TLSN_CANARY_DEPLOYMENT_MANIFEST",
  "TLSN_CANARY_DEPLOYMENT_ATTESTATION_PATH",
  "TLSN_CANARY_READINESS_INVOCATION_ID",
  "TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID",
  "TLSN_CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8",
];

function emit(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : result.status === "FAIL" ? 1 : 2;
}

async function main() {
  const missingInputs = REQUIRED_INPUTS.filter((name) => !process.env[name]?.trim());
  if (missingInputs.length > 0) {
    emit({
      status: "NOT_RUN",
      readiness: "BLOCKED",
      missing_inputs: missingInputs,
      reason: "Approved Canary live inputs are unavailable; no fixture fallback is permitted.",
    });
    return;
  }

  const { registry } = await loadCanaryRuntimeAttestationKeyRegistry();
  const environment = process.env;
  const readiness = await buildReadinessReport({ environment, runtimeAttestationKeyRegistry: registry });
  const trustedRuntimeIdentity = readiness.inputs.runtime_attestation;
  if (
    readiness.inputs.deployment_manifest.status !== "VALID" ||
    trustedRuntimeIdentity?.status !== "VALID" ||
    trustedRuntimeIdentity.signature_valid !== true ||
    trustedRuntimeIdentity.cross_binding?.status !== "PASS"
  ) {
    emit({
      status: "NOT_RUN",
      readiness: "BLOCKED",
      missing_inputs: [],
      reason: "Current Canary manifest and signed Runtime Attestation are not validated.",
    });
    return;
  }

  const deploymentManifest = await loadCanaryDeploymentManifest(environment.TLSN_CANARY_DEPLOYMENT_MANIFEST, {
    environment,
    currentHead: readiness.current_head,
  });
  const result = await runCanaryOperationalSmokeFromLiveEvidence({
    outputPath: environment.TLSN_CANARY_OPERATIONAL_SMOKE_PATH,
    mainWorkerOrigin: environment.TLSN_CANARY_WORKER_INTERNAL_URL,
    verifierOrigin: environment.TLSN_CANARY_VERIFIER_WORKER_INTERNAL_URL,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId: environment.TLSN_CANARY_READINESS_INVOCATION_ID,
    signerKeyId: environment.TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID,
    signingPrivateKeyPkcs8: environment.TLSN_CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8,
    runtimeAttestationKeyRegistry: registry,
  });
  emit(result);
}

main().catch(() => {
  emit({
    status: "FAIL",
    readiness: "BLOCKED",
    missing_inputs: [],
    reason: "Canary operational smoke runner validation or live probe failed; sensitive details were not emitted.",
  });
});