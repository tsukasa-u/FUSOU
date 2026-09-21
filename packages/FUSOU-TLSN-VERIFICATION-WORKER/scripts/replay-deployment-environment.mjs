const forbiddenPrefixes = ["TLSN_CANARY_", "TLSN_PRODUCTION_", "TLSN_CANDIDATE_"];
const forbiddenNames = [
  "TLSN_TEST_AUTH_USERS",
  "TLSN_TEST_DEVICE_ID",
  "TLSN_TEST_DEVICE_PUBLIC_KEY",
  "TLSN_TEST_BINDING_VALUES",
  "TLSN_TEST_COMPLETION_DELAY_MS",
  "TLSN_TEST_COMPLETION_DELAY_ONCE",
  "TLSN_TEST_POST_RESULT_DELAY_MS",
  "TLSN_TEST_POST_RESULT_DELAY_ONCE",
  "TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS",
  "TLSN_TEST_DIRECT_VERIFIER_MODE",
  "TLSN_TEST_DIRECT_VERIFIER_DELAY_MS",
  "TLSN_TEST_VERIFICATION_LEASE_MS",
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_DEVICE_AUTH_URL",
  "TLSN_DEVICE_POSSESSION_AUTH_URL",
];

function required(name, environment) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`missing required replay input: ${name}`);
  return value;
}

function assertWorkerName(name) {
  if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(name)) {
    throw new Error("TLSN_REPLAY_WORKER_NAME must be a valid Worker name");
  }
}

function requiredHttpsUrl(name, environment, pathname) {
  const value = required(name, environment);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a non-placeholder HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.hostname.includes("kancolle") ||
    /(?:^|\.)(?:example|invalid)$/i.test(url.hostname)
  ) {
    throw new Error(`${name} must be a non-placeholder HTTPS URL`);
  }
  if (pathname !== undefined && url.pathname !== pathname) {
    throw new Error(`${name} must use the exact path ${pathname}`);
  }
  return value;
}

export function decodeReplayEnvironmentValues(environment) {
  return Object.fromEntries(Object.entries(environment).map(([name, value]) => {
    if (typeof value !== "string" || !value.startsWith("base64json:")) {
      return [name, value];
    }
    return [name, Buffer.from(value.slice("base64json:".length), "base64url").toString("utf8")];
  }));
}

export function normalizeReplayDeploymentEnvironment(inputEnvironment) {
  const environment = inputEnvironment ?? {};
  if (environment.TLSN_ENVIRONMENT && environment.TLSN_ENVIRONMENT !== "test") {
    throw new Error("TLSN_ENVIRONMENT must be test for the replay deployment");
  }
  if (environment.TLSN_DEPLOYMENT_ROLE && environment.TLSN_DEPLOYMENT_ROLE !== "replay") {
    throw new Error("TLSN_DEPLOYMENT_ROLE must be replay for the replay deployment");
  }
  for (const prefix of forbiddenPrefixes) {
    const forbidden = Object.keys(environment).find((name) => name.startsWith(prefix));
    if (forbidden) throw new Error(`${forbidden} must not be present in a replay deployment environment`);
  }
  for (const name of forbiddenNames) {
    if (environment[name] !== undefined) throw new Error(`${name} must not be present in a replay deployment environment`);
  }

  const workerName = environment.TLSN_REPLAY_WORKER_NAME?.trim() || "fusou-tlsn-verification-replay";
  const deploymentId = environment.TLSN_REPLAY_DEPLOYMENT_ID?.trim();
  assertWorkerName(workerName);
  if (!deploymentId || !/^[A-Za-z0-9._-]{1,128}$/.test(deploymentId)) {
    throw new Error("TLSN_REPLAY_DEPLOYMENT_ID must be a safe deployment identity");
  }
  if (environment.TLSN_REPLAY_ENVIRONMENT_CONFIRMATION !== "non-production-synthetic") {
    throw new Error("TLSN_REPLAY_ENVIRONMENT_CONFIRMATION must be non-production-synthetic");
  }

  const replaySupabaseUrl = requiredHttpsUrl("TLSN_REPLAY_SUPABASE_URL", environment);
  const replayDeviceAuthUrl = requiredHttpsUrl(
    "TLSN_REPLAY_DEVICE_AUTH_URL",
    environment,
    "/api/auth/anonymous-sync/v2/device-proof",
  );
  const replayDevicePossessionAuthUrl = requiredHttpsUrl(
    "TLSN_REPLAY_DEVICE_POSSESSION_AUTH_URL",
    environment,
    "/api/auth/anonymous-sync/v2/tlsn-device-proof",
  );
  const replaySupabasePublishableKey = required("TLSN_REPLAY_SUPABASE_PUBLISHABLE_KEY", environment);
  const replayBindingValue = required("TLSN_REPLAY_BINDING_VALUE", environment);
  const replayAuthUsers = required("TLSN_REPLAY_AUTH_USERS", environment);
  const replayDeviceId = required("TLSN_REPLAY_DEVICE_ID", environment);
  const replayDevicePublicKey = required("TLSN_REPLAY_DEVICE_PUBLIC_KEY", environment);

  return {
    ...environment,
    TLSN_ENVIRONMENT: "test",
    TLSN_DEPLOYMENT_ROLE: "replay",
    TLSN_EXECUTION_MODE: "direct",
    TLSN_BENCHMARK_TIMINGS: "true",
    TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE: "true",
    TLSN_REPLAY_DEPLOYMENT_ID: deploymentId,
    TLSN_REPLAY_WORKER_NAME: workerName,
    TLSN_SUPABASE_URL: replaySupabaseUrl,
    TLSN_SUPABASE_PUBLISHABLE_KEY: replaySupabasePublishableKey,
    TLSN_DEVICE_AUTH_URL: replayDeviceAuthUrl,
    TLSN_DEVICE_POSSESSION_AUTH_URL: replayDevicePossessionAuthUrl,
    TLSN_TEST_BINDING_VALUE: replayBindingValue,
    TLSN_REPLAY_AUTH_USERS: replayAuthUsers,
    TLSN_REPLAY_DEVICE_ID: replayDeviceId,
    TLSN_REPLAY_DEVICE_PUBLIC_KEY: replayDevicePublicKey,
  };
}