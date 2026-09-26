#!/usr/bin/env node

import assert from "node:assert/strict";
import { CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT } from "./canary-runtime-attestation-key-registry.mjs";
import {
  WORKER_SECRET_CAPABILITIES,
} from "./deployment-contract.mjs";
import {
  auditRuntimeSecretDependencies,
  loadRuntimeSources,
} from "./runtime-secret-dependency-audit.mjs";

const sources = await loadRuntimeSources();
const cloneDeep = structuredClone;

function expectAuditFailure(label, capabilities = WORKER_SECRET_CAPABILITIES, mutatedSources = sources) {
  assert.throws(
    () => auditRuntimeSecretDependencies({ sources: mutatedSources, capabilities }),
    undefined,
    `${label} must fail the runtime Secret dependency audit`,
  );
}

const missingCanaryCapability = cloneDeep(WORKER_SECRET_CAPABILITIES);
delete missingCanaryCapability.canary.main.directCallback;
expectAuditFailure("missing Canary main capability", missingCanaryCapability);

const missingRuntimeRead = {
  ...sources,
  "src/index.ts": sources["src/index.ts"].replaceAll("TLSN_TEST_AUTH_USERS", "TLSN_TEST_AUTH_USERS_REMOVED"),
};
expectAuditFailure("missing runtime read", WORKER_SECRET_CAPABILITIES, missingRuntimeRead);

const addedRuntimeRead = {
  ...sources,
  "src/index.ts": `${sources["src/index.ts"]}\nconst futureSecretProbe = (env: Bindings) => env.TLSN_FUTURE_CALLBACK_SECRET;\n`,
};
expectAuditFailure("undeclared runtime read", WORKER_SECRET_CAPABILITIES, addedRuntimeRead);

const crossModeCapability = cloneDeep(WORKER_SECRET_CAPABILITIES);
crossModeCapability.test.main.modes.trigger.queueCallback = cloneDeep(
  WORKER_SECRET_CAPABILITIES.test.main.modes.queue.queueCallback,
);
expectAuditFailure("cross-mode capability", crossModeCapability);

const crossWorkerCapability = cloneDeep(WORKER_SECRET_CAPABILITIES);
crossWorkerCapability.canary.verifier.triggerExecution = cloneDeep(
  WORKER_SECRET_CAPABILITIES.canary.main.triggerExecution,
);
expectAuditFailure("cross-Worker capability", crossWorkerCapability);

const deploymentOnlyKeyCapability = cloneDeep(WORKER_SECRET_CAPABILITIES);
deploymentOnlyKeyCapability.canary.main.attestationKey = {
  inputs: [CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT],
  runtimeReaders: ["readConfig"],
  runtimeConsumers: ["readConfig"],
  runtimeConsumerEvidence: { readConfig: "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8" },
};
expectAuditFailure("deployment-only attestation key capability", deploymentOnlyKeyCapability);

console.log("runtime Secret dependency mutation audit passed");