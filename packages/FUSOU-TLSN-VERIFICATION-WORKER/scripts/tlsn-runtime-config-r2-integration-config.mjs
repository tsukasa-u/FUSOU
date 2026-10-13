import {
  isValidRuntimeConfigR2AccountId,
  isValidRuntimeConfigR2BucketName,
  RUNTIME_CONFIG_R2_ENV,
} from "./tlsn-runtime-config-r2-store.mjs";

export const RUNTIME_CONFIG_R2_INTEGRATION_ENV = Object.freeze({
  optIn: "TLSN_RUNTIME_CONFIG_R2_INTEGRATION_OPT_IN",
  accountId: "TLSN_RUNTIME_CONFIG_R2_TEST_ACCOUNT_ID",
  bucket: "TLSN_RUNTIME_CONFIG_R2_TEST_BUCKET",
  accessKeyId: "TLSN_RUNTIME_CONFIG_R2_TEST_ACCESS_KEY_ID",
  secretAccessKey: "TLSN_RUNTIME_CONFIG_R2_TEST_SECRET_ACCESS_KEY",
  bucketConfirmation: "TLSN_RUNTIME_CONFIG_R2_TEST_BUCKET_CONFIRMATION",
});

const TEST_BUCKET_PATTERN = /^fusou-tlsn-r2-test-[a-z0-9]+$/;
const REQUIRED_BUCKET_CONFIRMATION = "I_CONFIRM_THIS_IS_DISPOSABLE_NON_PRODUCTION";
const REQUIRED_OPT_IN = "1";

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function blocked(reason) {
  return Object.freeze({
    state: "BLOCKED_EXTERNAL_INPUTS",
    reason,
  });
}

export function inspectRuntimeConfigR2IntegrationConfiguration(env = process.env) {
  const optIn = env[RUNTIME_CONFIG_R2_INTEGRATION_ENV.optIn];
  if (!isPresent(optIn)) {
    return Object.freeze({
      state: "NOT_RUN",
      reason: `${RUNTIME_CONFIG_R2_INTEGRATION_ENV.optIn} must be explicitly set to 1`,
    });
  }
  if (optIn !== REQUIRED_OPT_IN) {
    return blocked(`${RUNTIME_CONFIG_R2_INTEGRATION_ENV.optIn} must be exactly 1`);
  }

  const required = [
    ["account ID", RUNTIME_CONFIG_R2_INTEGRATION_ENV.accountId],
    ["test bucket", RUNTIME_CONFIG_R2_INTEGRATION_ENV.bucket],
    ["test access key ID", RUNTIME_CONFIG_R2_INTEGRATION_ENV.accessKeyId],
    ["test secret access key", RUNTIME_CONFIG_R2_INTEGRATION_ENV.secretAccessKey],
    ["non-Production bucket confirmation", RUNTIME_CONFIG_R2_INTEGRATION_ENV.bucketConfirmation],
  ];
  const missing = required
    .filter(([, name]) => !isPresent(env[name]))
    .map(([, name]) => name);
  if (missing.length > 0) {
    return blocked(`required integration inputs are missing: ${missing.join(", ")}`);
  }

  const accountId = env[RUNTIME_CONFIG_R2_INTEGRATION_ENV.accountId];
  const bucket = env[RUNTIME_CONFIG_R2_INTEGRATION_ENV.bucket];
  if (!isValidRuntimeConfigR2AccountId(accountId)) {
    return blocked("test account ID has an invalid format");
  }
  if (!isValidRuntimeConfigR2BucketName(bucket) || !TEST_BUCKET_PATTERN.test(bucket)) {
    return blocked("test bucket must use the dedicated fusou-tlsn-r2-test-<suffix> name");
  }
  if (bucket === env[RUNTIME_CONFIG_R2_ENV.bucket]) {
    return blocked("test bucket must not equal the configured Runtime Config publisher bucket");
  }
  if (
    env[RUNTIME_CONFIG_R2_INTEGRATION_ENV.bucketConfirmation] !==
    REQUIRED_BUCKET_CONFIRMATION
  ) {
    return blocked("explicit disposable non-Production bucket confirmation is required");
  }
  if (
    isPresent(env[RUNTIME_CONFIG_R2_ENV.accessKeyId]) &&
    env[RUNTIME_CONFIG_R2_INTEGRATION_ENV.accessKeyId] ===
      env[RUNTIME_CONFIG_R2_ENV.accessKeyId]
  ) {
    return blocked("test credentials must not reuse the configured Runtime Config publisher access key");
  }
  if (
    isPresent(env[RUNTIME_CONFIG_R2_ENV.secretAccessKey]) &&
    env[RUNTIME_CONFIG_R2_INTEGRATION_ENV.secretAccessKey] ===
      env[RUNTIME_CONFIG_R2_ENV.secretAccessKey]
  ) {
    return blocked("test credentials must not reuse the configured Runtime Config publisher secret");
  }

  return Object.freeze({
    state: "READY",
    reason: "explicit opt-in and dedicated non-Production test inputs are present",
    config: Object.freeze({
      accountId: accountId.toLowerCase(),
      bucket,
      accessKeyId: env[RUNTIME_CONFIG_R2_INTEGRATION_ENV.accessKeyId],
      secretAccessKey: env[RUNTIME_CONFIG_R2_INTEGRATION_ENV.secretAccessKey],
      endpoint: `https://${accountId.toLowerCase()}.r2.cloudflarestorage.com`,
    }),
  });
}
