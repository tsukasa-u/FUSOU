export const CANARY_ORIGIN_RUNTIME_ENVS = [
  "TLSN_TRIGGER_SERVER_IDENTITY",
  "TLSN_TRIGGER_PROFILE_SHA256",
  "TLSN_TRIGGER_SPARSE_PROFILE_SHA256",
];

export function triggerOriginRuntimeEnvNames(environment) {
  const role = String(environment.TLSN_TRIGGER_DEPLOYMENT_ROLE ?? "").trim().toLowerCase();
  if (role === "production") {
    const configured = CANARY_ORIGIN_RUNTIME_ENVS.filter((name) => environment[name] !== undefined);
    if (configured.length > 0) {
      throw new Error(`Production Trigger must not configure static Origin inputs: ${configured.join(", ")}`);
    }
    return [];
  }
  if (role === "canary") {
    const missing = CANARY_ORIGIN_RUNTIME_ENVS.filter((name) => !String(environment[name] ?? "").trim());
    if (missing.length > 0) {
      throw new Error(`Canary Trigger requires fixed Origin inputs: ${missing.join(", ")}`);
    }
    return [...CANARY_ORIGIN_RUNTIME_ENVS];
  }
  throw new Error("TLSN_TRIGGER_DEPLOYMENT_ROLE must be either 'canary' or 'production'");
}