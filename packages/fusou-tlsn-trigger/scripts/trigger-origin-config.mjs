export const CANARY_ORIGIN_RUNTIME_ENVS = [
  "TLSN_TRIGGER_SERVER_IDENTITY",
  "TLSN_TRIGGER_PROFILE_SHA256",
  "TLSN_TRIGGER_SPARSE_PROFILE_SHA256",
];

const SECURITY_SET_RUNTIME_ENV = "TLSN_SECURITY_REGISTRY_SET_SHA256";

export function triggerOriginRuntimeEnvNames(environment) {
  const role = String(environment.TLSN_TRIGGER_DEPLOYMENT_ROLE ?? "").trim().toLowerCase();
  const deploymentRole = "TLSN_TRIGGER_DEPLOYMENT_ROLE";
  if (role === "production") {
    const configured = CANARY_ORIGIN_RUNTIME_ENVS.filter((name) => environment[name] !== undefined);
    if (configured.length > 0) {
      throw new Error(`Production Trigger must not configure static Origin inputs: ${configured.join(", ")}`);
    }
    const securitySetHash = String(environment[SECURITY_SET_RUNTIME_ENV] ?? "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(securitySetHash)) {
      throw new Error("Production Trigger requires a canonical TLSN_SECURITY_REGISTRY_SET_SHA256");
    }
    return [deploymentRole, SECURITY_SET_RUNTIME_ENV];
  }
  if (role === "canary") {
    const missing = CANARY_ORIGIN_RUNTIME_ENVS.filter((name) => !String(environment[name] ?? "").trim());
    if (missing.length > 0) {
      throw new Error(`Canary Trigger requires fixed Origin inputs: ${missing.join(", ")}`);
    }
    const securitySetHash = String(environment[SECURITY_SET_RUNTIME_ENV] ?? "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(securitySetHash)) {
      throw new Error("Canary Trigger requires a canonical TLSN_SECURITY_REGISTRY_SET_SHA256");
    }
    return [deploymentRole, ...CANARY_ORIGIN_RUNTIME_ENVS, SECURITY_SET_RUNTIME_ENV];
  }
  throw new Error("TLSN_TRIGGER_DEPLOYMENT_ROLE must be either 'canary' or 'production'");
}