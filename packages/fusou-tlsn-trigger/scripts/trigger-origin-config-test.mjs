import assert from "node:assert/strict";
import { CANARY_ORIGIN_RUNTIME_ENVS, triggerOriginRuntimeEnvNames } from "./trigger-origin-config.mjs";

assert.throws(
  () => triggerOriginRuntimeEnvNames({ TLSN_TRIGGER_DEPLOYMENT_ROLE: "production" }),
  /canonical TLSN_SECURITY_REGISTRY_SET_SHA256/,
);
assert.deepEqual(
  triggerOriginRuntimeEnvNames({
    TLSN_TRIGGER_DEPLOYMENT_ROLE: "production",
    TLSN_SECURITY_REGISTRY_SET_SHA256: "A".repeat(43),
  }),
  ["TLSN_TRIGGER_DEPLOYMENT_ROLE", "TLSN_SECURITY_REGISTRY_SET_SHA256"],
);
assert.throws(
  () => triggerOriginRuntimeEnvNames({
    TLSN_TRIGGER_DEPLOYMENT_ROLE: "production",
    TLSN_TRIGGER_SERVER_IDENTITY: "canary.example",
  }),
  /Production Trigger must not configure static Origin inputs/,
);
assert.throws(
  () => triggerOriginRuntimeEnvNames({
    TLSN_TRIGGER_DEPLOYMENT_ROLE: "canary",
    TLSN_TRIGGER_SERVER_IDENTITY: "canary.example",
    TLSN_TRIGGER_PROFILE_SHA256: "complete-hash",
    TLSN_TRIGGER_SPARSE_PROFILE_SHA256: "sparse-hash",
  }),
  /canonical TLSN_SECURITY_REGISTRY_SET_SHA256/,
);
assert.throws(
  () => triggerOriginRuntimeEnvNames({ TLSN_TRIGGER_DEPLOYMENT_ROLE: "canary" }),
  /Canary Trigger requires fixed Origin inputs/,
);
assert.deepEqual(
  triggerOriginRuntimeEnvNames({
    TLSN_TRIGGER_DEPLOYMENT_ROLE: "canary",
    TLSN_TRIGGER_SERVER_IDENTITY: "canary.example",
    TLSN_TRIGGER_PROFILE_SHA256: "complete-hash",
    TLSN_TRIGGER_SPARSE_PROFILE_SHA256: "sparse-hash",
    TLSN_SECURITY_REGISTRY_SET_SHA256: "B".repeat(43),
  }),
  ["TLSN_TRIGGER_DEPLOYMENT_ROLE", ...CANARY_ORIGIN_RUNTIME_ENVS, "TLSN_SECURITY_REGISTRY_SET_SHA256"],
);
assert.throws(
  () => triggerOriginRuntimeEnvNames({ TLSN_TRIGGER_DEPLOYMENT_ROLE: "unknown" }),
  /TLSN_TRIGGER_DEPLOYMENT_ROLE must be either 'canary' or 'production'/,
);

console.info("Trigger Origin deployment configuration tests passed");