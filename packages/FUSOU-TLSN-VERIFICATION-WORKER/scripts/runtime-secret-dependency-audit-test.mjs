#!/usr/bin/env node

import assert from "node:assert/strict";
import { CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT } from "./canary-runtime-attestation-key-registry.mjs";
import {
  WORKER_SECRET_CAPABILITIES,
} from "./deployment-contract.mjs";
import {
  auditRuntimeSecretDependencies,
  analyzeRuntimeSources,
  loadRuntimeSources,
} from "./runtime-secret-dependency-audit.mjs";

const sources = await loadRuntimeSources();
const cloneDeep = structuredClone;

function expectAuditFailure(
  label,
  capabilities = WORKER_SECRET_CAPABILITIES,
  mutatedSources = sources,
  messagePattern = /runtime Secret|runtime reader|runtime consumer|mode|bundle|deployment-side/,
) {
  assert.throws(
    () => auditRuntimeSecretDependencies({ sources: mutatedSources, capabilities }),
    messagePattern,
    `${label} must fail the runtime Secret dependency audit`,
  );
}

const missingCanaryCapability = cloneDeep(WORKER_SECRET_CAPABILITIES);
delete missingCanaryCapability.canary.main.directCallback;
expectAuditFailure("missing Canary main capability", missingCanaryCapability, sources, /runtime Secret read|bundle drifted/);

const missingRuntimeRead = {
  ...sources,
  "src/index.ts": sources["src/index.ts"].replaceAll("TLSN_TEST_AUTH_USERS", "TLSN_TEST_AUTH_USERS_REMOVED"),
};
expectAuditFailure("missing runtime read", WORKER_SECRET_CAPABILITIES, missingRuntimeRead, /runtime readers no longer read|runtime Secret read/);

const addedRuntimeRead = {
  ...sources,
  "src/index.ts": `${sources["src/index.ts"]}\nconst futureSecretProbe = (env: Bindings) => env.TLSN_FUTURE_CALLBACK_SECRET;\n`,
};
expectAuditFailure("undeclared runtime read", WORKER_SECRET_CAPABILITIES, addedRuntimeRead, /runtime Secret read/);

const aliasReadSources = {
  ...sources,
  "src/index.ts": `${sources["src/index.ts"]}\nconst aliasSecretProbe = (env: Bindings) => { const e = env; return e.TLSN_FUTURE_ALIAS_SECRET; };\n`,
};
expectAuditFailure("undeclared aliased runtime read", WORKER_SECRET_CAPABILITIES, aliasReadSources, /runtime Secret read/);

const destructuredReadSources = {
  ...sources,
  "src/index.ts": `${sources["src/index.ts"]}\nconst destructuredSecretProbe = (c: { env: Bindings }) => { const e = c.env; const { TLSN_FUTURE_DESTRUCTURED_SECRET } = e; return TLSN_FUTURE_DESTRUCTURED_SECRET; };\n`,
};
expectAuditFailure("undeclared destructured runtime read", WORKER_SECRET_CAPABILITIES, destructuredReadSources, /runtime Secret read/);

const knownAliasModel = analyzeRuntimeSources({
  ...sources,
  "src/index.ts": `${sources["src/index.ts"]}\nconst knownAliasProbe = (c: { env: Bindings }) => { const e = c.env; return e.TLSN_TEST_AUTH_USERS; };\n`,
});
assert.equal(
  knownAliasModel.reads.some((read) => read.name === "TLSN_TEST_AUTH_USERS" && read.functionName === "knownAliasProbe"),
  true,
  "known Secret reads through c.env aliases must be represented in the AST model",
);
const destructuredKnownAliasModel = analyzeRuntimeSources({
  ...sources,
  "src/index.ts": `${sources["src/index.ts"]}\nconst destructuredKnownAliasProbe = (env: Bindings) => { const { TLSN_TEST_AUTH_USERS } = env; return TLSN_TEST_AUTH_USERS; };\n`,
});
assert.equal(
  destructuredKnownAliasModel.reads.some((read) => read.name === "TLSN_TEST_AUTH_USERS" && read.functionName === "destructuredKnownAliasProbe"),
  true,
  "known Secret destructuring reads must be represented in the AST model",
);

const crossModeCapability = cloneDeep(WORKER_SECRET_CAPABILITIES);
crossModeCapability.test.main.modes.trigger.queueCallback = cloneDeep(
  WORKER_SECRET_CAPABILITIES.test.main.modes.queue.queueCallback,
);
expectAuditFailure("cross-mode capability", crossModeCapability, sources, /another execution mode/);

const crossWorkerCapability = cloneDeep(WORKER_SECRET_CAPABILITIES);
crossWorkerCapability.canary.verifier.triggerExecution = cloneDeep(
  WORKER_SECRET_CAPABILITIES.canary.main.triggerExecution,
);
expectAuditFailure("cross-Worker capability", crossWorkerCapability, sources, /bundle drifted/);

const readerMutation = cloneDeep(WORKER_SECRET_CAPABILITIES);
readerMutation.test.main.always.resultSigning.runtimeReaders = ["authenticateRequest"];
readerMutation.test.main.always.resultSigning.runtimeReaderConsumers = {
  authenticateRequest: [{
    input: "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
    kind: "config",
    sourceProperty: "resultSigningPrivateKeyPkcs8",
    property: "resultSigningPrivateKeyBytes",
    consumers: ["signResult", "signSparseResult"],
  }],
};
expectAuditFailure("wrong runtime reader declaration", readerMutation, sources, /runtime readers no longer read/);

const consumerSwap = cloneDeep(WORKER_SECRET_CAPABILITIES);
consumerSwap.test.main.always.resultSigning.runtimeConsumers = ["signBindingAuthorityReceipt", "signSparseResult"];
expectAuditFailure("wrong runtime consumer declaration", consumerSwap, sources, /consumer declarations must match evidence/);

const consumerRemoval = cloneDeep(WORKER_SECRET_CAPABILITIES);
consumerRemoval.test.main.always.resultSigning.runtimeConsumers = ["signSparseResult"];
expectAuditFailure("removed runtime consumer declaration", consumerRemoval, sources, /consumer declarations must match evidence/);

const resultSigningMovedToValidConsumer = cloneDeep(WORKER_SECRET_CAPABILITIES);
resultSigningMovedToValidConsumer.test.main.always.resultSigning.runtimeConsumers = ["signSessionAuthorityReceipt"];
resultSigningMovedToValidConsumer.test.main.always.resultSigning.runtimeConsumerEvidence = {
  signSessionAuthorityReceipt: "sessionAuthoritySigningPrivateKeyBytes",
};
resultSigningMovedToValidConsumer.test.main.always.resultSigning.runtimeReaderConsumers = {
  readConfig: [{
    input: "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
    kind: "config",
    sourceProperty: "sessionAuthoritySigningPrivateKeyPkcs8",
    property: "sessionAuthoritySigningPrivateKeyBytes",
    consumers: ["signSessionAuthorityReceipt"],
  }],
};
expectAuditFailure(
  "result signing capability moved to a valid Session Authority consumer",
  resultSigningMovedToValidConsumer,
  sources,
  /no Secret-to-consumer provenance/,
);

const resultSigningReaderKeptConsumerChanged = cloneDeep(WORKER_SECRET_CAPABILITIES);
resultSigningReaderKeptConsumerChanged.test.main.always.resultSigning.runtimeConsumers = ["processVerificationCompletion"];
resultSigningReaderKeptConsumerChanged.test.main.always.resultSigning.runtimeConsumerEvidence = {
  processVerificationCompletion: "verifyInternalRequest",
};
resultSigningReaderKeptConsumerChanged.test.main.always.resultSigning.runtimeReaderConsumers = {
  readConfig: [{
    input: "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
    kind: "call",
    value: "callbackSecret",
    downstream: "verifyInternalRequest",
    consumers: ["processVerificationCompletion"],
  }],
};
expectAuditFailure(
  "result signing reader kept while callback consumer is substituted",
  resultSigningReaderKeptConsumerChanged,
  sources,
  /no Secret-to-consumer provenance/,
);

const resultSigningPropertyMoved = cloneDeep(WORKER_SECRET_CAPABILITIES);
resultSigningPropertyMoved.test.main.always.resultSigning.runtimeReaderConsumers = {
  readConfig: [{
    input: "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
    kind: "config",
    sourceProperty: "sessionAuthoritySigningPrivateKeyPkcs8",
    property: "sessionAuthoritySigningPrivateKeyBytes",
    consumers: ["signResult", "signSparseResult"],
  }],
};
expectAuditFailure(
  "result signing Secret mapped to Session Authority config property",
  resultSigningPropertyMoved,
  sources,
  /no Secret-to-consumer provenance/,
);

const resultReaderReturnDisconnected = {
  ...sources,
  "src/index.ts": sources["src/index.ts"].replace(
    "const config = await readConfig(\n",
    "const config = await readConfigFromAlternate(\n",
  ),
};
expectAuditFailure(
  "result reader return disconnected from completeVerification config",
  WORKER_SECRET_CAPABILITIES,
  resultReaderReturnDisconnected,
  /no reader return binding/,
);

const resultConsumerArgumentChanged = {
  ...sources,
  "src/index.ts": sources["src/index.ts"].replace(
    "signResult(config, signingBytes)",
    "signResult(otherConfig, signingBytes)",
  ),
};
expectAuditFailure(
  "result consumer receives a different config argument",
  WORKER_SECRET_CAPABILITIES,
  resultConsumerArgumentChanged,
  /no reader return binding/,
);

const triggerReturnDisconnected = {
  ...sources,
  "src/index.ts": sources["src/index.ts"].replace(
    "const trigger = useTriggerExecution ? triggerExecutionConfig(c.env) : null;",
    "const trigger = useTriggerExecution ? alternateTriggerExecutionConfig(c.env) : null;",
  ),
};
expectAuditFailure(
  "trigger reader return disconnected from trigger local",
  WORKER_SECRET_CAPABILITIES,
  triggerReturnDisconnected,
  /no reader return binding/,
);

const triggerConsumerArgumentChanged = {
  ...sources,
  "src/index.ts": sources["src/index.ts"].replace(
    "enqueueTriggerVerification(trigger, payload)",
    "enqueueTriggerVerification(otherTrigger, payload)",
  ),
};
expectAuditFailure(
  "trigger consumer receives a different local object",
  WORKER_SECRET_CAPABILITIES,
  triggerConsumerArgumentChanged,
  /no reader return binding/,
);

const directVerifierReaderMoved = {
  ...sources,
  "src/direct_verifier.ts": sources["src/direct_verifier.ts"].replace(
    "directCallbackSecret(c.env)",
    "queueCallbackSecret(c.env)",
  ),
};
expectAuditFailure(
  "direct verifier callback reader moved to another Secret helper",
  WORKER_SECRET_CAPABILITIES,
  directVerifierReaderMoved,
  /direct verifier must preserve directCallbackSecret/,
);

const deploymentOnlyKeyCapability = cloneDeep(WORKER_SECRET_CAPABILITIES);
deploymentOnlyKeyCapability.canary.main.attestationKey = {
  inputs: [CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT],
  runtimeReaders: ["readConfig"],
  runtimeConsumers: ["readConfig"],
  runtimeConsumerEvidence: { readConfig: "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8" },
};
expectAuditFailure("deployment-only attestation key capability", deploymentOnlyKeyCapability, sources, /deployment-side only/);

console.log("runtime Secret dependency mutation audit passed");