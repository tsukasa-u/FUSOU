import { PROFILE_CONTRACT_INPUT_MANIFEST } from "./profile-canonical-contract.mjs";
import { SECURITY_REGISTRY_SET_CONTRACT } from "./security-registry-set-contract.mjs";
import {
  CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID_INPUT,
  CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT,
} from "./canary-runtime-attestation-key-registry.mjs";

export const COMMON_INPUTS = [
  "TLSN_ENVIRONMENT",
  "TLSN_DEPLOYMENT_ROLE",
  "TLSN_BINDING_TTL_SECONDS",
  "TLSN_GIT_COMMIT_SHA",
  "TLSN_CANDIDATE_SERVER_IDENTITY",
  "TLSN_CANDIDATE_PROFILE_SHA256",
  "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
  "TLSN_CANDIDATE_VERIFIER_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_ENDPOINT",
  "TLSN_PRODUCTION_NOTARY_REGISTRY",
  "TLSN_CANDIDATE_DEVICE_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS",
  "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS",
  "TLSN_CANDIDATE_SUPABASE_URL",
  "TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_SECURITY_REGISTRY_SET_SHA256",
];

export const WORKFLOW_EVIDENCE_INPUTS = [
  "TLSN_WORKFLOW_RUN_ID",
  "TLSN_WORKFLOW_RUN_ATTEMPT",
  "TLSN_REPOSITORY",
  "TLSN_WORKFLOW_FILE_IDENTITY",
];

export const PRODUCTION_GATE_INPUTS = [
  "TLSN_ATTESTATION_SIGNER_KEY_ID",
  "TLSN_ATTESTATION_SIGNER_PUBLIC_KEY_SPKI",
  "TLSN_MAX_ATTESTATION_AGE_SECONDS",
];

export const CANARY_INPUTS = [
  CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID_INPUT,
  "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID",
  "TLSN_CANARY_DEPLOYMENT_ID",
  "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_RESULT_SIGNER_KEY_ID",
  "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY",
  "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
  "TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID",
  "TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_SESSION_AUTHORITY_KEY_ID",
  "TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
  "TLSN_CANARY_BINDING_IDENTITY",
  "TLSN_CANARY_WORKER_NAME",
  "TLSN_CANARY_TRIGGER_API_URL",
  "TLSN_CANARY_TRIGGER_TASK_ID",
  "TLSN_CANARY_WORKER_INTERNAL_URL",
  "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
  "TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED",
  "TLSN_CANARY_FIXTURE_ONLY",
  "TLSN_BENCHMARK_TIMINGS",
];

export const PRODUCTION_INPUTS = [
  "TLSN_PRODUCTION_DEPLOYMENT_ID",
  "TLSN_PRODUCTION_NOTARY_ENDPOINT",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_ENDPOINT",
  "TLSN_PRODUCTION_VERIFICATION_ENDPOINT",
  "TLSN_PRODUCTION_ORIGIN_PORT",
  "TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID",
  "TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY",
  "TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
  "TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID",
  "TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY",
  "TLSN_PRODUCTION_WORKER_NAME",
  "TLSN_PRODUCTION_TRIGGER_API_URL",
  "TLSN_PRODUCTION_TRIGGER_TASK_ID",
  "TLSN_PRODUCTION_WORKER_INTERNAL_URL",
  "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER",
];

export const PRODUCTION_EVIDENCE_INPUTS = [
  "TLSN_PRODUCTION_NOTARY_REGISTRY",
  "TLSN_PRODUCTION_EVIDENCE_OUTPUT_PATH",
  "TLSN_PRODUCTION_EVIDENCE_WORKER_URL",
  "TLSN_PRODUCTION_EVIDENCE_WEB_ORIGIN",
  "TLSN_PRODUCTION_EVIDENCE_SUPABASE_URL",
  "TLSN_PRODUCTION_EVIDENCE_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_PRODUCTION_EVIDENCE_ACCESS_TOKEN",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_ID",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_B64URL",
  "TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH",
  "TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON",
  "TLSN_PRODUCTION_PROXY_PROVENANCE_PIN_JSON",
  "TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8_B64URL",
  "TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID",
  "TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH",
  "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER",
];

export const CANARY_SENSITIVE_INPUTS = [
  CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID_INPUT,
  "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID",
  "TLSN_CANARY_BINDING_IDENTITY",
  "TLSN_CANARY_WORKER_INTERNAL_URL",
];

export const CANARY_SECRET_INPUTS = [
  CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT,
  "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_BINDING_VALUE",
  "TLSN_CANARY_TRIGGER_SECRET_KEY",
  "TLSN_CANARY_TRIGGER_CALLBACK_SECRET",
  "TLSN_CANARY_DIRECT_CALLBACK_SECRET",
];

export const CANARY_PUBLIC_INPUTS = CANARY_INPUTS.filter(
  (name) => !CANARY_SENSITIVE_INPUTS.includes(name) && !CANARY_SECRET_INPUTS.includes(name),
);

export const PRODUCTION_SECRET_INPUTS = [
  "TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_TRIGGER_SECRET_KEY",
  "TLSN_PRODUCTION_TRIGGER_CALLBACK_SECRET",
];

export const PRODUCTION_SENSITIVE_INPUTS = [
  "TLSN_PRODUCTION_DEPLOYMENT_ID",
  "TLSN_PRODUCTION_ORIGIN_PORT",
  "TLSN_PRODUCTION_WORKER_NAME",
  "TLSN_PRODUCTION_WORKER_INTERNAL_URL",
];

export const PRODUCTION_PUBLIC_INPUTS = PRODUCTION_INPUTS.filter(
  (name) => !PRODUCTION_SENSITIVE_INPUTS.includes(name),
);

export const PRODUCTION_DECLARED_INPUTS = [
  ...PRODUCTION_INPUTS,
  ...PRODUCTION_SECRET_INPUTS,
];

export const PRODUCTION_EVIDENCE_PUBLIC_INPUTS = [
  "TLSN_PRODUCTION_NOTARY_REGISTRY",
  "TLSN_PRODUCTION_EVIDENCE_WORKER_URL",
  "TLSN_PRODUCTION_EVIDENCE_WEB_ORIGIN",
  "TLSN_PRODUCTION_EVIDENCE_SUPABASE_URL",
  "TLSN_PRODUCTION_EVIDENCE_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_PRODUCTION_PROXY_PROVENANCE_PIN_JSON",
  "TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID",
  "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER",
];

export const PRODUCTION_EVIDENCE_SENSITIVE_INPUTS = [
  "TLSN_PRODUCTION_EVIDENCE_OUTPUT_PATH",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_ID",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH",
  "TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON",
  "TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH",
];

export const PRODUCTION_EVIDENCE_SECRET_INPUTS = [
  "TLSN_PRODUCTION_EVIDENCE_ACCESS_TOKEN",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_B64URL",
  "TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8_B64URL",
];

export const CANARY_WORKER_PUBLIC_INPUTS = {
  bootstrap: [],
  main: [
    ...COMMON_INPUTS,
    "TLSN_CANARY_DEPLOYMENT_ID",
    "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_RESULT_SIGNER_KEY_ID",
    "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY",
    "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
    "TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID",
    "TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_SESSION_AUTHORITY_KEY_ID",
    "TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY",
    "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
    "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
    "TLSN_CANARY_WORKER_NAME",
    "TLSN_CANARY_TRIGGER_API_URL",
    "TLSN_CANARY_TRIGGER_TASK_ID",
    "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
    "TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED",
    "TLSN_CANARY_FIXTURE_ONLY",
    "TLSN_BENCHMARK_TIMINGS",
  ],
  verifier: [
    ...COMMON_INPUTS,
    "TLSN_CANARY_DEPLOYMENT_ID",
    "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_RESULT_SIGNER_KEY_ID",
    "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY",
    "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
    "TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID",
    "TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_SESSION_AUTHORITY_KEY_ID",
    "TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY",
    "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
    "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
    "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
    "TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED",
    "TLSN_CANARY_FIXTURE_ONLY",
    "TLSN_BENCHMARK_TIMINGS",
  ],
};

export const EVIDENCE_WORKER_PUBLIC_INPUTS = {
  bootstrap: [],
  main: [
    "TLSN_ENVIRONMENT",
    "TLSN_DEPLOYMENT_ROLE",
    "TLSN_GIT_COMMIT_SHA",
    "TLSN_BINDING_TTL_SECONDS",
    "TLSN_SERVER_IDENTITY",
    "TLSN_PROFILE_SHA256",
    "TLSN_SPARSE_PROFILE_SHA256",
    "TLSN_VERIFIER_KEY_ID",
    "TLSN_NOTARY_KEY_ID",
    "TLSN_NOTARY_REGISTRY",
    "TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_SESSION_AUTHORITY_KEY_ID",
    "TLSN_SESSION_AUTHORITY_KEY_REGISTRY",
    "TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_BINDING_AUTHORITY_KEY_ID",
    "TLSN_BINDING_AUTHORITY_KEY_REGISTRY",
    "TLSN_DEVICE_AUTH_URL",
    "TLSN_DEVICE_POSSESSION_AUTH_URL",
    "TLSN_TEST_BINDING_VALUE",
    "TLSN_TEST_BINDING_VALUES",
    "TLSN_SUPABASE_URL",
    "TLSN_SUPABASE_PUBLISHABLE_KEY",
    "TLSN_EXECUTION_MODE",
    "TLSN_TRIGGER_API_URL",
    "TLSN_TRIGGER_TASK_ID",
    "TLSN_BENCHMARK_TIMINGS",
    "TLSN_TEST_COMPLETION_DELAY_MS",
    "TLSN_TEST_COMPLETION_DELAY_ONCE",
    "TLSN_TEST_VERIFICATION_LEASE_MS",
    "TLSN_TEST_POST_RESULT_DELAY_MS",
    "TLSN_TEST_POST_RESULT_DELAY_ONCE",
    "TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS",
    "TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE",
    "TLSN_RESULT_PUBLIC_KEY_SPKI",
    "TLSN_RESULT_SIGNER_KEY_ID",
    "TLSN_RESULT_SIGNING_KEY_REGISTRY",
    "TLSN_TRUST_ROOT_CERTIFICATE_DER",
  ],
  verifier: [
    "TLSN_ENVIRONMENT",
    "TLSN_DEPLOYMENT_ROLE",
    "TLSN_GIT_COMMIT_SHA",
    "TLSN_BINDING_TTL_SECONDS",
    "TLSN_SERVER_IDENTITY",
    "TLSN_PROFILE_SHA256",
    "TLSN_SPARSE_PROFILE_SHA256",
    "TLSN_VERIFIER_KEY_ID",
    "TLSN_NOTARY_KEY_ID",
    "TLSN_NOTARY_REGISTRY",
    "TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_SESSION_AUTHORITY_KEY_ID",
    "TLSN_SESSION_AUTHORITY_KEY_REGISTRY",
    "TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_BINDING_AUTHORITY_KEY_ID",
    "TLSN_BINDING_AUTHORITY_KEY_REGISTRY",
    "TLSN_BENCHMARK_TIMINGS",
    "TLSN_TEST_COMPLETION_DELAY_MS",
    "TLSN_TEST_COMPLETION_DELAY_ONCE",
    "TLSN_TEST_VERIFICATION_LEASE_MS",
    "TLSN_TEST_POST_RESULT_DELAY_MS",
    "TLSN_TEST_POST_RESULT_DELAY_ONCE",
    "TLSN_TEST_DIRECT_VERIFIER_MODE",
    "TLSN_TEST_DIRECT_VERIFIER_DELAY_MS",
    "TLSN_RESULT_PUBLIC_KEY_SPKI",
    "TLSN_RESULT_SIGNER_KEY_ID",
    "TLSN_RESULT_SIGNING_KEY_REGISTRY",
    "TLSN_TRUST_ROOT_CERTIFICATE_DER",
  ],
};

export const EVIDENCE_WORKER_SENSITIVE_INPUTS = {
  bootstrap: [],
  main: ["TLSN_TEST_DEVICE_ID", "TLSN_TEST_DEVICE_PUBLIC_KEY"],
  verifier: [],
};

export const TEST_WORKER_SENSITIVE_INPUTS = {
  main: ["TLSN_TEST_WORKER_NAME", "TLSN_TEST_DEVICE_ID", "TLSN_TEST_DEVICE_PUBLIC_KEY"],
  verifier: [],
};

const TEST_PUBLIC_CONFIGURATION_INPUTS = [
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_TEST_BINDING_VALUES",
  "TLSN_TEST_COMPLETION_DELAY_MS",
  "TLSN_TEST_COMPLETION_DELAY_ONCE",
  "TLSN_TEST_VERIFICATION_LEASE_MS",
  "TLSN_TEST_POST_RESULT_DELAY_MS",
  "TLSN_TEST_POST_RESULT_DELAY_ONCE",
  "TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS",
  "TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE",
];

export const TEST_WORKER_PUBLIC_INPUTS = {
  main: [
    "TLSN_ENVIRONMENT",
    "TLSN_GIT_COMMIT_SHA",
    "TLSN_BINDING_TTL_SECONDS",
    "TLSN_SERVER_IDENTITY",
    "TLSN_PROFILE_SHA256",
    "TLSN_SPARSE_PROFILE_SHA256",
    "TLSN_VERIFIER_KEY_ID",
    "TLSN_NOTARY_KEY_ID",
    "TLSN_NOTARY_REGISTRY",
    "TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_SESSION_AUTHORITY_KEY_ID",
    "TLSN_SESSION_AUTHORITY_KEY_REGISTRY",
    "TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_BINDING_AUTHORITY_KEY_ID",
    "TLSN_BINDING_AUTHORITY_KEY_REGISTRY",
    "TLSN_DEVICE_AUTH_URL",
    "TLSN_DEVICE_POSSESSION_AUTH_URL",
    "TLSN_SUPABASE_URL",
    "TLSN_SUPABASE_PUBLISHABLE_KEY",
    "TLSN_EXECUTION_MODE",
    "TLSN_TRIGGER_API_URL",
    "TLSN_TRIGGER_TASK_ID",
    "TLSN_BENCHMARK_TIMINGS",
    "TLSN_RESULT_PUBLIC_KEY_SPKI",
    "TLSN_RESULT_SIGNER_KEY_ID",
    "TLSN_RESULT_SIGNING_KEY_REGISTRY",
    "TLSN_TRUST_ROOT_CERTIFICATE_DER",
    ...TEST_PUBLIC_CONFIGURATION_INPUTS,
  ],
  verifier: [
    "TLSN_ENVIRONMENT",
    "TLSN_GIT_COMMIT_SHA",
    "TLSN_BINDING_TTL_SECONDS",
    "TLSN_SERVER_IDENTITY",
    "TLSN_PROFILE_SHA256",
    "TLSN_SPARSE_PROFILE_SHA256",
    "TLSN_VERIFIER_KEY_ID",
    "TLSN_NOTARY_KEY_ID",
    "TLSN_NOTARY_REGISTRY",
    "TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_SESSION_AUTHORITY_KEY_ID",
    "TLSN_SESSION_AUTHORITY_KEY_REGISTRY",
    "TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_BINDING_AUTHORITY_KEY_ID",
    "TLSN_BINDING_AUTHORITY_KEY_REGISTRY",
    "TLSN_BENCHMARK_TIMINGS",
    "TLSN_TEST_COMPLETION_DELAY_MS",
    "TLSN_TEST_COMPLETION_DELAY_ONCE",
    "TLSN_TEST_VERIFICATION_LEASE_MS",
    "TLSN_TEST_POST_RESULT_DELAY_MS",
    "TLSN_TEST_POST_RESULT_DELAY_ONCE",
    "TLSN_TEST_DIRECT_VERIFIER_MODE",
    "TLSN_TEST_DIRECT_VERIFIER_DELAY_MS",
    "TLSN_RESULT_PUBLIC_KEY_SPKI",
    "TLSN_RESULT_SIGNER_KEY_ID",
    "TLSN_RESULT_SIGNING_KEY_REGISTRY",
    "TLSN_TRUST_ROOT_CERTIFICATE_DER",
  ],
};

const REQUIRED_SIGNING_SECRETS = [
  "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
];

const GENERIC_WORKER_SECRET_INPUTS = [
  ...REQUIRED_SIGNING_SECRETS,
  "TLSN_TEST_AUTH_USERS",
  "TLSN_TRIGGER_SECRET_KEY",
  "TLSN_TRIGGER_CALLBACK_SECRET",
  "TLSN_QUEUE_CALLBACK_SECRET",
  "TLSN_DIRECT_CALLBACK_SECRET",
];

function uniqueInputNames(names) {
  return [...new Set(names)];
}

function configPropertyForEvidence(evidence) {
  return typeof evidence === "string" && evidence.endsWith("PrivateKeyBytes")
    ? evidence
    : null;
}

function sourcePropertyForConfigProperty(property) {
  return property?.replace(/PrivateKeyBytes$/, "PrivateKeyPkcs8") ?? null;
}

function structuredRuntimeReaderConsumers(inputs, runtimeReaders, runtimeConsumers, runtimeConsumerEvidence) {
  if (inputs.length !== 1) {
    throw new Error("runtime Secret capability provenance requires exactly one Secret input per descriptor");
  }
  return Object.fromEntries(runtimeReaders.map((reader) => [reader, runtimeConsumers.flatMap((consumer) => {
    const evidence = runtimeConsumerEvidence[consumer];
    const configProperty = configPropertyForEvidence(evidence);
    if (configProperty && reader === "readConfig") {
      return [{
        input: inputs[0],
        kind: "config",
        sourceProperty: sourcePropertyForConfigProperty(configProperty),
        property: configProperty,
        consumers: [consumer],
      }];
    }
    if (reader === "triggerExecutionConfig") {
      return [{ input: inputs[0], kind: "value", value: "secretKey", property: "secretKey", consumers: [consumer] }];
    }
    if (["triggerCallbackSecret", "queueCallbackSecret", "directCallbackSecret"].includes(reader)) {
      return [{ input: inputs[0], kind: "call", value: "callbackSecret", downstream: evidence, consumers: [consumer] }];
    }
    return [{ input: inputs[0], kind: "direct", value: evidence, consumers: [consumer] }];
  })]));
}

function runtimeCapability(
  inputs,
  runtimeReaders,
  runtimeConsumers,
  runtimeConsumerEvidence = {},
) {
  return {
    inputs: uniqueInputNames(inputs),
    runtimeReaders,
    runtimeConsumers,
    runtimeConsumerEvidence,
    runtimeReaderConsumers: structuredRuntimeReaderConsumers(inputs, runtimeReaders, runtimeConsumers, runtimeConsumerEvidence),
  };
}

export const WORKER_DECLARED_SECRET_INPUTS = uniqueInputNames([
  ...GENERIC_WORKER_SECRET_INPUTS,
  ...CANARY_SECRET_INPUTS.filter((name) => name !== CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT),
  ...PRODUCTION_SECRET_INPUTS,
]);

export const RUNTIME_SYNTHETIC_CONFIGURATION_INPUTS = [
  "TLSN_REPLAY_AUTH_USERS",
];

export const WORKER_SECRET_CAPABILITIES = {
  canary: {
    bootstrap: {},
    main: {
      resultSigning: runtimeCapability(
        ["TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signResult", "signSparseResult"],
        { signResult: "resultSigningPrivateKeyBytes", signSparseResult: "resultSigningPrivateKeyBytes" },
      ),
      sessionAuthoritySigning: runtimeCapability(
        ["TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signSessionAuthorityReceipt"],
        { signSessionAuthorityReceipt: "sessionAuthoritySigningPrivateKeyBytes" },
      ),
      bindingAuthoritySigning: runtimeCapability(
        ["TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signBindingAuthorityReceipt"],
        { signBindingAuthorityReceipt: "bindingAuthoritySigningPrivateKeyBytes" },
      ),
      bindingAuthorization: runtimeCapability(
        ["TLSN_CANARY_BINDING_VALUE"],
        ["readConfig", "canaryBindingValue"],
        ["readConfig", "canaryBindingValue"],
        {
          readConfig: "TLSN_CANARY_BINDING_VALUE",
          canaryBindingValue: "TLSN_CANARY_BINDING_VALUE",
        },
        {
          readConfig: ["readConfig"],
          canaryBindingValue: ["canaryBindingValue"],
        },
      ),
      triggerExecution: runtimeCapability(
        ["TLSN_CANARY_TRIGGER_SECRET_KEY"],
        ["triggerExecutionConfig"],
        ["enqueueTriggerVerification"],
        { enqueueTriggerVerification: "config.secretKey" },
      ),
      triggerCallback: runtimeCapability(
        ["TLSN_CANARY_TRIGGER_CALLBACK_SECRET"],
        ["triggerCallbackSecret"],
        ["processVerificationCompletion"],
        { processVerificationCompletion: "verifyInternalRequest" },
      ),
      directCallback: runtimeCapability(
        ["TLSN_CANARY_DIRECT_CALLBACK_SECRET"],
        ["directCallbackSecret"],
        ["dispatchDirectVerification", "processVerificationCompletion"],
        { dispatchDirectVerification: "internalRequestSignature", processVerificationCompletion: "verifyInternalRequest" },
      ),
    },
    verifier: {
      resultSigning: runtimeCapability(
        ["TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signResult", "signSparseResult"],
        { signResult: "resultSigningPrivateKeyBytes", signSparseResult: "resultSigningPrivateKeyBytes" },
      ),
      sessionAuthoritySigning: runtimeCapability(
        ["TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signSessionAuthorityReceipt"],
        { signSessionAuthorityReceipt: "sessionAuthoritySigningPrivateKeyBytes" },
      ),
      bindingAuthoritySigning: runtimeCapability(
        ["TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signBindingAuthorityReceipt"],
        { signBindingAuthorityReceipt: "bindingAuthoritySigningPrivateKeyBytes" },
      ),
      bindingAuthorization: runtimeCapability(
        ["TLSN_CANARY_BINDING_VALUE"],
        ["readConfig", "canaryBindingValue"],
        ["readConfig", "canaryBindingValue"],
        {
          readConfig: "TLSN_CANARY_BINDING_VALUE",
          canaryBindingValue: "TLSN_CANARY_BINDING_VALUE",
        },
        {
          readConfig: ["readConfig"],
          canaryBindingValue: ["canaryBindingValue"],
        },
      ),
      directCallback: runtimeCapability(
        ["TLSN_CANARY_DIRECT_CALLBACK_SECRET"],
        ["directCallbackSecret"],
        ["processVerificationCompletion"],
        { processVerificationCompletion: "verifyInternalRequest" },
      ),
    },
  },
  evidence: {
    bootstrap: {},
    main: {
      resultSigning: runtimeCapability(
        REQUIRED_SIGNING_SECRETS.slice(0, 1),
        ["readConfig"],
        ["signResult", "signSparseResult"],
        { signResult: "resultSigningPrivateKeyBytes", signSparseResult: "resultSigningPrivateKeyBytes" },
      ),
      sessionAuthoritySigning: runtimeCapability(
        REQUIRED_SIGNING_SECRETS.slice(1, 2),
        ["readConfig"],
        ["signSessionAuthorityReceipt"],
        { signSessionAuthorityReceipt: "sessionAuthoritySigningPrivateKeyBytes" },
      ),
      bindingAuthoritySigning: runtimeCapability(
        REQUIRED_SIGNING_SECRETS.slice(2, 3),
        ["readConfig"],
        ["signBindingAuthorityReceipt"],
        { signBindingAuthorityReceipt: "bindingAuthoritySigningPrivateKeyBytes" },
      ),
      directCallback: runtimeCapability(
        ["TLSN_DIRECT_CALLBACK_SECRET"],
        ["directCallbackSecret"],
        ["dispatchDirectVerification", "processVerificationCompletion"],
        { dispatchDirectVerification: "internalRequestSignature", processVerificationCompletion: "verifyInternalRequest" },
      ),
      syntheticAuthentication: runtimeCapability(
        ["TLSN_TEST_AUTH_USERS"],
        ["readConfig", "authenticateRequest", "syntheticAuthConfigured"],
        ["readConfig", "authenticateRequest", "syntheticAuthConfigured"],
        {
          readConfig: "TLSN_TEST_AUTH_USERS",
          authenticateRequest: "syntheticAuthUsers",
          syntheticAuthConfigured: "TLSN_TEST_AUTH_USERS",
        },
        {
          readConfig: ["readConfig"],
          authenticateRequest: ["authenticateRequest"],
          syntheticAuthConfigured: ["syntheticAuthConfigured"],
        },
      ),
    },
    verifier: {
      resultSigning: runtimeCapability(
        REQUIRED_SIGNING_SECRETS.slice(0, 1),
        ["readConfig"],
        ["signResult", "signSparseResult"],
        { signResult: "resultSigningPrivateKeyBytes", signSparseResult: "resultSigningPrivateKeyBytes" },
      ),
      sessionAuthoritySigning: runtimeCapability(
        REQUIRED_SIGNING_SECRETS.slice(1, 2),
        ["readConfig"],
        ["signSessionAuthorityReceipt"],
        { signSessionAuthorityReceipt: "sessionAuthoritySigningPrivateKeyBytes" },
      ),
      bindingAuthoritySigning: runtimeCapability(
        REQUIRED_SIGNING_SECRETS.slice(2, 3),
        ["readConfig"],
        ["signBindingAuthorityReceipt"],
        { signBindingAuthorityReceipt: "bindingAuthoritySigningPrivateKeyBytes" },
      ),
      directCallback: runtimeCapability(
        ["TLSN_DIRECT_CALLBACK_SECRET"],
        ["directCallbackSecret"],
        ["processVerificationCompletion"],
        { processVerificationCompletion: "verifyInternalRequest" },
      ),
    },
  },
  test: {
    main: {
      always: {
        resultSigning: runtimeCapability(
          REQUIRED_SIGNING_SECRETS.slice(0, 1),
          ["readConfig"],
          ["signResult", "signSparseResult"],
          { signResult: "resultSigningPrivateKeyBytes", signSparseResult: "resultSigningPrivateKeyBytes" },
        ),
        sessionAuthoritySigning: runtimeCapability(
          REQUIRED_SIGNING_SECRETS.slice(1, 2),
          ["readConfig"],
          ["signSessionAuthorityReceipt"],
          { signSessionAuthorityReceipt: "sessionAuthoritySigningPrivateKeyBytes" },
        ),
        bindingAuthoritySigning: runtimeCapability(
          REQUIRED_SIGNING_SECRETS.slice(2, 3),
          ["readConfig"],
          ["signBindingAuthorityReceipt"],
          { signBindingAuthorityReceipt: "bindingAuthoritySigningPrivateKeyBytes" },
        ),
        syntheticAuthentication: runtimeCapability(
          ["TLSN_TEST_AUTH_USERS"],
          ["readConfig", "authenticateRequest", "syntheticAuthConfigured"],
          ["readConfig", "authenticateRequest", "syntheticAuthConfigured"],
          {
            readConfig: "TLSN_TEST_AUTH_USERS",
            authenticateRequest: "syntheticAuthUsers",
            syntheticAuthConfigured: "TLSN_TEST_AUTH_USERS",
          },
          {
            readConfig: ["readConfig"],
            authenticateRequest: ["authenticateRequest"],
            syntheticAuthConfigured: ["syntheticAuthConfigured"],
          },
        ),
      },
      modes: {
        sync: {},
        trigger: {
          triggerExecution: runtimeCapability(
            ["TLSN_TRIGGER_SECRET_KEY"],
            ["triggerExecutionConfig"],
            ["enqueueTriggerVerification"],
            { enqueueTriggerVerification: "config.secretKey" },
          ),
          triggerCallback: runtimeCapability(
            ["TLSN_TRIGGER_CALLBACK_SECRET"],
            ["triggerCallbackSecret"],
            ["processVerificationCompletion"],
            { processVerificationCompletion: "verifyInternalRequest" },
          ),
        },
        queue: {
          queueCallback: runtimeCapability(
            ["TLSN_QUEUE_CALLBACK_SECRET"],
            ["queueCallbackSecret"],
            ["processVerificationCompletion"],
            { processVerificationCompletion: "verifyInternalRequest" },
          ),
        },
        direct: {
          directCallback: runtimeCapability(
            ["TLSN_DIRECT_CALLBACK_SECRET"],
            ["directCallbackSecret"],
            ["dispatchDirectVerification", "processVerificationCompletion"],
            { dispatchDirectVerification: "internalRequestSignature", processVerificationCompletion: "verifyInternalRequest" },
          ),
        },
      },
    },
    verifier: {
      direct: {
        resultSigning: runtimeCapability(
          REQUIRED_SIGNING_SECRETS.slice(0, 1),
          ["readConfig"],
          ["signResult", "signSparseResult"],
          { signResult: "resultSigningPrivateKeyBytes", signSparseResult: "resultSigningPrivateKeyBytes" },
        ),
        sessionAuthoritySigning: runtimeCapability(
          REQUIRED_SIGNING_SECRETS.slice(1, 2),
          ["readConfig"],
          ["signSessionAuthorityReceipt"],
          { signSessionAuthorityReceipt: "sessionAuthoritySigningPrivateKeyBytes" },
        ),
        bindingAuthoritySigning: runtimeCapability(
          REQUIRED_SIGNING_SECRETS.slice(2, 3),
          ["readConfig"],
          ["signBindingAuthorityReceipt"],
          { signBindingAuthorityReceipt: "bindingAuthoritySigningPrivateKeyBytes" },
        ),
        directCallback: runtimeCapability(
          ["TLSN_DIRECT_CALLBACK_SECRET"],
          ["directCallbackSecret"],
          ["processVerificationCompletion"],
          { processVerificationCompletion: "verifyInternalRequest" },
        ),
      },
    },
  },
  production: {
    main: {
      resultSigning: runtimeCapability(
        ["TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signResult", "signSparseResult"],
        { signResult: "resultSigningPrivateKeyBytes", signSparseResult: "resultSigningPrivateKeyBytes" },
      ),
      sessionAuthoritySigning: runtimeCapability(
        ["TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signSessionAuthorityReceipt"],
        { signSessionAuthorityReceipt: "sessionAuthoritySigningPrivateKeyBytes" },
      ),
      bindingAuthoritySigning: runtimeCapability(
        ["TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8"],
        ["readConfig"],
        ["signBindingAuthorityReceipt"],
        { signBindingAuthorityReceipt: "bindingAuthoritySigningPrivateKeyBytes" },
      ),
      triggerExecution: runtimeCapability(
        ["TLSN_PRODUCTION_TRIGGER_SECRET_KEY"],
        ["triggerExecutionConfig"],
        ["enqueueTriggerVerification"],
        { enqueueTriggerVerification: "config.secretKey" },
      ),
      triggerCallback: runtimeCapability(
        ["TLSN_PRODUCTION_TRIGGER_CALLBACK_SECRET"],
        ["triggerCallbackSecret"],
        ["processVerificationCompletion"],
        { processVerificationCompletion: "verifyInternalRequest" },
      ),
    },
  },
};

function capabilityInputs(value) {
  return Array.isArray(value) ? value : value?.inputs ?? [];
}

function secretNamesFromCapabilityGroup(capabilities) {
  return uniqueInputNames(Object.values(capabilities).flatMap((value) => {
    if (Array.isArray(value) || Array.isArray(value?.inputs)) return capabilityInputs(value);
    return secretNamesFromCapabilityGroup(value);
  }));
}

function secretBundle(names, requiredNames, environment, label) {
  for (const name of requiredNames) {
    if (typeof environment[name] !== "string" || environment[name].length === 0) {
      throw new Error(`missing ${label} secret: ${name}`);
    }
  }
  return Object.fromEntries(names
    .filter((name) => typeof environment[name] === "string" && environment[name].length > 0)
    .map((name) => [name, environment[name]]));
}

export const CANARY_WORKER_SECRET_CONTRACT = Object.fromEntries(
  Object.entries(WORKER_SECRET_CAPABILITIES.canary)
    .map(([worker, capabilities]) => [worker, secretNamesFromCapabilityGroup(capabilities)]),
);

export function workerSecretBundleForCanary(worker, environment) {
  const names = CANARY_WORKER_SECRET_CONTRACT[worker];
  if (!names) throw new Error(`unsupported Canary Worker secret contract: ${worker}`);
  return secretBundle(names, names, environment, "Canary Worker");
}

export const EVIDENCE_WORKER_SECRET_CONTRACT = Object.fromEntries(
  Object.entries(WORKER_SECRET_CAPABILITIES.evidence)
    .map(([worker, capabilities]) => [worker, secretNamesFromCapabilityGroup(capabilities)]),
);

export const PRODUCTION_WORKER_SECRET_CONTRACT = Object.fromEntries(
  Object.entries(WORKER_SECRET_CAPABILITIES.production)
    .map(([worker, capabilities]) => [worker, secretNamesFromCapabilityGroup(capabilities)]),
);

export const EVIDENCE_WORKER_SECRET_INPUTS = uniqueInputNames(
  Object.values(EVIDENCE_WORKER_SECRET_CONTRACT).flat(),
);

export const EVIDENCE_WORKER_DECLARED_INPUTS = uniqueInputNames([
  ...Object.values(EVIDENCE_WORKER_PUBLIC_INPUTS).flat(),
  ...Object.values(EVIDENCE_WORKER_SENSITIVE_INPUTS).flat(),
  ...EVIDENCE_WORKER_SECRET_INPUTS,
]);

export function workerSecretBundleForEvidence(worker, environment) {
  const names = EVIDENCE_WORKER_SECRET_CONTRACT[worker];
  if (!names) throw new Error(`unsupported Evidence Worker secret contract: ${worker}`);
  const requiredNames = worker === "bootstrap"
    ? []
    : [...REQUIRED_SIGNING_SECRETS, "TLSN_DIRECT_CALLBACK_SECRET"];
  return secretBundle(names, requiredNames, environment, "Evidence Worker");
}

export function workerSecretBundleForProduction(worker, environment) {
  const names = PRODUCTION_WORKER_SECRET_CONTRACT[worker];
  if (!names) throw new Error(`unsupported Production Worker secret contract: ${worker}`);
  return secretBundle(names, names, environment, "Production Worker");
}

export const TEST_EXECUTION_MODES = ["sync", "trigger", "queue", "direct"];

export const TEST_WORKER_SECRET_CONTRACT = {
  main: Object.fromEntries(TEST_EXECUTION_MODES.map((mode) => [
    mode,
    uniqueInputNames([
      ...secretNamesFromCapabilityGroup(WORKER_SECRET_CAPABILITIES.test.main.always),
      ...secretNamesFromCapabilityGroup(WORKER_SECRET_CAPABILITIES.test.main.modes[mode]),
    ]),
  ])),
  verifier: {
    direct: secretNamesFromCapabilityGroup(WORKER_SECRET_CAPABILITIES.test.verifier.direct),
  },
};

export const TEST_WORKER_SECRET_INPUTS = uniqueInputNames([
  ...Object.values(TEST_WORKER_SECRET_CONTRACT.main).flat(),
  ...Object.values(TEST_WORKER_SECRET_CONTRACT.verifier).flat(),
]);

export const TEST_WORKER_DECLARED_INPUTS = uniqueInputNames([
  ...Object.values(TEST_WORKER_PUBLIC_INPUTS).flat(),
  ...Object.values(TEST_WORKER_SENSITIVE_INPUTS).flat(),
  ...TEST_WORKER_SECRET_INPUTS,
]);

export function workerSecretBundleForTest(worker, environment, executionMode = "sync") {
  if (!TEST_EXECUTION_MODES.includes(executionMode)) {
    throw new Error(`unsupported Test execution mode: ${executionMode}`);
  }
  if (worker === "verifier" && executionMode !== "direct") return {};
  const names = TEST_WORKER_SECRET_CONTRACT[worker]?.[executionMode];
  if (!names) throw new Error(`unsupported Test Worker secret contract: ${worker}/${executionMode}`);
  const requiredNames = worker === "main"
    ? [...REQUIRED_SIGNING_SECRETS, ...(executionMode === "trigger"
      ? ["TLSN_TRIGGER_SECRET_KEY", "TLSN_TRIGGER_CALLBACK_SECRET"]
      : executionMode === "queue"
        ? ["TLSN_QUEUE_CALLBACK_SECRET"]
        : executionMode === "direct"
          ? ["TLSN_DIRECT_CALLBACK_SECRET"]
          : [])]
    : [...REQUIRED_SIGNING_SECRETS, "TLSN_DIRECT_CALLBACK_SECRET"];
  return secretBundle(names, requiredNames, environment, "Test Worker");
}

export const REMOTE_ATTESTATION_SECRET_INPUTS = [
  "TLSN_REMOTE_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8",
];

export const TEST_ONLY_INPUTS = [
  "FUSOU_SYNTHETIC_ROOT_KEY_PKCS8",
  "TLSN_TEST_WORKER_NAME",
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_TEST_BINDING_VALUES",
  "TLSN_TEST_AUTH_USERS",
  "TLSN_TEST_DEVICE_ID",
  "TLSN_TEST_DEVICE_PUBLIC_KEY",
  "TLSN_TEST_COMPLETION_DELAY_MS",
  "TLSN_TEST_COMPLETION_DELAY_ONCE",
  "TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS",
  "TLSN_TEST_DIRECT_VERIFIER_DELAY_MS",
  "TLSN_TEST_DIRECT_VERIFIER_MODE",
  "TLSN_TEST_POST_RESULT_DELAY_MS",
  "TLSN_TEST_POST_RESULT_DELAY_ONCE",
  "TLSN_TEST_VERIFICATION_LEASE_MS",
  "TLSN_DIRECT_CALLBACK_ORIGIN",
  "TLSN_DIRECT_CALLBACK_SECRET",
  "TLSN_DIRECT_FIXTURE_MODE",
  "TLSN_DIRECT_FIXTURE_TIMEOUT_MS",
  "TLSN_DIRECT_TRACE_ORIGIN",
  "TLSN_REMOTE_DIRECT_CALLBACK_SECRET",
  "TLSN_REMOTE_DIRECT_EXPECTED_MODE",
  "TLSN_TEST_STUCK_JOB_AGE_THRESHOLD_MS",
];

export const PRODUCTION_LIKE_EVIDENCE_INPUTS = [
  "TLSN_EVIDENCE_WORKER_NAME",
  "TLSN_EVIDENCE_VERIFIER_NAME",
];

export const FORBIDDEN_EVIDENCE_INPUTS = [
  ...CANARY_INPUTS,
  ...PRODUCTION_INPUTS,
  ...CANARY_SECRET_INPUTS,
  ...PRODUCTION_SECRET_INPUTS,
];

export const SECURITY_IDENTITY_FIELDS = [
  "git_commit_sha",
  "server_identity",
  "profile_sha256",
  "sparse_profile_sha256",
  "verifier_key_id",
  "notary_key_id",
  "security_registry_set_sha256",
  "notary_registry_sha256",
  "binding_authority",
];

export const DEPLOYMENT_IDENTITY_FIELDS = [
  "deployment_id",
  "deployment_role",
  "binding_mode",
  "trust_root_certificate_sha256",
  "worker_name",
];

export const RESULT_IDENTITY_FIELDS = [
  "result_public_key_spki",
  "result_key_registry_envelope_sha256",
  "result_registry_root_key_id",
  "result_registry_root_public_key_spki",
];

export const RUNTIME_INPUTS = [
  "PATH", "HOME", "PWD", "TMPDIR", "TMP", "TEMP", "CI", "NODE_OPTIONS",
  "XDG_CACHE_HOME", "CARGO_HOME", "RUSTUP_HOME", "CC_wasm32_unknown_unknown",
  "AR_wasm32_unknown_unknown", "RUSTFLAGS",
];

export const DEPLOYMENT_AUTH_INPUTS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "WRANGLER_SEND_METRICS",
  "WRANGLER_LOG",
];

export const FORBIDDEN_CANARY_INPUTS = [
  ...TEST_ONLY_INPUTS,
  ...PRODUCTION_SECRET_INPUTS,
  ...PRODUCTION_INPUTS,
];

export const FORBIDDEN_PRODUCTION_INPUTS = [
  ...TEST_ONLY_INPUTS,
  ...CANARY_SECRET_INPUTS,
  ...CANARY_INPUTS,
  ...REMOTE_ATTESTATION_SECRET_INPUTS,
];

export function inputsForRole(role) {
  if (role === "canary") return [...COMMON_INPUTS, ...CANARY_INPUTS];
  if (role === "production") return [...COMMON_INPUTS, ...PRODUCTION_INPUTS];
  throw new Error(`unsupported deployment role: ${role}`);
}

export function secretInputsForRole(role) {
  if (role === "canary") return [...CANARY_SECRET_INPUTS];
  if (role === "production") return [...PRODUCTION_SECRET_INPUTS];
  throw new Error(`unsupported deployment role: ${role}`);
}

export function assertManifest(manifest) {
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (
    manifest?.schema_version !== 3 ||
    manifest?.scope !== "tlsn-deployment-inputs" ||
    !same(manifest.profile_contract, PROFILE_CONTRACT_INPUT_MANIFEST) ||
    !same(manifest.security_registry_set_contract, SECURITY_REGISTRY_SET_CONTRACT) ||
    !same(manifest.common_inputs, COMMON_INPUTS) ||
    !same(manifest.canary_inputs, CANARY_INPUTS) ||
    !same(manifest.production_inputs, PRODUCTION_INPUTS) ||
    !same(manifest.production_evidence_inputs, PRODUCTION_EVIDENCE_INPUTS) ||
    !same(manifest.canary_public_inputs, CANARY_PUBLIC_INPUTS) ||
    !same(manifest.canary_sensitive_inputs, CANARY_SENSITIVE_INPUTS) ||
    !same(manifest.canary_secret_inputs, CANARY_SECRET_INPUTS) ||
    !same(manifest.production_public_inputs, PRODUCTION_PUBLIC_INPUTS) ||
    !same(manifest.production_sensitive_inputs, PRODUCTION_SENSITIVE_INPUTS) ||
    !same(manifest.production_secret_inputs, PRODUCTION_SECRET_INPUTS) ||
    !same(manifest.production_evidence_public_inputs, PRODUCTION_EVIDENCE_PUBLIC_INPUTS) ||
    !same(manifest.production_evidence_sensitive_inputs, PRODUCTION_EVIDENCE_SENSITIVE_INPUTS) ||
    !same(manifest.production_evidence_secret_inputs, PRODUCTION_EVIDENCE_SECRET_INPUTS) ||
    !same(manifest.workflow_evidence_inputs, WORKFLOW_EVIDENCE_INPUTS) ||
    !same(manifest.production_gate_inputs, PRODUCTION_GATE_INPUTS) ||
    !same(manifest.remote_attestation_secret_inputs, REMOTE_ATTESTATION_SECRET_INPUTS)
  ) {
    throw new Error("production input manifest is invalid");
  }
}

export function environmentForNames(source, names) {
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => names.includes(name)),
  );
}

export function assertNoForbiddenInputs(source, forbiddenNames, role) {
  const present = forbiddenNames.filter((name) => source[name] !== undefined);
  if (present.length > 0) {
    throw new Error(`${role} deployment received forbidden inputs: ${present.join(", ")}`);
  }
}

export function assertDistinctResultKeys(canary, production) {
  if (
    canary?.result_identity?.result_public_key_spki ===
    production?.result_identity?.result_public_key_spki
  ) {
    throw new Error("canary and production result public keys must be different");
  }
}

export function securityIdentityFromHealth(health) {
  return health?.security_identity ?? null;
}

export function deploymentIdentityFromHealth(health) {
  return health?.deployment_identity ?? null;
}

export function resultIdentityFromHealth(health) {
  return health?.result_identity ?? null;
}
